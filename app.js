(() => {
  "use strict";
  const H = window.HOSPITAL;
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";

  const WALK_MPS = 0.9;      // ゆっくり歩く速さ（m/秒）
  const EV_WAIT = 40;        // エレベーター待ち時間（秒）
  const EV_PER_FLOOR = 8;    // 1階あたり（秒）
  const ESC_PER_FLOOR = 25;  // エスカレーター（秒）

  const places = H.places.slice();
  H.amenities.forEach((a, i) => places.push({
    id: `am_${a.kind}_${i}`, name: H.amenityNames[a.kind], f: a.f, at: a.at, amenity: a.kind, group: "設備"
  }));
  const placeById = Object.fromEntries(places.map((p) => [p.id, p]));
  const purposeById = Object.fromEntries(H.purposes.map((p) => [p.id, p]));
  const liftById = Object.fromEntries(H.lifts.map((l) => [l.id, l]));

  /* ---------- グラフ ---------- */
  const nodes = {}; // id -> {f, x, y, lift?}
  const adj = {};
  const addNode = (id, n) => { nodes[id] = n; adj[id] = adj[id] || []; };
  const addEdge = (a, b, cost) => { adj[a].push({ to: b, cost }); adj[b].push({ to: a, cost }); };
  const walkSec = (a, b) => (Math.hypot(a.x - b.x, a.y - b.y) * H.metersPerPx) / WALK_MPS;

  for (const [f, list] of Object.entries(H.nodes)) {
    for (const [name, [x, y]] of Object.entries(list)) addNode(`${f}:${name}`, { f: +f, x, y });
  }
  for (const [f, chains] of Object.entries(H.paths)) {
    for (const chain of chains) {
      const ids = chain.split("-").map((n) => `${f}:${n}`);
      for (let i = 0; i < ids.length - 1; i++) {
        if (!nodes[ids[i]] || !nodes[ids[i + 1]]) throw new Error("unknown node " + ids[i] + " / " + ids[i + 1]);
        addEdge(ids[i], ids[i + 1], walkSec(nodes[ids[i]], nodes[ids[i + 1]]));
      }
    }
  }
  // エレベーター・エスカレーター：乗り場ノード ⇔ かご内ノード（待ち時間は乗るときだけ）
  for (const l of H.lifts) {
    for (const f of l.floors) {
      const hall = `${f}:${l.id}`, car = `L:${l.id}:${f}`;
      addNode(car, { f, x: nodes[hall].x, y: nodes[hall].y, lift: l.id });
      addEdge(hall, car, l.kind === "ev" ? EV_WAIT / 2 : 2);
    }
    for (let i = 0; i < l.floors.length - 1; i++) {
      const f1 = l.floors[i], f2 = l.floors[i + 1];
      addEdge(`L:${l.id}:${f1}`, `L:${l.id}:${f2}`, (f2 - f1) * (l.kind === "ev" ? EV_PER_FLOOR : ESC_PER_FLOOR));
    }
  }
  // 施設を最寄りの通路ノードにつなぐ（via 指定があればそれを使う）
  function nearestNode(f, x, y) {
    let best = null, bd = Infinity;
    for (const [id, n] of Object.entries(nodes)) {
      if (n.f !== f || n.lift || n.place) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = id; }
    }
    return { id: best, dist: bd };
  }
  function attachPlace(p) {
    const id = "p:" + p.id;
    if (nodes[id]) { // 付け直し
      for (const e of adj[id]) adj[e.to] = adj[e.to].filter((x) => x.to !== id);
      adj[id] = [];
    }
    addNode(id, { f: p.f, x: p.at[0], y: p.at[1], place: p.id });
    const via = p.via ? `${p.f}:${p.via}` : nearestNode(p.f, p.at[0], p.at[1]).id;
    addEdge(id, via, walkSec(nodes[id], nodes[via]));
  }
  places.forEach(attachPlace);

  function shortest(src, dst, barrierFree) {
    const d = { [src]: 0 }, prev = {}, done = new Set();
    for (;;) {
      let u = null, best = Infinity;
      for (const k in d) if (!done.has(k) && d[k] < best) { best = d[k]; u = k; }
      if (u === null || u === dst) break;
      done.add(u);
      for (const e of adj[u]) {
        const t = nodes[e.to];
        if (barrierFree && t.lift && liftById[t.lift].kind === "esc") continue;
        if (t.place && e.to !== dst) continue; // 他の施設の中は通り抜けない
        const nd = d[u] + e.cost;
        if (nd < (d[e.to] ?? Infinity)) { d[e.to] = nd; prev[e.to] = u; }
      }
    }
    if (!(dst in d)) return null;
    const path = [dst];
    while (path[0] !== src) path.unshift(prev[path[0]]);
    return { sec: d[dst], path };
  }

  /* ---------- 経路を階ごとに分ける ---------- */
  function splitRuns(path) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < path.length; i++) {
      const id = path[i], n = nodes[id];
      if (n.lift) {
        // かご内：乗った階と降りた階を記録
        if (cur && !cur.exit) cur.exit = { lift: n.lift, from: n.f };
        continue;
      }
      if (!cur || cur.f !== n.f || cur.exit) {
        const enter = cur && cur.exit ? { lift: cur.exit.lift } : null;
        if (cur && cur.exit) cur.exit.to = n.f;
        cur = { f: n.f, pts: [], ids: [], enter };
        runs.push(cur);
      }
      cur.pts.push([n.x, n.y]);
      cur.ids.push(id);
    }
    return runs;
  }

  /* ---------- 文言 ---------- */
  function areaAt(f, x, y) {
    if (x < 880) return f === 2 && y < 380 ? "6号館" : "1号館";
    if (f === 2 && x > 1735) return "3号館";
    return "2号館";
  }
  const placeLabel = (p) => {
    if (p.outside) return `${p.name}（${p.outside}）`;
    const area = p.area || areaAt(p.f, p.at[0], p.at[1]);
    return `${p.name}（${area === "3階" ? "" : area + " "}${p.f}階）`;
  };

  function buildSteps(runs, from, to) {
    const steps = [{ kind: "start", f: from.f, text: `<b>${from.name}</b>（${from.f}階）を出発` }];
    const purpose = state.purpose;
    runs.forEach((r, i) => {
      const areas = [];
      for (const [x, y] of r.pts) {
        const a = areaAt(r.f, x, y);
        if (areas[areas.length - 1] !== a) areas.push(a);
      }
      const cross = areas.length > 1 ? `${areas[0]}から連絡通路を通って${areas[areas.length - 1]}側へ進み、` : "";
      if (r.exit) {
        const l = liftById[r.exit.lift];
        if (r.pts.length > 1) steps.push({ kind: "walk", f: r.f, text: `${r.f}階：${cross}<b>${l.name}</b>へ` });
        const up = r.exit.to > r.f;
        steps.push({
          kind: l.kind, f: r.f,
          text: l.kind === "esc"
            ? `エスカレーターで <b>${r.exit.to}階</b> へ${up ? "上がる" : "下りる"}`
            : `${l.name}で <b>${r.exit.to}階</b> へ`
        });
      } else if (i === runs.length - 1) {
        const lead = r.enter ? `${r.f}階で降りたら、` : `${r.f}階：`;
        if (to.outside) {
          steps.push({ kind: "walk", f: r.f, text: `${lead}${cross}<b>駅デッキ側の中央出入口</b>へ` });
          steps.push({ kind: "walk", f: r.f, text: `出入口からデッキに出て、右手の <b>${to.outside}</b> へ（7号館は公式マップ未掲載のため推定）` });
        } else if (r.pts.length > 1) {
          steps.push({ kind: "walk", f: r.f, text: `${lead}${cross}<b>${to.name}</b>へ` });
        }
      }
    });
    steps.push({ kind: "goal", f: to.f, text: `<b>${placeLabel(to)}</b> に到着${purpose && purpose.note ? `<br><small>${purpose.note}</small>` : ""}` });
    return steps;
  }

  /* ---------- UI ---------- */
  const fromSel = $("from"), toSel = $("to"), bf = $("bf");

  function addGroup(sel, label, items) {
    const og = document.createElement("optgroup");
    og.label = label;
    for (const [value, text] of items) {
      const op = document.createElement("option");
      op.value = value; op.textContent = text;
      og.appendChild(op);
    }
    sel.appendChild(og);
  }
  function fillSelect(sel, withPurpose) {
    sel.innerHTML = '<option value="">選んでください</option>';
    if (!withPurpose) {
      const here = document.createElement("option");
      here.value = "here"; here.textContent = "地図で選んだ場所"; here.hidden = true; here.id = "hereopt";
      sel.appendChild(here);
    }
    if (withPurpose) addGroup(sel, "目的から選ぶ", H.purposes.map((p) => ["goal:" + p.id, p.name]));
    const label = (p) => (p.group === "入口" || p.outside ? p.name : `${p.name}　${p.f}階`);
    addGroup(sel, "入口（3階）", places.filter((p) => p.group === "入口").map((p) => [p.id, label(p)]));
    for (const f of Object.keys(H.floors).map(Number)) {
      const list = places.filter((p) => p.f === f && !p.group);
      if (list.length) addGroup(sel, `${f}階`, list.map((p) => [p.id, label(p)]));
    }
    addGroup(sel, "病棟", places.filter((p) => p.group === "病棟").map((p) => [p.id, label(p)]));
    addGroup(sel, "7号館（管理棟）", places.filter((p) => p.group === "7号館（管理棟）").map((p) => [p.id, label(p)]));
  }
  fillSelect(fromSel, false);
  fillSelect(toSel, true);

  const chips = $("chips");
  for (const id of H.quick) {
    const p = purposeById[id];
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.id = "goal:" + id;
    b.textContent = p.short || p.name;
    b.addEventListener("click", () => { toSel.value = "goal:" + id; update(); });
    chips.appendChild(b);
  }

  let state = { floors: [], runs: [], src: null, dst: null, zoom: true, cur: 0 };

  function update(pushUrl = true) {
    const a = fromSel.value, b = toSel.value;
    for (const c of chips.children) c.classList.toggle("on", c.dataset.id === b);
    if (pushUrl) {
      const q = new URLSearchParams();
      if (a) q.set("from", a);
      if (a === "here") { q.set("hf", placeById.here.f); q.set("hx", placeById.here.at[0]); q.set("hy", placeById.here.at[1]); }
      if (b) q.set("to", b);
      if (bf.checked) q.set("bf", "1");
      history.replaceState(null, "", q.toString() ? "?" + q : location.pathname);
    }
    if (!a || !b) { $("result").hidden = true; $("empty").hidden = false; return; }
    $("empty").hidden = true; $("result").hidden = false;

    // 目的が選ばれたら、候補の中でいちばん近い場所を行き先にする
    let purpose = null, dstId = b;
    if (b.startsWith("goal:")) {
      purpose = purposeById[b.slice(5)];
      const cands = purpose.amenity ? places.filter((p) => p.amenity === purpose.amenity).map((p) => p.id) : purpose.targets;
      let best = null;
      for (const c of cands) {
        if (c === a) { best = { id: c, sec: 0 }; break; }
        const r = shortest("p:" + a, "p:" + c, bf.checked);
        if (r && (!best || r.sec < best.sec)) best = { id: c, sec: r.sec };
      }
      dstId = best ? best.id : cands[0];
    }
    state.purpose = purpose;
    const from = placeById[a], to = placeById[dstId];
    if (a === dstId || (from.at[0] === to.at[0] && from.at[1] === to.at[1] && from.f === to.f)) {
      $("summary").innerHTML = `<p class="same">出発地と目的地が同じ場所です。</p>`;
      $("steps").innerHTML = "";
      state = { ...state, floors: [from.f], runs: [], src: a, dst: dstId };
      renderTabs(); selectFloor(0);
      return;
    }
    const res = shortest("p:" + a, "p:" + dstId, bf.checked);
    if (!res) {
      $("summary").innerHTML = `<p class="same">経路が見つかりませんでした。</p>`;
      $("steps").innerHTML = ""; $("tabs").innerHTML = ""; $("map").innerHTML = "";
      return;
    }
    const runs = splitRuns(res.path);
    const floors = [];
    for (const r of runs) if (!floors.includes(r.f)) floors.push(r.f);
    state = { ...state, floors, runs, src: a, dst: dstId };

    const min = Math.max(1, Math.round(res.sec / 60));
    const rides = runs.filter((r) => r.exit).length;
    $("summary").innerHTML =
      `<div class="time"><span class="num">約${min}</span><span class="unit">分</span></div>` +
      `<div class="meta">${purpose ? `<span class="dest">${purpose.short} → ${placeLabel(to)}</span>` : ""}<span class="fl">${floors.map((f) => f + "階").join(" → ")}</span>` +
      `<span>${rides ? `エレベーター等 ${rides}回` : "同じ階で移動"}${bf.checked ? "（エレベーターのみ）" : ""}</span>` +
      `<span class="est">所要時間はゆっくり歩いた場合の目安です</span></div>`;

    const steps = buildSteps(runs, from, to);
    const icons = { start: "出", goal: "着", walk: "→", ev: "EV", esc: "ES" };
    $("steps").innerHTML = steps.map((s) =>
      `<li class="${s.kind}" data-f="${s.f}"><span class="ic">${icons[s.kind]}</span><span>${s.text}</span></li>`).join("");
    for (const li of $("steps").children) {
      li.addEventListener("click", () => {
        const i = state.floors.indexOf(+li.dataset.f);
        if (i >= 0) selectFloor(i);
      });
    }
    renderTabs();
    selectFloor(0);
  }

  function renderTabs() {
    const t = $("tabs");
    t.innerHTML = "";
    state.floors.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab");
      b.innerHTML = `${i ? '<span class="arrow">›</span>' : ""}${f}階`;
      b.addEventListener("click", () => selectFloor(i));
      t.appendChild(b);
    });
  }

  function selectFloor(i) {
    state.cur = i;
    [...$("tabs").children].forEach((b, j) => {
      b.classList.toggle("on", i === j);
      b.setAttribute("aria-selected", String(i === j));
    });
    const f = state.floors[i];
    [...$("steps").children].forEach((li) => li.classList.toggle("cur", +li.dataset.f === f));
    $("prev").disabled = i === 0;
    $("next").disabled = i >= state.floors.length - 1;
    drawFloor(f);
  }

  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawFloor(f) {
    const svg = $("map");
    const fl = H.floors[f];
    svg.innerHTML = "";
    el("image", { href: fl.img, x: 0, y: 0, width: fl.w, height: fl.h }, svg);

    const runs = state.runs.filter((r) => r.f === f);
    const from = placeById[state.src], to = placeById[state.dst];
    const box = [];

    for (const r of runs) {
      if (r.pts.length < 2) continue;
      const d = r.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
      el("path", { d, class: "route-bg" }, svg);
      el("path", { d, class: "route" }, svg);
      box.push(...r.pts);
    }
    const marker = (x, y, text, cls) => {
      const g = el("g", { class: "badge " + cls }, svg);
      const w = text.length * 25 + 34;
      const bx = Math.max(6, Math.min(fl.w - w - 6, x - w / 2)), by = Math.max(6, y - 92);
      el("rect", { x: bx, y: by, width: w, height: 50, rx: 25 }, g);
      el("text", { x: bx + w / 2, y: by + 34 }, g, text);
      box.push([bx, by], [bx + w, by + 50]);
    };
    for (const r of runs) {
      if (r.enter) {
        const [x, y] = r.pts[0];
        el("circle", { cx: x, cy: y, r: 20, class: "lift" }, svg);
        marker(x, y, `${liftById[r.enter.lift].kind === "esc" ? "ESC" : "EV"}を降りる`, "sub");
      }
      if (r.exit) {
        const [x, y] = r.pts[r.pts.length - 1];
        el("circle", { cx: x, cy: y, r: 20, class: "lift" }, svg);
        marker(x, y, `${liftById[r.exit.lift].kind === "esc" ? "ESC" : "EV"}で${r.exit.to}階へ`, "main");
      }
    }
    const pin = (p, cls, label) => {
      if (!p || p.f !== f) return;
      const [x, y] = p.at;
      const g = el("g", { class: "pin " + cls, transform: `translate(${x} ${y})` }, svg);
      el("circle", { r: 34, class: "halo" }, g);
      el("circle", { r: 20 }, g);
      el("text", { y: 9 }, g, label);
      box.push([x - 60, y - 60], [x + 60, y + 60]);
    };
    pin(from, "from", "出");
    pin(to, "to", "着");

    // 表示範囲：経路に寄る or 全体
    let vb = [0, 0, fl.w, fl.h];
    if (state.zoom && box.length) {
      let x1 = Math.min(...box.map((p) => p[0])), x2 = Math.max(...box.map((p) => p[0]));
      let y1 = Math.min(...box.map((p) => p[1])), y2 = Math.max(...box.map((p) => p[1]));
      const pad = 110, aspect = 4 / 3;
      let w = Math.max(x2 - x1 + pad * 2, 760), h = Math.max(y2 - y1 + pad * 2, 570);
      if (w / h > aspect) h = w / aspect; else w = h * aspect;
      w = Math.min(w, fl.w); h = Math.min(h, fl.h);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      vb = [Math.max(0, Math.min(fl.w - w, cx - w / 2)), Math.max(0, Math.min(fl.h - h, cy - h / 2)), w, h];
    }
    svg.setAttribute("viewBox", vb.map((v) => Math.round(v)).join(" "));
    $("floorname").textContent = `${f}階`;
    $("zoom").textContent = state.zoom ? "フロア全体を見る" : "経路に寄る";
  }

  /* ---------- イベント ---------- */
  fromSel.addEventListener("change", () => update());
  toSel.addEventListener("change", () => update());
  bf.addEventListener("change", () => update());
  $("swap").addEventListener("click", () => {
    const a = fromSel.value; fromSel.value = toSel.value; toSel.value = a; update();
  });
  $("zoom").addEventListener("click", () => { state.zoom = !state.zoom; drawFloor(state.floors[state.cur]); });
  $("prev").addEventListener("click", () => selectFloor(Math.max(0, state.cur - 1)));
  $("next").addEventListener("click", () => selectFloor(Math.min(state.floors.length - 1, state.cur + 1)));
  $("share").addEventListener("click", async () => {
    const btn = $("share");
    try { await navigator.clipboard.writeText(location.href); btn.textContent = "コピーしました"; }
    catch { prompt("このリンクをコピーしてください", location.href); }
    setTimeout(() => (btn.textContent = "この経路のリンクをコピー"), 2000);
  });

  /* ---------- 地図から現在地を選ぶ ---------- */
  const pick = { f: 3, pt: null };
  function setHere(f, x, y, name) {
    const p = { id: "here", name: name || "地図で選んだ場所", f, at: [Math.round(x), Math.round(y)] };
    placeById.here = p;
    attachPlace(p);
    const op = $("hereopt");
    op.hidden = false; op.textContent = `${p.name}（${f}階）`;
    fromSel.value = "here";
  }
  function drawPick() {
    const svg = $("pickmap"), fl = H.floors[pick.f];
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${fl.w} ${fl.h}`);
    el("image", { href: fl.img, x: 0, y: 0, width: fl.w, height: fl.h }, svg);
    if (pick.pt) {
      const g = el("g", { class: "pin from", transform: `translate(${pick.pt.x} ${pick.pt.y})` }, svg);
      el("circle", { r: 40, class: "halo" }, g);
      el("circle", { r: 22 }, g);
      el("text", { y: 9 }, g, "今");
    }
    [...$("picktabs").children].forEach((b) => b.classList.toggle("on", +b.dataset.f === pick.f));
  }
  function openPick() {
    const cur = placeById[fromSel.value];
    pick.f = cur ? cur.f : 3;
    pick.pt = null;
    $("pickinfo").textContent = "いまいる場所を地図上でタップしてください。";
    $("pickok").disabled = true;
    $("mappick").hidden = false;
    drawPick();
    $("mappick").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const pt = $("picktabs");
  for (const f of Object.keys(H.floors).map(Number)) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.f = f; b.textContent = `${f}階`;
    b.addEventListener("click", () => { pick.f = f; pick.pt = null; $("pickok").disabled = true; $("pickinfo").textContent = "いまいる場所を地図上でタップしてください。"; drawPick(); });
    pt.appendChild(b);
  }
  $("pickmap").addEventListener("click", (ev) => {
    const svg = $("pickmap");
    const m = svg.getScreenCTM().inverse();
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
    const near = nearestNode(pick.f, p.x, p.y);
    if (near.dist > 260) {
      $("pickinfo").textContent = "建物の外のようです。廊下や部屋の近くをタップしてください。";
      $("pickok").disabled = true; pick.pt = null; drawPick();
      return;
    }
    // 施設の近くなら施設名を出す
    let snap = null, sd = 70;
    for (const pl of places) {
      if (pl.f !== pick.f || pl.outside || pl.id === "here") continue;
      const d = Math.hypot(pl.at[0] - p.x, pl.at[1] - p.y);
      if (d < sd) { sd = d; snap = pl; }
    }
    pick.pt = { x: p.x, y: p.y, snap };
    $("pickinfo").innerHTML = snap
      ? `<b>${placeLabel(snap)}</b> の近く`
      : `${pick.f}階・${areaAt(pick.f, p.x, p.y)}のこのあたり`;
    $("pickok").disabled = false;
    drawPick();
  });
  $("pickbtn").addEventListener("click", openPick);
  $("pickclose").addEventListener("click", () => { $("mappick").hidden = true; });
  $("pickok").addEventListener("click", () => {
    const { x, y, snap } = pick.pt;
    if (snap && !snap.amenity) fromSel.value = snap.id;
    else setHere(pick.f, x, y, snap ? `${snap.name}の近く` : `${pick.f}階 ${areaAt(pick.f, x, y)}付近`);
    $("mappick").hidden = true;
    update();
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // URL パラメータ（?from=deck&to=goal:blood&bf=1、地図で選んだ現在地は from=here&hf=3&hx=..&hy=..）
  const q = new URLSearchParams(location.search);
  if (q.get("from") === "here" && H.floors[q.get("hf")]) setHere(+q.get("hf"), +q.get("hx"), +q.get("hy"));
  else fromSel.value = placeById[q.get("from")] ? q.get("from") : "deck";
  const qt = q.get("to") || "";
  if (placeById[qt] || purposeById[qt.replace(/^goal:/, "")]) toSel.value = qt;
  bf.checked = q.get("bf") === "1";
  update(false);
})();
