/*
 * ストリートビュー風ウォークスルー
 * - 各階のフロアマップ画像から廊下（ベージュ色）を読み取り、廊下の縁に壁を立てて院内を立体化する
 * - 経路に沿って視点（約3mごと）を並べ、「進む／戻る」で歩いて確認できる
 * - イラストがある施設の近くでは、そのイラストをカードで表示する
 * three.js r128（vendor/）を使用。
 */
(() => {
  "use strict";
  const M = 0.12;          // 画像1px = 0.12m（data.js と同じ想定）
  const CELL = 7;          // 壁を判定するマス目（px）
  const WALL_H = 2.8, EYE = 1.55, STEP_M = 3;
  const BEIGE = [249, 244, 229];

  let renderer, scene, camera, raf, root, hud, opts;
  let views = [], idx = 0, yaw = 0, pitch = -0.05, tween = null, autoTimer = null;
  const floorCache = {};

  /* ---------- フロアマップ画像 → 壁 ---------- */
  function loadImage(src) {
    return new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = src; });
  }
  async function analyzeFloor(f) {
    if (floorCache[f]) return floorCache[f];
    const fl = opts.H.floors[f];
    const img = await loadImage(fl.img);
    const c = document.createElement("canvas");
    c.width = fl.w; c.height = fl.h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, fl.w, fl.h).data;
    const px = (x, y) => { const i = (Math.min(fl.h - 1, y) * fl.w + Math.min(fl.w - 1, x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const isBeige = (p) => Math.abs(p[0] - BEIGE[0]) < 5 && Math.abs(p[1] - BEIGE[1]) < 5 && Math.abs(p[2] - BEIGE[2]) < 6;
    const cols = Math.ceil(fl.w / CELL), rows = Math.ceil(fl.h / CELL);
    const walk = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      // マスの5点のうち3点以上がベージュなら廊下
      const x = q * CELL, y = r * CELL, h = CELL >> 1;
      let n = 0;
      for (const [dx, dy] of [[h, h], [1, 1], [CELL - 2, 1], [1, CELL - 2], [CELL - 2, CELL - 2]]) if (isBeige(px(x + dx, y + dy))) n++;
      walk[r * cols + q] = n >= 3 ? 1 : 0;
    }
    fillHoles(walk, cols, rows);
    floorCache[f] = { fl, img, px, cols, rows, walk };
    return floorCache[f];
  }

  // 廊下の中の文字やアイコンで空いた小さな穴（=柱のような壁）を埋める
  function fillHoles(walk, cols, rows) {
    const seen = new Uint8Array(cols * rows);
    for (let start = 0; start < walk.length; start++) {
      if (walk[start] || seen[start]) continue;
      const comp = [start]; seen[start] = 1;
      let touchesEdge = false;
      for (let k = 0; k < comp.length && comp.length <= 40; k++) {
        const c = comp[k], q = c % cols, r = (c / cols) | 0;
        if (q === 0 || r === 0 || q === cols - 1 || r === rows - 1) touchesEdge = true;
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nq = q + dq, nr = r + dr;
          if (nq < 0 || nr < 0 || nq >= cols || nr >= rows) continue;
          const n = nr * cols + nq;
          if (!walk[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
        }
      }
      if (comp.length <= 40 && !touchesEdge) for (const c of comp) walk[c] = 1;
    }
  }

  // 経路の通り道は（部屋の中や待合も）歩けるようにくり抜く
  function carve(info, pts) {
    const { cols, rows, walk } = info;
    const rad = 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (CELL / 2)));
      for (let k = 0; k <= n; k++) {
        const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n;
        const q0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
        for (let r = r0 - rad; r <= r0 + rad; r++) for (let q = q0 - rad; q <= q0 + rad; q++) {
          if (r >= 0 && q >= 0 && r < rows && q < cols) walk[r * cols + q] = 2;
        }
      }
    }
  }

  function buildWalls(info) {
    const { cols, rows, walk, px } = info;
    const segs = []; // [x, y, w, h, color] 画像px単位、厚み方向は薄く
    const isW = (q, r) => q >= 0 && r >= 0 && q < cols && r < rows && walk[r * cols + q] > 0;
    const colorAt = (q, r) => {
      const p = px(Math.max(0, q) * CELL + (CELL >> 1), Math.max(0, r) * CELL + (CELL >> 1));
      // 部屋の色を少し濃くして壁色にする（白・灰は落ち着いたベージュグレーに）
      const lum = (p[0] + p[1] + p[2]) / 3;
      if (lum > 240) return [226, 223, 216];
      if (lum < 120) return [214, 220, 226]; // 文字やアイコンの色は拾わない
      return p.map((v) => Math.round(v * 0.55 + 255 * 0.45 - 18));
    };
    // 横向きの壁（上下に廊下でないマスがある辺）を連結
    for (let r = 0; r <= rows; r++) {
      for (const side of [-1, 1]) {
        let start = -1, col = null;
        for (let q = 0; q <= cols; q++) {
          const edge = q < cols && isW(q, r) && !isW(q, r + side);
          if (edge && start < 0) { start = q; col = colorAt(q, r + side); }
          if (!edge && start >= 0) {
            const y = (side < 0 ? r : r + 1) * CELL;
            segs.push([start * CELL, y, (q - start) * CELL, 0, col]);
            start = -1;
          }
        }
      }
    }
    for (let q = 0; q <= cols; q++) {
      for (const side of [-1, 1]) {
        let start = -1, col = null;
        for (let r = 0; r <= rows; r++) {
          const edge = r < rows && isW(q, r) && !isW(q + side, r);
          if (edge && start < 0) { start = r; col = colorAt(q + side, r); }
          if (!edge && start >= 0) {
            const x = (side < 0 ? q : q + 1) * CELL;
            segs.push([x, start * CELL, 0, (r - start) * CELL, col]);
            start = -1;
          }
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, segs.length);
    const m = new THREE.Matrix4(), color = new THREE.Color();
    segs.forEach(([x, y, w, h, c], i) => {
      const t = 0.12;
      const sx = w ? w * M : t, sz = h ? h * M : t;
      m.makeScale(sx, WALL_H, sz);
      m.setPosition((x + w / 2) * M, WALL_H / 2, (y + h / 2) * M);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  // 施設のイラスト（maps/illust/）
  function photosOf(p) {
    const list = (opts.H.illust || {})[p.id];
    return list ? list.map((n) => opts.H.illustBase + n) : null;
  }
  // 7号館の施設は案内の終点（入口）に置いてあるので、行き先のときだけ出す
  const shown = (p) => !p.outside || p.id === (opts.to && opts.to.id);

  /* ---------- 看板・写真 ---------- */
  function signSprite(text, bg) {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const fs = 44;
    g.font = `bold ${fs}px "BIZ UDPGothic", "Hiragino Sans", sans-serif`;
    const w = Math.min(900, g.measureText(text).width + 60);
    c.width = w; c.height = 84;
    g.fillStyle = bg; g.fillRect(0, 0, w, 84);
    g.fillStyle = "#fff"; g.font = `bold ${fs}px "BIZ UDPGothic", "Hiragino Sans", sans-serif`;
    g.textBaseline = "middle"; g.fillText(text, 30, 44, w - 60);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(w / 84 * 0.7, 0.7, 1);
    sp.renderOrder = 10;
    sp.userData.sign = true;
    return sp;
  }
  async function buildFloor(f) {
    const info = await analyzeFloor(f);
    const { fl, img } = info;
    const routePts = opts.runs.filter((r) => r.f === f).flatMap((r) => r.pts);
    const saved = info.walk.slice();
    carve(info, routePts);
    const group = new THREE.Group();

    // 床：フロアマップそのもの
    const tex = new THREE.Texture(img); tex.needsUpdate = true;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fl.w * M, fl.h * M), new THREE.MeshBasicMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(fl.w * M / 2, 0, fl.h * M / 2);
    group.add(floor);
    // 天井
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fl.w * M, fl.h * M), new THREE.MeshBasicMaterial({ color: 0xf3f3f0, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(fl.w * M / 2, WALL_H, fl.h * M / 2);
    group.add(ceil);
    group.add(buildWalls(info));
    info.walk.set(saved);

    // 看板（施設名）と写真
    for (const p of opts.places) {
      if (p.f !== f || !shown(p)) continue;
      const s = signSprite(p.short || p.name.replace(/（.*?）$/, ""), p.id === opts.to?.id ? "#e72510" : "#004f80");
      s.position.set(p.at[0] * M, 2.35, p.at[1] * M);
      group.add(s);
    }
    for (const l of opts.H.lifts) {
      const n = opts.H.nodes[f] && opts.H.nodes[f][l.id];
      if (!n || !l.floors.includes(f)) continue;
      const s = signSprite(l.kind === "esc" ? "エスカレーター" : l.name.replace(/^\d号館 /, ""), "#4b5a58");
      s.position.set(n[0] * M, 2.35, n[1] * M);
      group.add(s);
    }
    // 経路（床に赤い線）
    for (const r of opts.runs.filter((r) => r.f === f)) {
      if (r.pts.length < 2) continue;
      const path = new THREE.CurvePath();
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = new THREE.Vector3(r.pts[i][0] * M, 0.03, r.pts[i][1] * M), b = new THREE.Vector3(r.pts[i + 1][0] * M, 0.03, r.pts[i + 1][1] * M);
        if (a.distanceTo(b) > 1e-3) path.add(new THREE.LineCurve3(a, b));
      }
      if (!path.curves.length) continue;
      group.add(new THREE.Mesh(new THREE.TubeGeometry(path, path.curves.length * 16, 0.12, 6, false), new THREE.MeshBasicMaterial({ color: 0xe72510 })));
    }
    return group;
  }

  /* ---------- 視点の列 ---------- */
  function makeViews(runs) {
    const out = [];
    runs.forEach((r, ri) => {
      const pts = r.pts;
      const seq = [];
      if (pts.length === 1) seq.push(pts[0]);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const d = Math.hypot(x2 - x1, y2 - y1) * M;
        const n = Math.max(1, Math.round(d / STEP_M));
        for (let k = 0; k < n; k++) seq.push([x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n]);
      }
      if (pts.length > 1) seq.push(pts[pts.length - 1]);
      seq.forEach((p, i) => {
        const nxt = seq[i + 1] || seq[i - 1] && [2 * p[0] - seq[i - 1][0], 2 * p[1] - seq[i - 1][1]] || [p[0], p[1] - 1];
        const heading = Math.atan2(nxt[0] - p[0], nxt[1] - p[1]);
        out.push({ f: r.f, x: p[0], y: p[1], heading, run: ri, last: i === seq.length - 1 });
      });
    });
    return out;
  }

  /* ---------- 表示 ---------- */
  let curFloor = null, floorGroup = null;
  async function showFloor(f) {
    if (curFloor === f) return;
    curFloor = f;
    hud.querySelector(".w-floor").textContent = `${f}F`;
    if (floorGroup) { scene.remove(floorGroup); }
    floorGroup = await buildFloor(f);
    scene.add(floorGroup);
  }
  function camAt(v) { camera.position.set(v.x * M, EYE, v.y * M); }
  function look() {
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(camera.position.clone().add(dir));
  }

  function stepText(v) {
    const r = opts.runs[v.run];
    if (v.last && r.exit) {
      const l = opts.H.lifts.find((x) => x.id === r.exit.lift);
      return `${l.kind === "esc" ? "エスカレーター" : l.name}で ${r.exit.to}階へ`;
    }
    if (v === views[views.length - 1]) return `到着：${opts.to.name}`;
    if (v === views[0]) return `出発：${opts.from.name}`;
    return `${v.f}階を進んでいます`;
  }

  function updateHud() {
    const v = views[idx];
    hud.querySelector(".w-step").textContent = stepText(v);
    hud.querySelector(".w-bar i").style.width = `${(idx / Math.max(1, views.length - 1)) * 100}%`;
    hud.querySelector(".w-prev").disabled = idx === 0;
    hud.querySelector(".w-next").disabled = idx >= views.length - 1;
    // 近くに写真がある施設はカードで表示
    const card = hud.querySelector(".w-photo");
    let near = null;
    for (const p of opts.places) {
      const ph = photosOf(p);
      if (!ph || p.f !== v.f || !shown(p)) continue;
      if (Math.hypot(p.at[0] - v.x, p.at[1] - v.y) * M < 9) { near = { p, ph }; break; }
    }
    if (near) {
      const img = card.querySelector("img");
      img.onerror = () => { card.hidden = true; };
      img.onload = () => { card.hidden = false; };
      img.src = near.ph[(idx >> 1) % near.ph.length];
      card.querySelector("figcaption").textContent = `${near.p.name}（イメージ）`;
    } else card.hidden = true;
  }

  async function go(i, animate = true) {
    i = Math.max(0, Math.min(views.length - 1, i));
    const v = views[i];
    idx = i;
    if (curFloor !== v.f) {
      const fade = hud.querySelector(".w-fade");
      const moving = curFloor !== null;
      if (moving) {
        fade.textContent = `${v.f}階へ移動中…`;
        fade.classList.add("on");
        await new Promise((ok) => setTimeout(ok, 450));
      }
      await showFloor(v.f);
      camAt(v); yaw = v.heading; look();
      if (moving) setTimeout(() => fade.classList.remove("on"), 150);
      tween = null;
    } else if (animate) {
      tween = { from: camera.position.clone(), to: new THREE.Vector3(v.x * M, EYE, v.y * M), yaw0: yaw, yaw1: v.heading, t0: performance.now(), dur: 520 };
    } else { camAt(v); yaw = v.heading; look(); }
    updateHud();
  }

  const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; };

  function bindLook(el) {
    let drag = null;
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; el.setPointerCapture(e.pointerId); stopAuto(); });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw = drag.yaw + (e.clientX - drag.x) * 0.006;
      pitch = Math.max(-0.6, Math.min(0.5, drag.pitch + (e.clientY - drag.y) * 0.004));
      look();
    });
    const end = (e) => {
      if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) go(idx + 1); // タップで前へ
      drag = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", () => { drag = null; });
  }

  function stopAuto() {
    clearInterval(autoTimer); autoTimer = null;
    if (hud) hud.querySelector(".w-auto").textContent = "▶ 自動で歩く";
  }
  function toggleAuto() {
    if (autoTimer) return stopAuto();
    hud.querySelector(".w-auto").textContent = "❚❚ 止める";
    autoTimer = setInterval(() => { if (idx >= views.length - 1) stopAuto(); else go(idx + 1); }, 1100);
  }

  function dispose() {
    stopAuto();
    cancelAnimationFrame(raf);
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    if (root) root.innerHTML = "";
    renderer = scene = camera = floorGroup = null; curFloor = null; views = []; idx = 0;
  }

  function render(el, o) {
    dispose();
    opts = o; root = el;
    views = makeViews(o.runs);
    el.innerHTML = `
      <div class="w-hud">
        <div class="w-view">
          <div class="w-stage"></div>
          <div class="w-top"><span class="w-floor"></span><span class="w-step"></span></div>
          <figure class="w-photo" hidden><img alt=""><figcaption></figcaption></figure>
          <div class="w-fade"></div>
        </div>
        <div class="w-bottom">
          <div class="w-bar"><i></i></div>
          <div class="w-btns">
            <button type="button" class="w-prev" aria-label="戻る">◀ 戻る</button>
            <button type="button" class="w-auto">▶ 自動で歩く</button>
            <button type="button" class="w-next" aria-label="進む">進む ▶</button>
          </div>
        </div>
      </div>`;
    hud = el.querySelector(".w-hud");
    const stage = el.querySelector(".w-stage");
    if (!views.length) { hud.querySelector(".w-step").textContent = "経路を選ぶと歩いて確認できます"; return; }
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0xeef3f6);
    stage.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xeef3f6, 18, 70);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4cc, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.35); sun.position.set(0.4, 1, 0.6); scene.add(sun);
    camera = new THREE.PerspectiveCamera(70, w / h, 0.05, 200);
    bindLook(stage);
    hud.querySelector(".w-prev").onclick = () => { stopAuto(); go(idx - 1); };
    hud.querySelector(".w-next").onclick = () => { stopAuto(); go(idx + 1); };
    hud.querySelector(".w-auto").onclick = toggleAuto;
    el.tabIndex = 0;
    el.onkeydown = (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
    };
    idx = 0;
    go(0, false);
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (tween) {
        const t = Math.min(1, (now - tween.t0) / tween.dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(tween.from, tween.to, e);
        yaw = angleLerp(tween.yaw0, tween.yaw1, e);
        look();
        if (t >= 1) tween = null;
      }
      // 看板は近くのもの（約20m以内）だけ表示する
      if (floorGroup) for (const o of floorGroup.children) {
        if (o.userData.sign) o.visible = o.position.distanceTo(camera.position) < 20;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    if (!renderer || !root) return;
    const stage = root.querySelector(".w-stage");
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
  }

  window.Walk = { render, dispose, resize };
})();
