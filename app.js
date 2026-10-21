(() => {
  "use strict";
  const H = window.HOSPITAL;
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";

  const WALK_MPS = 0.9;      // ゆっくり歩く速さ（m/秒）
  const EV_WAIT = 45;        // エレベーター待ち時間（秒）
  const EV_PER_FLOOR = 8;    // 1階あたり（秒）
  const ESC_PER_FLOOR = 25;  // エスカレーター（秒）

  const places = H.places;
  const placeById = Object.fromEntries(places.map((p) => [p.id, p]));

  /* ---------- 模式図上の配置 ---------- */
  // 建物・階ごとに施設タイルを並べる
  const tiles = {};
  for (const [bid, b] of Object.entries(H.buildings)) {
    for (const f of b.floors) {
      const list = places.filter((p) => p.b === bid && p.f === f);
      if (!list.length) continue;
      const [x, y, w, h] = b.rect;
      const coreBottom = b.core[1] >= y + h / 2;
      const cols = w > 100 ? 2 : 1;
      const rows = Math.ceil(list.length / cols);
      const pad = 7, gap = 5, head = 20, coreSpace = 26;
      const top = y + head + (coreBottom ? 0 : coreSpace);
      const avail = h - head - coreSpace - pad;
      const th = Math.min(40, (avail - gap * (rows - 1)) / rows);
      const tw = (w - pad * 2 - gap * (cols - 1)) / cols;
      list.forEach((p, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const tx = x + pad + c * (tw + gap), ty = top + r * (th + gap);
        tiles[p.id] = { x: tx, y: ty, w: tw, h: th, cx: tx + tw / 2, cy: ty + th / 2 };
      });
    }
  }
  const deck = placeById.deck;
  tiles.deck = { x: deck.at[0] - 26, y: deck.at[1] - 12, w: 52, h: 18, cx: deck.at[0], cy: deck.at[1] };

  /* ---------- グラフ ---------- */
  const nodes = {};   // id -> {f, x, y, kind, b?}
  const adj = {};     // id -> [{to, cost, kind, pts?}]
  const addNode = (id, n) => { nodes[id] = n; adj[id] = adj[id] || []; };
  const addEdge = (a, b, cost, kind, pts) => {
    adj[a].push({ to: b, cost, kind, pts });
    adj[b].push({ to: a, cost, kind, pts: pts ? pts.slice().reverse() : undefined });
  };
  const walkSec = (px) => (px * H.metersPerPx) / WALK_MPS;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  for (const [bid, b] of Object.entries(H.buildings)) {
    for (const f of b.floors) addNode(`${bid}@${f}`, { f, x: b.core[0], y: b.core[1], kind: "core", b: bid });
    for (let i = 0; i < b.floors.length - 1; i++) {
      const f1 = b.floors[i], f2 = b.floors[i + 1];
      if (f2 - f1 === 1) addEdge(`${bid}@${f1}`, `${bid}@${f2}`, EV_PER_FLOOR, "ev");
    }
  }
  for (const [id, n] of Object.entries(H.nodes)) addNode(id, { ...n, kind: id.startsWith("esc") ? "esc" : "pass" });
  for (const [a, b, extra = 0] of H.links) addEdge(a, b, walkSec(dist(nodes[a], nodes[b])) + extra, "walk");
  for (const [a, b] of H.escalators) addEdge(a, b, ESC_PER_FLOOR, "esc");

  for (const p of places) {
    const t = tiles[p.id];
    const id = "p:" + p.id;
    addNode(id, { f: p.f, x: t.cx, y: t.cy, kind: "place", b: p.b });
    if (p.id === "deck") {
      addEdge(id, "deckmid", walkSec(dist(nodes[id], nodes.deckmid)) + 60, "walk");
    } else {
      const core = nodes[`${p.b}@${p.f}`];
      const corner = { x: t.cx, y: core.y };
      const pts = [[t.cx, t.cy], [corner.x, corner.y], [core.x, core.y]];
      addEdge(id, `${p.b}@${p.f}`, walkSec(Math.abs(t.cy - core.y) + Math.abs(t.cx - core.x)), "walk", pts);
    }
  }

  function shortest(src, dst, barrierFree) {
    const d = { [src]: 0 }, prev = {}, done = new Set();
    const evState = {}; // エレベーター乗車中かどうか（待ち時間を1回だけ加算）
    while (true) {
      let u = null, best = Infinity;
      for (const k in d) if (!done.has(k) && d[k] < best) { best = d[k]; u = k; }
      if (u === null || u === dst) break;
      done.add(u);
      for (const e of adj[u]) {
        if (barrierFree && e.kind === "esc") continue;
        let c = e.cost;
        if (e.kind === "ev" && !evState[u]) c += EV_WAIT;
        const nd = d[u] + c;
        if (nd < (d[e.to] ?? Infinity)) {
          d[e.to] = nd; prev[e.to] = { from: u, edge: e };
          evState[e.to] = e.kind === "ev";
        }
      }
    }
    if (!(dst in d)) return null;
    const path = [];
    for (let v = dst; v !== src; v = prev[v].from) path.unshift({ node: v, via: prev[v].edge, from: prev[v].from });
    return { sec: d[dst], path };
  }

  /* ---------- 文言 ---------- */
  const bName = (bid) => {
    if (bid === "deck") return "デッキ";
    const b = H.buildings[bid];
    return b.sub ? `${b.name}（${b.sub}）` : b.name;
  };
  const areaOf = (id) => {
    const n = nodes[id];
    if (id === "hall") return "エントランスホール";
    if (id.startsWith("deck") || id === "p:deck") return "駅デッキ";
    if (n.kind === "core" || n.kind === "place") return bName(n.b);
    return null;
  };
  const placeLabel = (p) => (p.id === "deck" ? p.name : `${p.name}｜${H.buildings[p.b].name} ${p.f}階`);

  function buildSteps(src, res) {
    const steps = [];
    const runs = []; // 階ごとの移動
    let cur = { f: nodes[src].f, ids: [src], pts: [] };
    const pushPts = (from, to, edge) => {
      if (edge.pts) cur.pts.push(...edge.pts);
      else cur.pts.push([nodes[from].x, nodes[from].y], [nodes[to].x, nodes[to].y]);
    };
    for (const s of res.path) {
      if (s.via.kind === "ev" || s.via.kind === "esc") {
        runs.push(cur);
        const last = runs[runs.length - 1];
        last.exit = { kind: s.via.kind, node: s.from };
        cur = { f: nodes[s.node].f, ids: [s.node], pts: [], enter: { kind: s.via.kind, node: s.node } };
      } else {
        pushPts(s.from, s.node, s.via);
        cur.ids.push(s.node);
      }
    }
    runs.push(cur);

    // エレベーターの連続をまとめる
    const merged = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      if (prev && r.ids.length === 1 && r.exit && prev.exit && prev.exit.kind === r.exit.kind) {
        prev.exit.node = r.exit.node; // 通過階
        continue;
      }
      merged.push(r);
    }

    const from = placeById[src.slice(2)];
    steps.push({ kind: "start", text: `<b>${placeLabel(from)}</b> を出発`, f: from.f });
    merged.forEach((r, i) => {
      const areas = [];
      for (const id of r.ids) {
        const a = areaOf(id);
        if (a && areas[areas.length - 1] !== a) areas.push(a);
      }
      const isLast = i === merged.length - 1;
      if (areas.length > 1) {
        const via = areas.slice(1, -1);
        const hasDeck = areas.includes("駅デッキ");
        steps.push({
          kind: "walk", f: r.f,
          text: `${r.f}階：<b>${areas[0]}</b> から${via.length ? ` ${via.join("・")} を通って` : (hasDeck ? "" : " 連絡通路を通って")} <b>${areas[areas.length - 1]}</b> へ`
        });
      } else if (!isLast && r.ids.length > 1) {
        steps.push({ kind: "walk", f: r.f, text: `${r.f}階：${areas[0] || ""}の${r.exit && r.exit.kind === "esc" ? "エスカレーター" : "エレベーター"}へ` });
      }
      if (r.exit) {
        const next = merged[i + 1];
        const toF = next.f;
        const n = nodes[r.exit.node];
        if (r.exit.kind === "esc") {
          steps.push({ kind: "esc", f: r.f, text: `エスカレーターで <b>${toF}階</b> へ${toF > r.f ? "上がる" : "下りる"}` });
        } else {
          steps.push({ kind: "ev", f: r.f, text: `${bName(n.b)}のエレベーターで <b>${toF}階</b> へ` });
        }
      }
    });
    const to = res.path[res.path.length - 1].node;
    const dest = placeById[to.slice(2)];
    steps.push({ kind: "goal", text: `<b>${placeLabel(dest)}</b> に到着`, f: dest.f });
    return { steps, runs: merged };
  }

  /* ---------- UI ---------- */
  const fromSel = $("from"), toSel = $("to"), bf = $("bf");

  function fillSelect(sel, placeholder) {
    sel.innerHTML = "";
    const o = document.createElement("option");
    o.value = ""; o.textContent = placeholder; sel.appendChild(o);
    const groups = [];
    groups.push({ label: "入口", list: [deck] });
    const floors = [...new Set(places.filter((p) => p.id !== "deck").map((p) => p.f))].sort((a, b) => a - b);
    for (const f of floors) groups.push({ label: `${f}階`, list: places.filter((p) => p.f === f && p.id !== "deck") });
    for (const g of groups) {
      const og = document.createElement("optgroup");
      og.label = g.label;
      for (const p of g.list) {
        const op = document.createElement("option");
        op.value = p.id;
        op.textContent = p.id === "deck" ? p.name : `${p.name}　${H.buildings[p.b].name}`;
        og.appendChild(op);
      }
      sel.appendChild(og);
    }
  }
  fillSelect(fromSel, "選んでください");
  fillSelect(toSel, "選んでください");

  const chips = $("chips");
  for (const id of H.quick) {
    const p = placeById[id];
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = p.short || p.name;
    b.addEventListener("click", () => { toSel.value = id; update(); });
    chips.appendChild(b);
  }

  let state = { floors: [], current: 0, res: null, runs: [], src: null, dst: null };

  function update(pushUrl = true) {
    const a = fromSel.value, b = toSel.value;
    for (const c of chips.children) c.classList.toggle("on", H.quick[[...chips.children].indexOf(c)] === b);
    if (pushUrl) {
      const q = new URLSearchParams();
      if (a) q.set("from", a); if (b) q.set("to", b); if (bf.checked) q.set("bf", "1");
      history.replaceState(null, "", q.toString() ? "?" + q : location.pathname);
    }
    if (!a || !b) { $("result").hidden = true; $("empty").hidden = false; return; }
    $("empty").hidden = true; $("result").hidden = false;
    if (a === b) {
      $("summary").innerHTML = `<p class="same">出発地と目的地が同じです。</p>`;
      $("tabs").innerHTML = ""; $("steps").innerHTML = ""; drawFloor(placeById[a].f, [], a, b); return;
    }
    const res = shortest("p:" + a, "p:" + b, bf.checked);
    if (!res) { $("summary").innerHTML = `<p class="same">経路が見つかりませんでした。</p>`; return; }
    const { steps, runs } = buildSteps("p:" + a, res);
    const floors = [];
    for (const r of runs) if (!floors.includes(r.f)) floors.push(r.f);
    state = { floors, current: 0, res, runs, src: a, dst: b, steps };

    const min = Math.max(1, Math.round(res.sec / 60));
    const changes = runs.length - 1;
    $("summary").innerHTML =
      `<div class="time"><span class="num">約${min}</span><span class="unit">分</span></div>` +
      `<div class="meta"><span>${floors.map((f) => f + "F").join(" → ")}</span>` +
      `<span>${changes ? `階の移動 ${changes}回` : "同じ階で移動"}${bf.checked ? "・エレベーターのみ" : ""}</span>` +
      `<span class="est">所要時間はゆっくり歩いた場合の目安（推定）</span></div>`;

    $("steps").innerHTML = steps.map((s) => {
      const icon = { start: "●", goal: "◎", walk: "→", ev: "⇅", esc: "⇡" }[s.kind];
      return `<li class="${s.kind}" data-f="${s.f ?? ""}"><span class="ic">${icon}</span><span>${s.text}</span></li>`;
    }).join("");
    for (const li of $("steps").children) {
      li.addEventListener("click", () => { const f = +li.dataset.f; if (f && floors.includes(f)) selectFloor(floors.indexOf(f)); });
    }
    renderTabs();
    selectFloor(0);
  }

  function renderTabs() {
    const t = $("tabs");
    t.innerHTML = "";
    state.floors.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab"); b.textContent = `${f}階`;
      b.addEventListener("click", () => selectFloor(i));
      t.appendChild(b);
    });
  }

  function selectFloor(i) {
    state.current = i;
    [...$("tabs").children].forEach((b, j) => { b.classList.toggle("on", i === j); b.setAttribute("aria-selected", i === j); });
    const f = state.floors[i];
    [...$("steps").children].forEach((li) => li.classList.toggle("cur", +li.dataset.f === f));
    drawFloor(f, state.runs.filter((r) => r.f === f), state.src, state.dst);
  }

  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawFloor(f, runs, src, dst) {
    const svg = $("map");
    svg.innerHTML = "";
    el("text", { x: 14, y: 366, class: "flabel" }, svg, `${f}階　模式図（配置は推定）`);

    if (f === 3) {
      el("rect", { x: 218, y: 222, width: 40, height: 136, rx: 6, class: "deck" }, svg);
      el("text", { x: 238, y: 336, class: "decklabel" }, svg, "デッキ");
      el("rect", { x: 200, y: 222, width: 76, height: 30, rx: 6, class: "hall" }, svg);
      el("text", { x: 238, y: 241, class: "halllabel" }, svg, "エントランス");
    }
    // 連絡通路（推定）
    const corridor = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, class: "corr" }, svg);
    if (f >= 2 && f <= 5) corridor(186, 230, 204, 230);
    if (f === 2) { corridor(346, 64, 356, 64); corridor(346, 168, 356, 168); }
    if (f === 3) corridor(258, 300, 276, 300);

    for (const [bid, b] of Object.entries(H.buildings)) {
      const [x, y, w, h] = b.rect;
      const has = b.floors.includes(f);
      const g = el("g", { class: has ? "bld" : "bld off" }, svg);
      el("rect", { x, y, width: w, height: h, rx: 10 }, g);
      el("text", { x: x + 8, y: y + 14, class: "bname" }, g, b.name + (b.sub && w > 100 ? ` ${b.sub}` : ""));
      if (!has) continue;
      el("rect", { x: b.core[0] - 13, y: b.core[1] - 9, width: 26, height: 18, rx: 4, class: "core" }, g);
      el("text", { x: b.core[0], y: b.core[1] + 4, class: "coretxt" }, g, "EV");
    }
    if (f === 2 || f === 3) {
      el("rect", { x: 210, y: f === 3 ? 202 : 203, width: 24, height: 16, rx: 4, class: "esc" }, svg);
      el("text", { x: 222, y: f === 3 ? 214 : 215, class: "coretxt esctxt" }, svg, "ESC");
    }

    for (const p of places) {
      if (p.f !== f || p.id === "deck") continue;
      const t = tiles[p.id];
      const cls = p.id === src ? "tile from" : p.id === dst ? "tile to" : "tile";
      const g = el("g", { class: cls }, svg);
      el("rect", { x: t.x, y: t.y, width: t.w, height: t.h, rx: 6 }, g);
      const label = p.short || p.name;
      const fs = Math.min(11, (t.w - 6) / Math.max(label.length, 1) * 1.05, t.h * 0.55);
      el("text", { x: t.cx, y: t.cy + fs * 0.36, "font-size": fs.toFixed(1) }, g, label);
      el("title", {}, g, p.name);
    }
    if (f === 3) {
      const cls = src === "deck" ? "tile from" : dst === "deck" ? "tile to" : "tile";
      const t = tiles.deck;
      const g = el("g", { class: cls }, svg);
      el("rect", { x: t.x, y: t.y, width: t.w, height: t.h, rx: 6 }, g);
      el("text", { x: t.cx, y: t.cy + 3.5, "font-size": 10 }, g, "駅方面");
    }

    for (const r of runs) {
      if (r.pts.length < 2) continue;
      const d = r.pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      el("path", { d, class: "route-bg" }, svg);
      el("path", { d, class: "route" }, svg);
    }
    for (const r of runs) {
      if (r.enter) {
        const n = nodes[r.enter.node];
        el("circle", { cx: n.x, cy: n.y, r: 7, class: "transfer" }, svg);
      }
      if (r.exit) {
        const n = nodes[r.exit.node];
        el("circle", { cx: n.x, cy: n.y, r: 7, class: "transfer" }, svg);
        const nf = state.floors[state.floors.indexOf(f) + 1];
        if (nf) {
          const g = el("g", { class: "badge" }, svg);
          const bx = Math.min(n.x + 10, 380), by = n.y - 26;
          el("rect", { x: bx, y: by, width: 44, height: 18, rx: 9 }, g);
          el("text", { x: bx + 22, y: by + 12.5 }, g, `${nf}階へ`);
        }
      }
    }
    const pin = (id, cls) => {
      const p = placeById[id];
      if (!p || p.f !== f) return;
      const t = tiles[id];
      el("circle", { cx: t.cx, cy: t.cy, r: 5, class: "pin " + cls }, svg);
    };
    pin(src, "from"); pin(dst, "to");
  }

  /* ---------- イベント ---------- */
  fromSel.addEventListener("change", () => update());
  toSel.addEventListener("change", () => update());
  bf.addEventListener("change", () => update());
  $("swap").addEventListener("click", () => {
    const a = fromSel.value; fromSel.value = toSel.value; toSel.value = a; update();
  });
  $("share").addEventListener("click", async () => {
    const btn = $("share");
    try { await navigator.clipboard.writeText(location.href); btn.textContent = "コピーしました"; }
    catch { prompt("このリンクをコピーしてください", location.href); }
    setTimeout(() => (btn.textContent = "この経路のリンクをコピー"), 2000);
  });

  // URL パラメータ（?from=deck&to=reception&bf=1）
  const q = new URLSearchParams(location.search);
  fromSel.value = placeById[q.get("from")] ? q.get("from") : "deck";
  if (placeById[q.get("to")]) toSel.value = q.get("to");
  bf.checked = q.get("bf") === "1";
  update(false);
})();
