/*
 * 3D表示：各階のフロアマップ画像を積み重ね、経路を階をまたいで立体で描く。
 * three.js r128（vendor/）を使用。
 */
(() => {
  "use strict";
  const S = 0.01;          // 画像1px → 3D空間の単位
  const GAP = 2.4;         // 階の間隔
  const RED = 0xe72510, GREEN = 0x1f8a4c, NAVY = 0x004f80;

  let renderer, scene, camera, controls, raf, marker, path, textures = {};

  const floorY = (f) => (f - 1) * GAP;
  const to3 = (H, f, x, y) => {
    const o = H.floors[f].offset || [0, 0];
    return new THREE.Vector3((x + o[0]) * S, floorY(f) + 0.04, (y + o[1]) * S);
  };

  function label(text, color) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = color; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#fff"; g.font = "bold 72px 'Work Sans', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 128, 68);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sp.scale.set(1.3, 0.65, 1);
    return sp;
  }

  function pin(color) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 20), m);
    cone.rotation.x = Math.PI; cone.position.y = 0.45;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), m);
    ball.position.y = 0.9;
    g.add(cone, ball);
    return g;
  }

  function dispose() {
    cancelAnimationFrame(raf);
    if (controls) controls.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
    renderer = scene = camera = controls = marker = path = null;
  }

  function render(el, { H, runs, floors, from, to }) {
    dispose();
    const w = el.clientWidth, h = el.clientHeight || Math.round(w * 0.75);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 500);

    // 表示する階：経路の階の範囲（経路がなければ全階）
    const all = Object.keys(H.floors).map(Number);
    const lo = floors.length ? Math.min(...floors) : Math.min(...all);
    const hi = floors.length ? Math.max(...floors) : Math.max(...all);
    const loader = new THREE.TextureLoader();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    for (const f of all) {
      if (f < lo - 1 || f > hi + 1) continue;
      const fl = H.floors[f], o = fl.offset || [0, 0];
      const active = floors.includes(f);
      const inRange = f >= lo && f <= hi;
      const tex = textures[f] || (textures[f] = loader.load(fl.img));
      tex.anisotropy = maxAniso;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide,
        opacity: active ? 0.97 : inRange ? 0.28 : 0.1, depthWrite: active
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(fl.w * S, fl.h * S), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((fl.w / 2 + o[0]) * S, floorY(f), (fl.h / 2 + o[1]) * S);
      plane.renderOrder = active ? 2 : 1;
      scene.add(plane);
      // 床の縁取り
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(fl.w * S, fl.h * S)),
        new THREE.LineBasicMaterial({ color: NAVY, transparent: true, opacity: active ? 0.5 : 0.15 })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.copy(plane.position);
      scene.add(edge);
      const lb = label(`${f}F`, active ? "#004f80" : "#99b9cc");
      lb.position.set(o[0] * S - 0.6, floorY(f) + 0.35, (fl.h * 0.5 + o[1]) * S);
      scene.add(lb);
    }

    // 経路（階をまたぐ縦の線を含めて1本のチューブにする）
    const pts = [];
    runs.forEach((r) => r.pts.forEach(([x, y]) => pts.push(to3(H, r.f, x, y))));
    const box = new THREE.Box3();
    if (pts.length >= 2) {
      path = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) {
        if (pts[i].distanceTo(pts[i + 1]) > 1e-4) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      }
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(path, Math.max(64, path.curves.length * 12), 0.07, 10, false),
        new THREE.MeshBasicMaterial({ color: RED })
      );
      tube.renderOrder = 3;
      scene.add(tube);
      marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.35 }));
      marker.add(ring);
      scene.add(marker);
      pts.forEach((p) => box.expandByPoint(p));
    }
    if (from) { const p = pin(GREEN); p.position.copy(to3(H, from.f, ...from.at)); scene.add(p); box.expandByPoint(p.position); }
    if (to) { const p = pin(RED); p.position.copy(to3(H, to.f, ...to.at)); scene.add(p); box.expandByPoint(p.position); }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(9, floorY(3), 5), new THREE.Vector3(17, 1, 10));

    // カメラ：経路全体が入るように斜め上から
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, size.y * 1.3, 11);
    camera.position.set(center.x - r * 0.55, center.y + r * 0.85, center.z + r * 1.15);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.addEventListener("start", () => { controls.autoRotate = false; });
    controls.update();

    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (marker && path) {
        const t = (clock.getElapsedTime() / Math.max(4, path.curves.length * 0.6)) % 1;
        marker.position.copy(path.getPointAt(t));
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  function resize(el) {
    if (!renderer) return;
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.View3D = { render, dispose, resize };
})();
