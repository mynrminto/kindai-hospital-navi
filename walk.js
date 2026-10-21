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
    const esc = findEscalator(f, px, cols, rows, walk);
    const shops = findShops(f, px, cols, rows, walk, fl.w, fl.h);
    // 受付カウンター（区画全体をカウンターにする）
    const counters = findShops(f, px, cols, rows, walk, fl.w, fl.h, COUNTER_IDS, 5);
    floorCache[f] = { fl, img, px, cols, rows, walk, esc, shops, counters };
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
          if (r >= 0 && q >= 0 && r < rows && q < cols && walk[r * cols + q] < 3) walk[r * cols + q] = 2;
        }
      }
    }
  }


  /* ---------- エスカレーター ---------- */
  const FLOOR_H = 4.0; // 階高（m）
  // フロアマップのエスカレーターの区画（淡い青の四角）を、ノード位置から塗りつぶしで探す
  function findEscalator(f, px, cols, rows, walk) {
    const n = opts.H.nodes[f] && opts.H.nodes[f].esc;
    const lift = opts.H.lifts.find((l) => l.id === "esc");
    if (!n || !lift || !lift.floors.includes(f)) return null;
    const q0 = Math.floor(n[0] / CELL), r0 = Math.floor(n[1] / CELL);
    // 区画の淡い青と、中のアイコン（紺・白）を同じ区画として扱う
    const near = (p, c, tol) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < tol;
    const same = (q, r) => {
      const p = px(q * CELL + (CELL >> 1), r * CELL + (CELL >> 1));
      if (near(p, [229, 237, 242], 24) || near(p, [0, 79, 128], 90)) return true;
      return near(p, [255, 255, 255], 6) && Math.abs(q - q0) <= 4 && Math.abs(r - r0) <= 4;
    };
    const seen = new Set([r0 * cols + q0]), stack = [[q0, r0]];
    let minQ = q0, maxQ = q0, minR = r0, maxR = r0;
    while (stack.length && seen.size < 600) {
      const [q, r] = stack.pop();
      for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nq = q + dq, nr = r + dr, k = nr * cols + nq;
        if (nq < 0 || nr < 0 || nq >= cols || nr >= rows || seen.has(k) || !same(nq, nr)) continue;
        seen.add(k); stack.push([nq, nr]);
        minQ = Math.min(minQ, nq); maxQ = Math.max(maxQ, nq); minR = Math.min(minR, nr); maxR = Math.max(maxR, nr);
      }
    }
    if (seen.size < 12 || seen.size >= 600) return null;
    // 区画は壁を立てずに吹き抜けとして扱う
    for (let r = minR; r <= maxR; r++) for (let q = minQ; q <= maxQ; q++) walk[r * cols + q] = 3;
    const x0 = minQ * CELL * M, x1 = (maxQ + 1) * CELL * M, z0 = minR * CELL * M, z1 = (maxR + 1) * CELL * M;
    const alongZ = (z1 - z0) >= (x1 - x0);
    const L = alongZ ? z1 - z0 : x1 - x0, W = alongZ ? x1 - x0 : z1 - z0;
    const H = Math.min(L - 2.4, FLOOR_H / Math.tan(Math.PI / 6));
    const LA = (L - H) / 2;
    const e = { alongZ, x0, z0, x1, z1, L, W, H, LA, up: f < Math.max(...lift.floors), down: f > Math.min(...lift.floors) };
    // 局所座標（s：上り方向の長さ、t：横）→ 世界座標
    // 上りレーンは t<0 側、乗り口は s=0 側。s は区画の奥（z1 / x1）から測る（実際の乗り口の向きに合わせる）
    // 上り・下りの左右は階ごとに入れ替わる（奇数階は上りが t<0 側、偶数階は反対側）
    const U = f % 2 === 1 ? 1 : -1;
    e.P = (s, t, y) => alongZ ? new THREE.Vector3((x0 + x1) / 2 + U * t, y, z1 - s) : new THREE.Vector3(x1 - s, y, (z0 + z1) / 2 + U * t);
    e.local = (x, z) => alongZ ? [z1 - z, U * (x - (x0 + x1) / 2)] : [x1 - x, U * (z - (z0 + z1) / 2)];
    e.yaw = (sign) => alongZ ? (sign > 0 ? Math.PI : 0) : (sign > 0 ? -Math.PI / 2 : Math.PI / 2);
    // 区画の両脇のうち、通路として歩ける側（壁と反対側）。回り込みはこちらを通る
    const openCount = (side) => {
      let n = 0;
      for (let s = 0; s <= L; s += 0.7) {
        const p = e.P(s, side * (W / 2 + 1.0), 0), q = Math.floor(p.x / M / CELL), r = Math.floor(p.z / M / CELL);
        if (q >= 0 && r >= 0 && q < cols && r < rows && walk[r * cols + q] > 0 && walk[r * cols + q] !== 3) n++;
      }
      return n;
    };
    e.openSide = openCount(-1) >= openCount(1) ? -1 : 1;
    return e;
  }
  // エスカレーター乗り口・降り口に立つ位置（画像px）と向き
  //  上りレーン（t<0）：s=0 の床から s=L の上階へ。下りレーン（t>0）：s=L の床から s=0 の下階へ。
  function escPose(e, kind) {
    const out = 1.4, t = e.W / 4;
    const pick = {
      goUp: [-out, -t, 1], goDown: [e.L + out, t, -1],
      fromBelow: [e.L + out, t, 1], fromAbove: [-out, -t, -1]
    }[kind];
    const p = e.P(pick[0], pick[1], 0);
    return { x: p.x / M, y: p.z / M, heading: e.yaw(pick[2]) };
  }

  // 区画を横切る場合は、区画の脇を回り込む点を足す（画像px の点列を返す）
  function aroundWell(e, from, to, side) {
    const [sa, ta] = e.local(from[0] * M, from[1] * M), [sb, tb] = e.local(to[0] * M, to[1] * M);
    let hit = false;
    for (let k = 1; k < 20; k++) {
      const s = sa + (sb - sa) * k / 20, t = ta + (tb - ta) * k / 20;
      if (s > -0.2 && s < e.L + 0.2 && Math.abs(t) < e.W / 2 + 0.2) hit = true;
    }
    if (!hit) return [];
    const tSide = e.openSide * (e.W / 2 + 1.1), cl = (v) => Math.max(-1.4, Math.min(e.L + 1.4, v));
    return [e.P(cl(sa), tSide, 0), e.P(cl(sb), tSide, 0)].map((v) => [v.x / M, v.z / M]);
  }

  function buildEscalator(e) {
    const g = new THREE.Group();
    const P = e.P, LW = Math.min(1.5, e.W / 2 - 0.25);
    const ramp = (s) => Math.min(1, Math.max(0, (s - e.LA) / e.H));
    const lanes = [];
    if (e.up) lanes.push({ t: -e.W / 4, h: (s) => ramp(s) * FLOOR_H });
    if (e.down) lanes.push({ t: e.W / 4, h: (s) => -(1 - ramp(s)) * FLOOR_H });
    const mat = {
      step: new THREE.MeshLambertMaterial({ color: 0x5b6067 }),
      edge: new THREE.MeshBasicMaterial({ color: 0xf2c200 }),
      metal: new THREE.MeshLambertMaterial({ color: 0xc9ced3, side: THREE.DoubleSide }),
      glass: new THREE.MeshBasicMaterial({ color: 0xbfe0ee, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      rail: new THREE.MeshLambertMaterial({ color: 0x202326 }),
      wall: new THREE.MeshLambertMaterial({ color: 0xe9e7e2, side: THREE.DoubleSide }),
      floor: new THREE.MeshLambertMaterial({ color: 0xd9cfbd }),
      ceil: new THREE.MeshBasicMaterial({ color: 0xf3f3f0, side: THREE.DoubleSide })
    };
    // 帯状の面（側面パネル・ガラス）
    const strip = (t, lo, hi, m) => {
      const pos = [];
      for (let s = 0; s < e.L - 1e-6; s += 0.25) {
        const s2 = Math.min(e.L, s + 0.25);
        const a = P(s, t, lo(s)), b = P(s2, t, lo(s2)), c = P(s2, t, hi(s2)), d = P(s, t, hi(s));
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, m);
    };
    const box = (s0, s1, t0, t1, y0, y1, m) => {
      const a = P(s0, t0, y0), b = P(s1, t1, y1);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) || 0.01, Math.abs(b.y - a.y) || 0.01, Math.abs(b.z - a.z) || 0.01), m);
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return mesh;
    };
    for (const ln of lanes) {
      const h = ln.h, t0 = ln.t - LW / 2 + 0.15, t1 = ln.t + LW / 2 - 0.15;
      // ステップ（段差と黄色の縁取り）
      for (let s = 0; s < e.L - 1e-6; s += 0.4) {
        const top = Math.max(h(s), h(Math.min(e.L, s + 0.4)));
        g.add(box(s, Math.min(e.L, s + 0.4), t0, t1, Math.min(h(s), h(Math.min(e.L, s + 0.4))) - 0.6, top, mat.step));
        if (h(s) !== h(s + 0.4)) g.add(box(s, s + 0.04, t0, t1, top, top + 0.005, mat.edge));
      }
      g.add(box(0, 0.05, t0, t1, h(0), h(0) + 0.006, mat.edge));
      g.add(box(e.L - 0.05, e.L, t0, t1, h(e.L), h(e.L) + 0.006, mat.edge));
      for (const side of [-1, 1]) {
        const t = ln.t + side * LW / 2;
        g.add(strip(t, (s) => h(s) - 0.7, (s) => h(s) + 0.12, mat.metal));       // 側面のステンレス
        g.add(strip(t, (s) => h(s) + 0.12, (s) => h(s) + 0.92, mat.glass));      // ガラスの欄干
        // 手すり（黒いベルト）
        const path = new THREE.CurvePath();
        for (let s = 0; s < e.L - 1e-6; s += 0.5) path.add(new THREE.LineCurve3(P(s, t, h(s) + 0.95), P(Math.min(e.L, s + 0.5), t, h(Math.min(e.L, s + 0.5)) + 0.95)));
        g.add(new THREE.Mesh(new THREE.TubeGeometry(path, path.curves.length * 4, 0.045, 6, false), mat.rail));
      }
      // トラス（本体）の底面
      const pos = [];
      for (let s = 0; s < e.L - 1e-6; s += 0.25) {
        const s2 = Math.min(e.L, s + 0.25), y1 = h(s) - 0.7, y2 = h(s2) - 0.7;
        const a = P(s, ln.t - LW / 2, y1), b = P(s2, ln.t - LW / 2, y2), c = P(s2, ln.t + LW / 2, y2), d = P(s, ln.t + LW / 2, y1);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, mat.metal));
    }
    // 下りレーン側の床の吹き抜けと、上りレーン側の天井の吹き抜け（下の階・上の階が見える）
    const T = e.W / 2;
    if (e.down) {
      const s1 = e.L - e.LA;
      for (const [a0, a1, b0, b1] of [[0, 0, 0, T], [0, s1, T, T], [0, s1, 0, 0]]) {
        g.add(box(a0, a1 || a0 + 0.02, b0, b1 || b0 + 0.02, -FLOOR_H, 0, mat.wall));
      }
      g.add(box(0, s1, 0, T, -FLOOR_H - 0.02, -FLOOR_H, mat.floor));
      // 吹き抜けまわりのガラス柵
      g.add(box(0, 0.02, 0, T, 0, 1.1, mat.glass));
      g.add(box(0, s1, T - 0.02, T, 0, 1.1, mat.glass));
      g.add(box(0, s1, T - 0.06, T, 1.1, 1.14, mat.metal));
    }
    if (e.up) {
      const s0 = e.LA;
      for (const [a0, a1, b0, b1] of [[e.L, e.L, -T, 0], [s0, e.L, -T, -T], [s0, s0, -T, 0]]) {
        g.add(box(a0, a1 === a0 ? a0 + 0.02 : a1, b0, b1, WALL_H, WALL_H + FLOOR_H, mat.wall));
      }
      g.add(box(e.L - e.LA, e.L, -T, 0, FLOOR_H - 0.02, FLOOR_H, mat.floor));
      g.add(box(s0, e.L, -T, 0, WALL_H + FLOOR_H, WALL_H + FLOOR_H + 0.02, mat.ceil));
    }
    return g;
  }
  // 吹き抜けの穴（床・天井）の範囲。局所座標の長方形を世界座標の [x0,z0,x1,z1] で返す
  function escHoles(e) {
    const rect = (s0, s1, t0, t1) => { const a = e.P(s0, t0, 0), b = e.P(s1, t1, 0); return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)]; };
    return {
      floor: e.down ? rect(0, e.L - e.LA, 0, e.W / 2) : null,
      ceil: e.up ? rect(e.LA, e.L, -e.W / 2, 0) : null
    };
  }
  // 穴のあいた平面（床・天井）
  function planeWithHole(W, D, hole, y, mat, flip) {
    const sh = new THREE.Shape();
    const v = (x, z) => flip ? [x, z] : [x, -z];
    sh.moveTo(...v(0, 0)); sh.lineTo(...v(W, 0)); sh.lineTo(...v(W, D)); sh.lineTo(...v(0, D)); sh.lineTo(...v(0, 0));
    if (hole) {
      const [x0, z0, x1, z1] = hole, hp = new THREE.Path();
      hp.moveTo(...v(x0, z0)); hp.lineTo(...v(x0, z1)); hp.lineTo(...v(x1, z1)); hp.lineTo(...v(x1, z0)); hp.lineTo(...v(x0, z0));
      sh.holes.push(hp);
    }
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
    mesh.rotation.x = flip ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }


  /* ---------- 売店（ガラス張りの店構え） ---------- */
  const SHOP_IDS = ["seven", "greenleaves"];
  const COUNTER_IDS = ["reception"];
  // 店の区画をフロアマップの部屋の色から探し、walk=4 として印を付ける
  function findShops(f, px, cols, rows, walk, W, H, ids = SHOP_IDS, mark = 4) {
    const out = [];
    const lumOf = (p) => (p[0] + p[1] + p[2]) / 3;
    const isBeige = (p) => Math.abs(p[0] - BEIGE[0]) < 6 && Math.abs(p[1] - BEIGE[1]) < 6 && Math.abs(p[2] - BEIGE[2]) < 7;
    for (const p of opts.places) {
      if (p.f !== f || !ids.includes(p.id)) continue;
      // 種：行き先の点の近くで部屋の色をしている画素
      let seed = null;
      for (let d = 0; d <= 40 && !seed; d += 2) for (let dy = -d; dy <= d && !seed; dy += 2) for (let dx = -d; dx <= d && !seed; dx += 2) {
        const x = p.at[0] + dx, y = p.at[1] + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const c = px(x, y), l = lumOf(c);
        if (!isBeige(c) && l > 150 && l < 250) seed = [x, y, c];
      }
      if (!seed) continue;
      // 画素単位の塗りつぶし（部屋の境界線で止まる）
      const base = seed[2], seen = new Uint8Array(W * H), stack = [seed[1] * W + seed[0]];
      seen[stack[0]] = 1;
      const count = new Uint16Array(cols * rows);
      let n = 0;
      while (stack.length && n < 150000) {
        const i = stack.pop(), x = i % W, y = (i / W) | 0;
        n++; count[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
        for (const j of [i + 1, i - 1, i + W, i - W]) {
          if (j < 0 || j >= W * H || seen[j]) continue;
          const jx = j % W; if (Math.abs(jx - x) > 1) continue;
          const c = px(jx, (j / W) | 0);
          if (Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]) > 12) continue;
          seen[j] = 1; stack.push(j);
        }
      }
      if (n >= 150000) continue;
      const cells = new Set();
      for (let k = 0; k < count.length; k++) if (count[k] >= CELL * CELL * 0.35 && !walk[k]) cells.add(k);
      // 中の文字で抜けたマスを埋める
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < count.length; k++) {
        if (cells.has(k) || walk[k]) continue;
        const nb = [k - 1, k + 1, k - cols, k + cols].filter((j) => cells.has(j)).length;
        if (nb >= 3) cells.add(k);
      }
      if (cells.size < 6) continue;
      // 店と廊下の間の境界線のマスも店に含め、店先が廊下に直接面するようにする
      const add = [];
      for (let k = 0; k < walk.length; k++) {
        if (walk[k] || cells.has(k)) continue;
        const nb = [k - 1, k + 1, k - cols, k + cols];
        if (nb.some((j) => cells.has(j)) && nb.some((j) => walk[j] === 1 || walk[j] === 2)) add.push(k);
      }
      add.forEach((k) => cells.add(k));
      for (const c of cells) walk[c] = mark;
      const m = p.name.match(/（(.+?)）/);
      out.push({ id: p.id, place: p, label: m ? m[1] : (p.short || p.name), cells });
    }
    return out;
  }

  // 廊下（またはエスカレーター区画）と店の境目の線分：[x, y, horiz, len, nx, nz, meta]（画像px）
  function frontSegs(info) {
    const { cols, rows, walk } = info;
    const cellOf = (q, r) => (q >= 0 && r >= 0 && q < cols && r < rows ? walk[r * cols + q] : 0);
    const shopAt = (q, r) => (info.shops || []).find((sh) => sh.cells.has(r * cols + q));
    const isCorr = (q, r) => { const v = cellOf(q, r); return v === 1 || v === 2 || v === 3; };
    const out = [];
    for (let r = 0; r < rows; r++) for (const side of [-1, 1]) {
      let start = -1, sh = null;
      for (let q = 0; q <= cols; q++) {
        const edge = q < cols && isCorr(q, r) && cellOf(q, r + side) === 4;
        if (edge && start < 0) { start = q; sh = cellOf(q, r) === 3 ? null : shopAt(q, r + side); }
        if (!edge && start >= 0) { out.push([start * CELL, (side < 0 ? r : r + 1) * CELL, true, (q - start) * CELL, 0, -side, sh ? { front: sh } : { plain: true }]); start = -1; }
      }
    }
    for (let q = 0; q < cols; q++) for (const side of [-1, 1]) {
      let start = -1, sh = null;
      for (let r = 0; r <= rows; r++) {
        const edge = r < rows && isCorr(q, r) && cellOf(q + side, r) === 4;
        if (edge && start < 0) { start = r; sh = cellOf(q, r) === 3 ? null : shopAt(q + side, r); }
        if (!edge && start >= 0) { out.push([(side < 0 ? q : q + 1) * CELL, start * CELL, false, (r - start) * CELL, -side, 0, sh ? { front: sh } : { plain: true }]); start = -1; }
      }
    }
    return out;
  }
  // 店の入口（いちばん長い店先の中央）の前に立つ位置（画像px）と、店の方を向く向き
  function shopDoor(info, shop) {
    let best = null;
    for (const f of frontSegs(info)) if (f[6].front === shop && (!best || f[3] > best[3])) best = f;
    if (!best) return null;
    const [x, y, horiz, len, nx, nz] = best;
    const mx = horiz ? x + len / 2 : x, my = horiz ? y : y + len / 2;
    return { x: mx + nx * 3.4 / M, y: my + nz * 3.4 / M, heading: Math.atan2(-nx, -nz) };
  }
  // 廊下のマスだけを通る最短の道（画像px の点列）
  function corridorPath(info, from, to) {
    const { cols, rows, walk } = info;
    const ok = (k) => walk[k] === 1 || walk[k] === 2;
    const cell = ([x, y]) => Math.floor(y / CELL) * cols + Math.floor(x / CELL);
    const s0 = cell(from), t0 = cell(to);
    const prev = new Int32Array(cols * rows).fill(-1), q = [s0];
    prev[s0] = s0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      if (k === t0) break;
      const x = k % cols;
      for (const j of [k + 1, k - 1, k + cols, k - cols]) {
        if (j < 0 || j >= cols * rows || prev[j] >= 0 || Math.abs((j % cols) - x) > 1 || (!ok(j) && j !== t0)) continue;
        prev[j] = k; q.push(j);
      }
    }
    if (prev[t0] < 0) return null;
    const path = [];
    for (let k = t0; k !== s0; k = prev[k]) path.push(k);
    path.reverse();
    return path.filter((_, i) => i % 3 === 2).map((k) => [((k % cols) + 0.5) * CELL, (((k / cols) | 0) + 0.5) * CELL]);
  }

  // 商品棚の絵（キャンバス）
  function shelfTexture() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, 256, 256);
    const pal = ["#e8574d", "#f2b134", "#4aa3df", "#6cc070", "#ffffff", "#f7d9a8", "#9b6fd1", "#ef8fb0", "#2f6fb0", "#f5f0e1"];
    for (let tier = 0; tier < 5; tier++) {
      const y0 = tier * 51;
      g.fillStyle = "#c9cdd2"; g.fillRect(0, y0 + 46, 256, 5);
      for (let x = 2; x < 254;) {
        const w = 8 + Math.floor(Math.random() * 14), h = 22 + Math.floor(Math.random() * 20);
        g.fillStyle = pal[Math.floor(Math.random() * pal.length)];
        g.fillRect(x, y0 + 46 - h, w - 2, h);
        g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(x + 1, y0 + 46 - h + 3, 2, h - 6);
        x += w;
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }
  // 店の看板（白地に紺の文字。ロゴは使わない）
  function fasciaSign(text, len) {
    const c = document.createElement("canvas");
    const H = 96, W = Math.max(256, Math.round(len / 0.36 * H));
    c.width = Math.min(2048, W); c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, H);
    g.fillStyle = "#004f80"; g.fillRect(0, H - 10, c.width, 10);
    g.fillStyle = "#004f80";
    g.font = `bold 52px "BIZ UDPGothic", "Hiragino Sans", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, H / 2 - 4, c.width - 40);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  // 床・天井用の模様（キャンバスで作るタイル）
  function tileTexture(draw, size, repeatM, w, h) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / repeatM, h / repeatM);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const floorTile = (g, n) => {
    // 明るい木目調の長尺シート
    g.fillStyle = "#e9dfcd"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? "#e7ddcb" : "#ece4d6";
      g.fillRect(0, i * n / 4, n, n / 4);
      g.fillStyle = "rgba(150,120,80,.18)"; g.fillRect(0, i * n / 4, n, 1.5);
      g.fillRect(((i * 97) % n), i * n / 4, 1.5, n / 4);
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(140,110,70,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * n, Math.random() * n, 6 + Math.random() * 30, 1);
    }
  };
  const ceilTile = (g, n) => {
    g.fillStyle = "#f6f6f3"; g.fillRect(0, 0, n, n);
    g.strokeStyle = "#dcdcd6"; g.lineWidth = 2;
    g.strokeRect(0, 0, n, n);
    for (let k = 0; k < 400; k++) { g.fillStyle = "rgba(0,0,0,.035)"; g.fillRect(Math.random() * n, Math.random() * n, 2, 2); }
  };

  // 安定した疑似乱数（同じ階は毎回同じ配置にする）
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  function buildInterior(info) {
    const { cols, rows, walk, px } = info;
    const isW = (q, r) => q >= 0 && r >= 0 && q < cols && r < rows && walk[r * cols + q] > 0;
    const cellOf = (q, r) => (q >= 0 && r >= 0 && q < cols && r < rows ? walk[r * cols + q] : 0);
    const shopAt = (q, r) => (info.shops || []).find((sh) => sh.cells.has(r * cols + q));
    // 壁の向こうが何か：屋外（白）なら窓、部屋なら扉を付ける
    const sideInfo = (q, r) => {
      const p = px(Math.max(0, q) * CELL + (CELL >> 1), Math.max(0, r) * CELL + (CELL >> 1));
      const outside = q < 0 || r < 0 || q >= cols || r >= rows || (p[0] > 252 && p[1] > 252 && p[2] > 252);
      const lum = (p[0] + p[1] + p[2]) / 3;
      let accent = [214, 226, 232];
      if (lum <= 240 && lum >= 120) {
        // 部屋の色は彩度を落として落ち着いた腰壁の色にする
        accent = p.map((v) => Math.round((v * 0.45 + lum * 0.55) * 0.92));
      }
      return { outside, accent };
    };
    // 壁の線分：start(m), dir, normal（廊下側）, 長さ(m)
    const segs = [];
    const push = (x, y, horiz, len, nx, nz, si) => segs.push({ x: x * M, z: y * M, horiz, len: len * M, nx, nz, ...si });
    for (let r = 0; r < rows; r++) for (const side of [-1, 1]) {
      let start = -1, si = null;
      for (let q = 0; q <= cols; q++) {
        const edge = q < cols && isW(q, r) && !isW(q, r + side);
        if (edge && start < 0) { start = q; si = { ...sideInfo(q, r + side), inShop: cellOf(q, r) === 4, plain: cellOf(q, r) === 5 }; }
        if (!edge && start >= 0) { push(start * CELL, (side < 0 ? r : r + 1) * CELL, true, (q - start) * CELL, 0, -side, si); start = -1; }
      }
    }
    for (let q = 0; q < cols; q++) for (const side of [-1, 1]) {
      let start = -1, si = null;
      for (let r = 0; r <= rows; r++) {
        const edge = r < rows && isW(q, r) && !isW(q + side, r);
        if (edge && start < 0) { start = r; si = { ...sideInfo(q + side, r), inShop: cellOf(q, r) === 4, plain: cellOf(q, r) === 5 }; }
        if (!edge && start >= 0) { push((side < 0 ? q : q + 1) * CELL, start * CELL, false, (r - start) * CELL, -side, 0, si); start = -1; }
      }
    }

    // 廊下と店の境目は店構え（ガラス張り）にする
    for (const f of frontSegs(info)) push(...f);
    const extra = [];

    // 部品を種類ごとにまとめて InstancedMesh にする
    const parts = {};
    const add = (kind, mtx, col) => (parts[kind] = parts[kind] || []).push([mtx, col]);
    const m4 = () => new THREE.Matrix4();
    // 線分に沿った箱：along a0〜a1(m)、高さ y0〜y1、壁面から off〜off+depth
    const onSeg = (sg, a0, a1, y0, y1, off, depth) => {
      const along = (a0 + a1) / 2, L = a1 - a0, d = off + depth / 2;
      const cx = sg.x + (sg.horiz ? along : 0) + sg.nx * d, cz = sg.z + (sg.horiz ? 0 : along) + sg.nz * d;
      const m = m4().makeScale(sg.horiz ? L : depth, y1 - y0, sg.horiz ? depth : L);
      m.setPosition(cx, (y0 + y1) / 2, cz);
      return m;
    };
    const WOOD = [0.80, 0.66, 0.48], WHITE = [0.96, 0.95, 0.93];
    const longest = {};
    for (const sg of segs) if (sg.front && (!longest[sg.front.id] || longest[sg.front.id].len < sg.len)) longest[sg.front.id] = sg;
    for (const sg of segs) {
      const L = sg.len;
      if (sg.front) {
        // 店構え：腰の低い台、大きなガラス、縦の桟、上に看板帯
        const hasDoor = longest[sg.front.id] === sg && L >= 1.5, d0 = L / 2 - 0.95, d1 = L / 2 + 0.97;
        for (const [b0, b1] of hasDoor ? [[0, d0], [d1, L]] : [[0, L]]) if (b1 > b0) add("frame", onSeg(sg, b0, b1, 0, 0.25, -0.05, 0.1), [0.35, 0.37, 0.4]);
        add("shopglass", onSeg(sg, 0, L, 0.25, 2.35, -0.01, 0.02), null);
        for (let a = 0; a <= L + 1e-6; a += 1.2) add("frame", onSeg(sg, Math.max(0, a - 0.03), Math.min(L, a + 0.03), 0.25, 2.35, -0.03, 0.06), [0.72, 0.74, 0.76]);
        add("frame", onSeg(sg, 0, L, 2.35, WALL_H, -0.06, 0.12), [0.97, 0.97, 0.96]);
        if (hasDoor) {
          // 自動ドア（中央）と看板
          const a = L / 2;
          add("frame", onSeg(sg, a - 0.95, a + 0.95, 2.2, 2.35, -0.04, 0.1), [0.45, 0.47, 0.5]);
          for (const e of [a - 0.95, a, a + 0.92]) add("frame", onSeg(sg, e, e + 0.05, 0, 2.2, -0.04, 0.08), [0.45, 0.47, 0.5]);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(L - 0.2, 6), 0.4), fasciaSign(sg.front.label, Math.min(L - 0.2, 6)));
          const mid = sg.horiz ? [sg.x + a, sg.z] : [sg.x, sg.z + a];
          sign.position.set(mid[0] + sg.nx * 0.07, 2.58, mid[1] + sg.nz * 0.07);
          sign.rotation.y = Math.atan2(sg.nx, sg.nz);
          extra.push(sign);
        }
        continue;
      }
      if (sg.plain) { add("wall", onSeg(sg, 0, L, 0, WALL_H, -0.06, 0.12), WHITE); continue; }
      if (sg.inShop) {
        // 店の奥の壁：白い壁に飲料・商品の壁面棚
        add("wall", onSeg(sg, 0, L, 0, WALL_H, -0.06, 0.12), WHITE);
        if (L > 0.8) add("shelf", onSeg(sg, 0.1, L - 0.1, 0, 2.0, 0.06, 0.55), null);
        continue;
      }
      // 壁本体（上は白、下1mは部屋の色の腰壁）
      add("wall", onSeg(sg, 0, L, 0, WALL_H, -0.06, 0.12), WHITE);
      if (sg.outside) {
        // 窓：腰より上をガラスに、1.5mごとに縦の桟
        add("glass", onSeg(sg, 0.05, L - 0.05, 0.85, 2.55, 0.062, 0.01), null);
        for (let a = 0; a <= L; a += 1.5) add("frame", onSeg(sg, Math.max(0, a - 0.03), Math.min(L, a + 0.03), 0.85, 2.55, 0.06, 0.05), [0.55, 0.6, 0.64]);
        add("frame", onSeg(sg, 0, L, 0.8, 0.86, 0.06, 0.12), [0.85, 0.85, 0.83]);
        continue;
      }
      add("wall", onSeg(sg, 0, L, 0, 1.0, 0.06, 0.012), sg.accent.map((v) => v / 255));
      // 扉：長い壁には約7mごとに引き戸。扉の間に手すり
      const doors = [];
      if (L >= 2.6) for (let a = 1.2; a + 1.3 < L; a += 7) doors.push(a);
      let prev = 0.2;
      for (const a of doors) {
        add("door", onSeg(sg, a, a + 1.2, 0, 2.15, 0.07, 0.04), hash(Math.round(sg.x * 10), Math.round(sg.z * 10)) < 0.5 ? WOOD : [0.88, 0.86, 0.82]);
        add("frame", onSeg(sg, a - 0.06, a + 1.26, 2.15, 2.22, 0.06, 0.06), [0.62, 0.62, 0.6]);
        add("frame", onSeg(sg, a + 0.95, a + 1.0, 0.95, 1.25, 0.11, 0.03), [0.45, 0.45, 0.45]); // 取っ手
        add("plate", onSeg(sg, a + 0.3, a + 0.9, 2.3, 2.45, 0.06, 0.02), null);               // 室名札
        if (a - 0.15 > prev) add("rail", onSeg(sg, prev, a - 0.15, 0.82, 0.88, 0.1, 0.06), WOOD);
        prev = a + 1.35;
      }
      if (L - 0.2 > prev) add("rail", onSeg(sg, prev, L - 0.2, 0.82, 0.88, 0.1, 0.06), WOOD);
      add("frame", onSeg(sg, 0, L, 0, 0.08, 0.06, 0.02), [0.62, 0.6, 0.57]); // 幅木
    }

    // 天井の照明・植栽・待合いす（廊下の広い所に）
    const open = (q, r, k) => { for (let dr = -k; dr <= k; dr++) for (let dq = -k; dq <= k; dq++) if (!isW(q + dq, r + dr)) return false; return true; };
    const nearWell = (q, r) => { for (let dr = -3; dr <= 3; dr++) for (let dq = -3; dq <= 3; dq++) if (walk[(r + dr) * cols + q + dq] === 3) return true; return false; };
    const nearShop = (q, r) => { for (let dr = -6; dr <= 6; dr++) for (let dq = -6; dq <= 6; dq++) { const v = walk[(r + dr) * cols + q + dq]; if (v === 4 || v === 5) return true; } return false; };
    const nearRoute = (q, r, k) => { for (let dr = -k; dr <= k; dr++) for (let dq = -k; dq <= k; dq++) if (walk[(r + dr) * cols + q + dq] === 2) return true; return false; };
    for (let r = 2; r < rows - 2; r++) for (let q = 2; q < cols - 2; q++) {
      if (walk[r * cols + q] === 5) {
        // 受付カウンター：廊下に面したマスはカウンター、奥は事務スペース
        const x = (q + 0.5) * CELL * M, z = (r + 0.5) * CELL * M, c = CELL * M;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dq, dr]) => { const v = cellOf(q + dq, r + dr); return v === 1 || v === 2; });
        add("shopfloor", m4().makeScale(c, 0.01, c).setPosition(x, 0.006, z), null);
        if (nb.length) {
          add("door", m4().makeScale(c + 0.01, 1.0, c + 0.01).setPosition(x, 0.5, z), WOOD);
          add("frame", m4().makeScale(c + 0.08, 0.05, c + 0.08).setPosition(x, 1.025, z), [0.97, 0.97, 0.95]);
          for (const [dq, dr] of nb) add("frame", m4().makeScale(dq ? 0.02 : c, 0.06, dq ? c : 0.02).setPosition(x + dq * (c / 2 + 0.01), 0.1, z + dr * (c / 2 + 0.01)), [0.55, 0.5, 0.45]);
          if ((q + r) % 4 === 0) add("frame", m4().makeScale(0.35, 0.25, 0.04).setPosition(x - nb[0][0] * 0.15, 1.2, z - nb[0][1] * 0.15), [0.2, 0.22, 0.25]); // 受付の端末
        } else {
          if ((q + r) % 2 === 0) add("frame", m4().makeScale(c * 0.9, 0.72, c * 0.5).setPosition(x, 0.36, z), [0.9, 0.9, 0.88]); // 事務机
          if ((q * 7 + r) % 3 === 0) add("seat", m4().makeScale(0.45, 0.45, 0.45).setPosition(x, 0.45, z), null);
        }
        if (q % 3 === 1 && r % 2 === 1) add("light", m4().makeScale(0.5, 0.02, 1.4).setPosition(x, WALL_H - 0.02, z), null);
        continue;
      }
      if (walk[r * cols + q] === 4) {
        // 店内：白い床、照明、商品棚（列ごと）
        const x = (q + 0.5) * CELL * M, z = (r + 0.5) * CELL * M;
        add("shopfloor", m4().makeScale(CELL * M, 0.01, CELL * M).setPosition(x, 0.006, z), null);
        if (q % 3 === 1 && r % 2 === 1) add("light", m4().makeScale(0.5, 0.02, 1.4).setPosition(x, WALL_H - 0.02, z), null);
        const inner = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dq, dr]) => cellOf(q + dq, r + dr) === 4);
        if (inner && r % 3 === 1) add("shelf", m4().makeScale(CELL * M, 1.45, 0.7).setPosition(x, 0.725, z), null);
        continue;
      }
      if (!isW(q, r) || walk[r * cols + q] === 3 || nearWell(q, r)) continue;
      if (nearShop(q, r)) { if (q % 4 === 2 && r % 4 === 2 && open(q, r, 1)) add("light", m4().makeScale(0.6, 0.02, 1.2).setPosition((q + 0.5) * CELL * M, WALL_H - 0.02, (r + 0.5) * CELL * M), null); continue; }
      const x = (q + 0.5) * CELL * M, z = (r + 0.5) * CELL * M;
      if (q % 4 === 2 && r % 4 === 2 && open(q, r, 1)) add("light", m4().makeScale(0.6, 0.02, 1.2).setPosition(x, WALL_H - 0.02, z), null);
      if (nearRoute(q, r, 2)) continue;
      const h = hash(q, r);
      if (open(q, r, 4) && q % 6 === 0 && r % 5 === 0 && h < 0.75) {
        // 待合のいす（3人掛け×2列）
        for (const dz of [-0.45, 0.45]) {
          for (const dx of [-0.6, 0, 0.6]) {
            add("seat", m4().makeScale(0.5, 0.08, 0.45).setPosition(x + dx, 0.44, z + dz), null);
            add("seat", m4().makeScale(0.5, 0.42, 0.06).setPosition(x + dx, 0.66, z + dz + (dz < 0 ? -0.2 : 0.2)), null);
          }
          add("frame", m4().makeScale(1.8, 0.4, 0.06).setPosition(x, 0.2, z + dz), [0.6, 0.62, 0.64]);
        }
      } else if (!open(q, r, 1) && open(q, r, 0) && h < 0.025) {
        add("pot", m4().makeScale(0.42, 0.45, 0.42).setPosition(x, 0.225, z), null);
        add("leaf", m4().makeScale(0.55, 0.75, 0.55).setPosition(x, 0.95, z), null);
        add("leaf", m4().makeScale(0.4, 0.5, 0.4).setPosition(x + 0.12, 1.35, z - 0.05), null);
      }
    }

    const geos = {
      box: new THREE.BoxGeometry(1, 1, 1),
      pot: new THREE.CylinderGeometry(0.5, 0.4, 1, 16),
      leaf: new THREE.IcosahedronGeometry(0.5, 1)
    };
    const mats = {
      wall: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      door: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      frame: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      rail: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      glass: new THREE.MeshBasicMaterial({ color: 0xcfe5f1 }),
      plate: new THREE.MeshBasicMaterial({ color: 0x004f80 }),
      light: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      seat: new THREE.MeshLambertMaterial({ color: 0x3f7f9a }),
      pot: new THREE.MeshLambertMaterial({ color: 0xf2efe8 }),
      leaf: new THREE.MeshLambertMaterial({ color: 0x5d9b5a, flatShading: true }),
      shopglass: new THREE.MeshBasicMaterial({ color: 0xdff0f7, transparent: true, opacity: 0.18, depthWrite: false }),
      shopfloor: new THREE.MeshBasicMaterial({ color: 0xf7f7f5 }),
      shelf: new THREE.MeshBasicMaterial({ map: shelfTexture() })
    };
    const group = new THREE.Group();
    const color = new THREE.Color();
    for (const [kind, list] of Object.entries(parts)) {
      const mesh = new THREE.InstancedMesh(geos[kind] || geos.box, mats[kind], list.length);
      list.forEach(([mtx, c], i) => {
        mesh.setMatrixAt(i, mtx);
        if (c) mesh.setColorAt(i, color.setRGB(c[0], c[1], c[2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }
    extra.forEach((o) => group.add(o));
    return group;
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
    const { fl } = info;
    const routePts = opts.runs.filter((r) => r.f === f).flatMap((r) => r.pts);
    const saved = info.walk.slice();
    carve(info, routePts);
    const group = new THREE.Group();

    // 床：木目調のシート、天井：照明つきの天井材（エスカレーターの所は吹き抜け）
    const W = fl.w * M, D = fl.h * M;
    const holes = info.esc ? escHoles(info.esc) : {};
    const ftex = tileTexture(floorTile, 256, 2.4, 1, 1);
    group.add(planeWithHole(W, D, holes.floor, 0, new THREE.MeshBasicMaterial({ map: ftex, color: 0xeae4da }), false));
    const ctex = tileTexture(ceilTile, 64, 0.6, 1, 1);
    group.add(planeWithHole(W, D, holes.ceil, WALL_H, new THREE.MeshBasicMaterial({ map: ctex, side: THREE.DoubleSide }), true));
    if (info.esc) group.add(buildEscalator(info.esc));
    group.add(buildInterior(info));
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
      // 床の誘導ライン（平たい帯）と進む向きの矢印
      const line = new THREE.Mesh(new THREE.TubeGeometry(path, path.curves.length * 16, 0.13, 8, false), new THREE.MeshBasicMaterial({ color: 0xe72510 }));
      line.scale.y = 0.12;
      group.add(line);
      const len = path.getLength();
      const arrowGeo = new THREE.ConeGeometry(0.11, 0.28, 3);
      arrowGeo.rotateX(Math.PI / 2);
      const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let d = 1; d < len; d += 1.5) {
        const t = d / len, p = path.getPointAt(t), tan = path.getTangentAt(t);
        const ar = new THREE.Mesh(arrowGeo, arrowMat);
        ar.position.set(p.x, 0.012, p.z);
        ar.scale.y = 0.15;
        ar.rotation.y = Math.atan2(tan.x, tan.z);
        group.add(ar);
      }
    }
    return group;
  }


  // カウンターの正面（廊下側）から少し離れた立ち位置（画像px）と、カウンターを向く向き
  function counterStand(info, cn) {
    const { cols, walk } = info;
    let nx = 0, ny = 0;
    for (const k of cn.cells) {
      const q = k % cols, r = (k / cols) | 0;
      for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = walk[(r + dr) * cols + q + dq];
        if (v === 1 || v === 2) { nx += dq; ny += dr; }
      }
    }
    const len = Math.hypot(nx, ny);
    if (!len) return null;
    nx /= len; ny /= len;
    const [gx, gy] = cn.place.at;
    let best = null;
    for (const k of cn.cells) {
      const q = k % cols, r = (k / cols) | 0, x = (q + 0.5) * CELL, y = (r + 0.5) * CELL;
      const v = walk[(r + Math.round(ny)) * cols + q + Math.round(nx)];
      if (v !== 1 && v !== 2) continue;
      const d = Math.hypot(x - gx, y - gy);
      if (!best || d < best.d) best = { d, x, y };
    }
    if (!best) return null;
    return { x: best.x + nx * 2.4 / M, y: best.y + ny * 2.4 / M, heading: Math.atan2(-nx, -ny) };
  }

  /* ---------- 視点の列 ---------- */
  // エスカレーターに乗り降りする所は、区画の中ではなく乗り口・降り口に立つようにする
  async function prepareRuns(runs) {
    const out = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], info = await analyzeFloor(r.f), e = info.esc;
      const nr = { ...r, pts: r.pts.slice() };
      if (e) {
        const inWell = ([x, y]) => x * M >= e.x0 - 0.2 && x * M <= e.x1 + 0.2 && y * M >= e.z0 - 0.2 && y * M <= e.z1 + 0.2;
        if (r.exit && r.exit.lift === "esc") {
          const p = escPose(e, r.exit.to > r.f ? "goUp" : "goDown");
          while (nr.pts.length > 1 && inWell(nr.pts[nr.pts.length - 1])) nr.pts.pop();
          const side = r.exit.to > r.f ? -1 : 1;
          nr.pts.push(...aroundWell(e, nr.pts[nr.pts.length - 1], [p.x, p.y], side), [p.x, p.y]); nr.endHeading = p.heading;
        }
        if (r.enter && r.enter.lift === "esc" && runs[i - 1]) {
          const p = escPose(e, runs[i - 1].f < r.f ? "fromBelow" : "fromAbove");
          while (nr.pts.length > 1 && inWell(nr.pts[0])) nr.pts.shift();
          const side = runs[i - 1].f < r.f ? 1 : -1;
          nr.pts.unshift([p.x, p.y], ...aroundWell(e, [p.x, p.y], nr.pts[0], side)); nr.startHeading = p.heading;
        }
      }
      // 行き先が店のときは、店の中まで入らずに入口の前で店の方を向いて止まる
      const shop = (info.shops || []).find((sh) => i === runs.length - 1 && opts.to && sh.id === opts.to.id);
      const door = shop && shopDoor(info, shop);
      if (door) {
        const ok = ([x, y]) => { const v = info.walk[Math.floor(y / CELL) * info.cols + Math.floor(x / CELL)]; return v === 1 || v === 2; };
        // 経路を後ろから見て、廊下にいる最後の点まで戻る（エスカレーター区画や店の中は通らない）
        let k = nr.pts.length - 1;
        while (k > 0 && !ok(nr.pts[k])) k--;
        const keep = nr.pts.slice(0, k + 1);
        const via = corridorPath(info, keep[keep.length - 1], [door.x, door.y]);
        if (via) {
          nr.pts = [...keep, ...via, [door.x, door.y]];
          nr.endHeading = door.heading;
        }
      }
      // 行き先が受付カウンターのときは、カウンターの正面に立つ
      const counter = (info.counters || []).find((cn) => i === runs.length - 1 && opts.to && cn.id === opts.to.id);
      const stand = counter && counterStand(info, counter);
      if (stand) {
        const ok = ([x, y]) => { const v = info.walk[Math.floor(y / CELL) * info.cols + Math.floor(x / CELL)]; return v === 1 || v === 2; };
        let k = nr.pts.length - 1;
        while (k > 0 && !ok(nr.pts[k])) k--;
        const keep = nr.pts.slice(0, k + 1);
        const via = corridorPath(info, keep[keep.length - 1], [stand.x, stand.y]) || [];
        nr.pts = [...keep, ...via, [stand.x, stand.y]];
        nr.endHeading = stand.heading;
      }
      out.push(nr);
    }
    return out;
  }

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
        let h = heading;
        if (i === seq.length - 1 && r.endHeading != null) h = r.endHeading;
        if (i === 0 && r.startHeading != null && seq.length === 1) h = r.startHeading;
        out.push({ f: r.f, x: p[0], y: p[1], heading: h, run: ri, last: i === seq.length - 1 });
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
      if (Math.hypot(p.at[0] - v.x, p.at[1] - v.y) * M < 5) { near = { p, ph }; break; }
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
    renderer.setClearColor(0xf4f4f1);
    stage.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf4f4f1, 14, 55);
    scene.add(new THREE.HemisphereLight(0xfffdf6, 0xc9c2b4, 0.85));
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const sun = new THREE.DirectionalLight(0xffffff, 0.3); sun.position.set(0.4, 1, 0.6); scene.add(sun);
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
    const token = (render.token = (render.token || 0) + 1);
    prepareRuns(o.runs).then((runs) => {
      if (token !== render.token || !renderer) return;
      opts.runs = runs;
      views = makeViews(runs);
      go(0, false);
    });
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
