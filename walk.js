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
        if (edge && start < 0) { start = q; si = sideInfo(q, r + side); }
        if (!edge && start >= 0) { push(start * CELL, (side < 0 ? r : r + 1) * CELL, true, (q - start) * CELL, 0, -side, si); start = -1; }
      }
    }
    for (let q = 0; q < cols; q++) for (const side of [-1, 1]) {
      let start = -1, si = null;
      for (let r = 0; r <= rows; r++) {
        const edge = r < rows && isW(q, r) && !isW(q + side, r);
        if (edge && start < 0) { start = r; si = sideInfo(q + side, r); }
        if (!edge && start >= 0) { push((side < 0 ? q : q + 1) * CELL, start * CELL, false, (r - start) * CELL, -side, 0, si); start = -1; }
      }
    }

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
    for (const sg of segs) {
      const L = sg.len;
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
    const nearRoute = (q, r, k) => { for (let dr = -k; dr <= k; dr++) for (let dq = -k; dq <= k; dq++) if (walk[(r + dr) * cols + q + dq] === 2) return true; return false; };
    for (let r = 2; r < rows - 2; r++) for (let q = 2; q < cols - 2; q++) {
      if (!isW(q, r)) continue;
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
      leaf: new THREE.MeshLambertMaterial({ color: 0x5d9b5a, flatShading: true })
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

    // 床：木目調のシート
    const W = fl.w * M, D = fl.h * M;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tileTexture(floorTile, 256, 2.4, W, D), color: 0xeae4da }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(fl.w * M / 2, 0, fl.h * M / 2);
    group.add(floor);
    // 天井
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tileTexture(ceilTile, 64, 0.6, W, D), side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(fl.w * M / 2, WALL_H, fl.h * M / 2);
    group.add(ceil);
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
