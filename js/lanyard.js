/* ==========================================================================
   lanyard.js — kartu ID 3D yang menggantung di tali (lanyard)

   Cara kerjanya, singkatnya:
   1. Tampilan kartu (depan, belakang, motif tali) digambar pakai <canvas> 2D,
      lalu ditempel ke objek 3D sebagai "texture".
   2. Fisikanya pakai metode Verlet + Position Based Dynamics:
      - Tali = deretan titik yang jaraknya dijaga tetap (seperti rantai).
      - Kartu = 3 titik (lubang atas, sudut kiri bawah, sudut kanan bawah)
        yang jaraknya dikunci, jadi kartu bisa berayun dan berputar ke segala arah.
   3. Tiap frame: hitung fisika -> pindahkan objek 3D -> render dengan three.js.

   Kalau WebGL tidak ada atau file ini gagal dimuat, halaman tetap jalan
   dan yang tampil adalah kartu statis (.badge-fallback di index.html).
   ========================================================================== */

import * as THREE from './vendor/three.module.min.js';

const root = document.documentElement;
const stage = document.querySelector('.badge-stage');
const hero = stage ? (stage.closest('.hero') || stage) : null;
const canvas = document.getElementById('badge-canvas');
const hint = document.querySelector('.badge-hint');
const ruler = document.querySelector('.badge-ruler');
const desktopQuery = window.matchMedia('(min-width: 901px)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Ukuran (satuan dunia 3D) & angka fisika ---------- */
const CARD_W = 1.6;
const CARD_H = 2.54;            // rasio kartu ID asli (85.6 x 54 mm)
const CARD_D = 0.03;            // tebal kartu
const HOLE_FROM_TOP = 0.14;     // posisi lubang klip dari tepi atas kartu
const SEGMENTS = 10;            // jumlah ruas tali
const SEG_LEN = 0.23;           // panjang tiap ruas
const GRAVITY = -16;
const STEP = 1 / 120;           // fisika dihitung 120x per detik
const ITERATIONS = 12;          // makin banyak = tali makin kaku & stabil
const STRAP_W = 0.2;            // lebar tali
const STRAP_REPEAT = STRAP_W * 4; // panjang satu ulangan motif tali

const TEX_W = 1024;
const TEX_H = Math.round(TEX_W * CARD_H / CARD_W);

const COLORS = {
  bg: '#08080f',
  cyan: '#00f0ff',
  magenta: '#ff2a6d',
  yellow: '#f5e663',
  text: '#e8f1ff',
  muted: '#9aa3bf',
  dim: '#6c7493'
};

const DISPLAY_FONT = '"Chakra Petch", "Segoe UI", sans-serif';
const MONO_FONT = '"JetBrains Mono", Consolas, monospace';

if (stage && canvas && hasWebGL()) {
  init().catch((err) => console.warn('[lanyard] kartu 3D dimatikan:', err));
}

/* ==========================================================================
   SETUP
   ========================================================================== */
async function init() {
  const [photo] = await Promise.all([loadImage('assets/img/profile.jpg'), loadFonts()]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  scene.environment = makeNeonEnvironment(renderer);
  addLights(scene);

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const frontTex = makeTexture(drawFront(photo), aniso);
  const backTex = makeTexture(drawBack(), aniso);
  const strapTex = makeTexture(drawStrap(), aniso);
  strapTex.wrapT = THREE.RepeatWrapping;

  const card = makeCard(frontTex, backTex);
  const clip = makeClip();
  const strap = makeStrap(strapTex);
  scene.add(card, clip, strap.mesh);

  /* ---------- Titik-titik fisika ----------
     P[0]            = jangkar di atas layar (diam)
     P[1..SEGMENTS]  = ruas tali; P[SEGMENTS] sekaligus lubang kartu
     P[BL], P[BR]    = sudut kiri bawah & kanan bawah kartu            */
  const H = SEGMENTS;
  const BL = SEGMENTS + 1;
  const BR = SEGMENTS + 2;
  const P = [];
  for (let i = 0; i <= SEGMENTS + 2; i++) {
    // w = 1/massa. Tali dibuat lebih ringan dari kartu; jangkar w = 0 (tidak bergerak)
    const w = i === 0 ? 0 : (i < SEGMENTS ? 2.5 : 1);
    P.push({ p: new THREE.Vector3(), q: new THREE.Vector3(), w });
  }

  const DIAG = Math.hypot(CARD_W / 2, CARD_H - HOLE_FROM_TOP);
  const constraints = [];
  for (let i = 0; i < SEGMENTS; i++) constraints.push([i, i + 1, SEG_LEN]);
  constraints.push([H, BL, DIAG], [H, BR, DIAG], [BL, BR, CARD_W]);

  const ROPE_LEN = SEGMENTS * SEG_LEN;
  const anchor = new THREE.Vector3();
  let halfW = 3; // setengah lebar & tinggi area yang terlihat (satuan dunia 3D)
  let halfH = 3;

  // Variabel kerja (dibuat sekali, dipakai ulang tiap frame supaya hemat memori)
  const r = new THREE.Vector3();
  const u = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const center = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  // Status drag
  const grab = { lx: 0, ly: 0, z: 0 };
  const dragTarget = new THREE.Vector3();
  const lastPointer = new THREE.Vector3();
  const pointerVel = new THREE.Vector3();
  const instVel = new THREE.Vector3();
  let lastPointerTime = 0;
  let dragging = false;

  let started = false;
  let interacted = false;

  /* ---------- Fisika ---------- */

  // Hitung arah kartu dari 3 titiknya: r = kanan, u = atas, n = depan
  function cardFrame() {
    r.subVectors(P[BR].p, P[BL].p).normalize();
    mid.addVectors(P[BL].p, P[BR].p).multiplyScalar(0.5);
    u.subVectors(P[H].p, mid);
    u.addScaledVector(r, -u.dot(r)).normalize();
    n.crossVectors(r, u);
    center.copy(mid).addScaledVector(u, CARD_H / 2);
  }

  function solveDistance(a, b, rest) {
    const pa = P[a];
    const pb = P[b];
    const wSum = pa.w + pb.w;
    if (wSum === 0) return;
    tmp.subVectors(pb.p, pa.p);
    const len = tmp.length();
    if (len < 1e-6) return;
    const diff = (len - rest) / (len * wSum);
    pa.p.addScaledVector(tmp, pa.w * diff);
    pb.p.addScaledVector(tmp, -pb.w * diff);
  }

  // Tarik titik yang dipegang mouse/jari ke arah posisi pointer
  function pullToPointer() {
    cardFrame();
    tmp.copy(center).addScaledVector(r, grab.lx).addScaledVector(u, grab.ly);
    tmp2.subVectors(dragTarget, tmp).multiplyScalar(0.3);
    P[H].p.add(tmp2);
    P[BL].p.add(tmp2);
    P[BR].p.add(tmp2);
  }

  // Putar kartu: spin = berputar ke kiri/kanan, flip = jungkir ke depan/belakang
  function twist(spin, flip) {
    P[BL].p.z -= spin;
    P[BR].p.z += spin;
    P[BL].p.z += flip;
    P[BR].p.z += flip;
  }

  function step(dt, t) {
    const dt2 = dt * dt;
    // Angin kecil supaya kartu tetap "hidup" walau tidak disentuh
    const wind = (!dragging && !reduceMotion) ? Math.sin(t * 0.9) * 0.35 + Math.sin(t * 2.3) * 0.12 : 0;

    // 1. Integrasi Verlet: posisi baru = posisi + kecepatan + gravitasi
    for (let i = 1; i < P.length; i++) {
      const pt = P[i];
      const damping = i < SEGMENTS ? 0.985 : 0.9975;
      tmp.subVectors(pt.p, pt.q).multiplyScalar(damping);
      pt.q.copy(pt.p);
      pt.p.add(tmp);
      pt.p.y += GRAVITY * dt2;
      if (i >= SEGMENTS) pt.p.x += wind * dt2;
    }

    // Saat di-drag, gerakan pointer ikut memutar kartu sedikit
    if (dragging) {
      twist(clamp(pointerVel.x * 0.0004, -0.003, 0.003), clamp(-pointerVel.y * 0.0003, -0.003, 0.003));
    }

    // 2. Perbaiki jarak antar titik berkali-kali sampai stabil
    for (let k = 0; k < ITERATIONS; k++) {
      for (let c = 0; c < constraints.length; c++) {
        const con = constraints[c];
        solveDistance(con[0], con[1], con[2]);
      }
      if (dragging) pullToPointer();
      P[0].p.copy(anchor);
    }

    // 3. Pegas puntir halus: kartu pelan-pelan kembali menghadap depan/belakang
    //    (saat di-drag lebih kuat, supaya kartu tidak terlihat dari samping terus)
    const dz = (P[BL].p.z - P[BR].p.z) * (dragging ? 0.004 : 0.0006);
    P[BL].p.z -= dz;
    P[BR].p.z += dz;

    // Jangan sampai kartu menabrak kamera
    for (let i = 1; i < P.length; i++) {
      P[i].p.z = clamp(P[i].p.z, -3, 3);
    }
  }

  /* ---------- Posisi awal ---------- */
  function setPoint(i, x, y, z) {
    P[i].p.set(x, y, z);
    P[i].q.copy(P[i].p);
  }

  function placeCardBelowHole() {
    const hp = P[H].p;
    const drop = CARD_H - HOLE_FROM_TOP;
    setPoint(BL, hp.x - CARD_W / 2, hp.y - drop, hp.z);
    setPoint(BR, hp.x + CARD_W / 2, hp.y - drop, hp.z);
  }

  // Diam menggantung lurus ke bawah
  function placeAtRest() {
    for (let i = 0; i <= SEGMENTS; i++) setPoint(i, anchor.x, anchor.y - SEG_LEN * i, 0);
    placeCardBelowHole();
  }

  // Mulai dari atas layar, lalu jatuh dan berayun
  function placeForDrop() {
    const sway = desktopQuery.matches ? 0.16 : 0.07; // layar HP sempit, ayunannya dikecilkan
    for (let i = 0; i <= SEGMENTS; i++) {
      setPoint(i, anchor.x + sway * i, anchor.y + SEG_LEN * i * 0.92, 0);
    }
    placeCardBelowHole();
    // Sedikit putaran awal biar jatuhnya dramatis
    P[BL].q.z = P[BL].p.z - 0.012;
    P[BR].q.z = P[BR].p.z + 0.012;
  }

  /* ---------- Sinkronkan objek 3D dengan fisika ---------- */
  const strapPoints = [];
  for (let i = 0; i <= SEGMENTS + 1; i++) strapPoints.push(new THREE.Vector3());

  function updateScene() {
    cardFrame();
    basis.makeBasis(r, u, n);
    card.position.copy(center);
    card.quaternion.setFromRotationMatrix(basis);

    clip.position.copy(P[H].p).addScaledVector(u, 0.03);
    clip.quaternion.copy(card.quaternion);

    // Tali: dari jauh di atas layar -> ruas-ruas tali -> ujung atas klip
    strapPoints[0].copy(anchor).add(tmp.set(0, 3, 0));
    for (let i = 0; i < SEGMENTS; i++) strapPoints[i + 1].copy(P[i].p);
    strapPoints[SEGMENTS + 1].copy(P[H].p).addScaledVector(u, 0.16);
    strap.update(strapPoints, r);
  }

  /* ---------- Ukuran layar ---------- */
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // Atur sudut pandang kamera supaya tinggi kartu di layar = --card-px di CSS
    const cardPx = (ruler && ruler.offsetHeight) || 380;
    halfH = (h * (CARD_H / cardPx)) / 2;
    halfW = halfH * camera.aspect;
    camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(halfH / camera.position.z));
    camera.updateProjectionMatrix();

    // Desktop: kartu di tengah kolom kanan. HP: di tengah.
    // Jangkar sedikit di atas tepi layar, jadi tali seolah keluar dari bawah header.
    tmp2.set(desktopQuery.matches ? halfW * 0.5 : 0, halfH + 0.35, 0);

    if (started) {
      // Geser semua titik bersamaan supaya kartu tidak "loncat" saat layar di-resize
      tmp.subVectors(tmp2, anchor);
      P.forEach((pt) => { pt.p.add(tmp); pt.q.add(tmp); });
    }
    anchor.copy(tmp2);

    if (started) {
      updateScene();
      renderer.render(scene, camera);
    }
  }

  /* ---------- Interaksi: mouse, sentuhan, keyboard ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function aim(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitCard(clientX, clientY) {
    aim(clientX, clientY);
    card.updateMatrixWorld();
    const hits = raycaster.intersectObject(card, false);
    return hits.length ? hits[0] : null;
  }

  function startDrag(clientX, clientY) {
    if (!started) return false;
    const hit = hitCard(clientX, clientY);
    if (!hit) return false;

    cardFrame();
    tmp.subVectors(hit.point, center);
    grab.lx = tmp.dot(r);
    grab.ly = tmp.dot(u);
    grab.z = hit.point.z;

    dragTarget.copy(hit.point);
    lastPointer.copy(hit.point);
    lastPointerTime = performance.now();
    pointerVel.set(0, 0, 0);

    dragging = true;
    hero.classList.add('is-grabbing');
    hideHint();
    updateRunning();
    return true;
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    aim(clientX, clientY);
    plane.constant = -grab.z;
    if (!raycaster.ray.intersectPlane(plane, tmp)) return;

    // Tali tidak bisa melar: batasi seberapa jauh kartu bisa ditarik dari jangkar
    const holeToGrab = Math.hypot(grab.lx, grab.ly - (CARD_H / 2 - HOLE_FROM_TOP));
    const maxReach = ROPE_LEN + holeToGrab + 0.1;
    tmp2.subVectors(tmp, anchor);
    if (tmp2.length() > maxReach) tmp.copy(anchor).addScaledVector(tmp2.normalize(), maxReach);

    // Jangan sampai kartu ditarik keluar dari layar
    tmp.x = clamp(tmp.x, -halfW + 0.6, halfW - 0.6);
    tmp.y = clamp(tmp.y, -halfH + 0.4, halfH - 0.4);

    const now = performance.now();
    const dt = Math.max((now - lastPointerTime) / 1000, 1 / 240);
    instVel.subVectors(tmp, lastPointer).divideScalar(dt);
    pointerVel.lerp(instVel, 0.35);
    lastPointer.copy(tmp);
    lastPointerTime = now;
    dragTarget.copy(tmp);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    hero.classList.remove('is-grabbing');
    // Kalau pointer sempat berhenti sebelum dilepas, jangan kasih lemparan
    if (performance.now() - lastPointerTime > 80) pointerVel.set(0, 0, 0);
    // "Lemparan": kecepatan geser saat dilepas jadi putaran kartu
    twist(clamp(pointerVel.x * 0.006, -0.06, 0.06), clamp(-pointerVel.y * 0.004, -0.04, 0.04));
    pointerVel.set(0, 0, 0);
  }

  // Event dipasang di seluruh hero (bukan di canvas), karena canvas dibuat
  // tembus klik. Kalau pointer kena kartu -> mulai drag. Kalau tidak -> biarkan
  // klik/scroll/seleksi teks berjalan normal.

  // Mouse & pen pakai Pointer Events
  hero.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (startDrag(e.clientX, e.clientY)) {
      hero.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  let hoverQueued = false;
  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (dragging) {
      moveDrag(e.clientX, e.clientY);
      return;
    }
    if (hoverQueued || !started) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      hero.classList.toggle('is-hovering', !!hitCard(e.clientX, e.clientY));
    });
  });

  hero.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') endDrag(); });
  hero.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') endDrag(); });
  hero.addEventListener('pointerleave', () => hero.classList.remove('is-hovering'));

  // Sentuhan: halaman tetap bisa di-scroll, kecuali jari tepat menyentuh kartu
  hero.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (startDrag(t.clientX, t.clientY)) e.preventDefault();
  }, { passive: false });

  hero.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });

  hero.addEventListener('touchend', endDrag);
  hero.addEventListener('touchcancel', endDrag);

  // Pindah antara layout desktop & HP -> posisi jangkar ikut pindah
  desktopQuery.addEventListener('change', resize);

  // Keyboard: panah kiri/kanan = putar, atas/bawah = jungkir
  canvas.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] };
    const k = keys[e.key];
    if (!k || !started) return;
    e.preventDefault();
    twist(k[0], k[1]);
    hideHint();
    updateRunning();
  });

  function showHint() {
    if (hint && !interacted) hint.classList.add('is-visible');
  }

  function hideHint() {
    interacted = true;
    if (hint) hint.classList.remove('is-visible');
  }

  /* ---------- Loop animasi (berhenti saat kartu tidak terlihat) ---------- */
  let running = false;
  let inView = true;
  let lastFrame = 0;
  let accumulator = 0;
  let simTime = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    accumulator += Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    while (accumulator >= STEP) {
      step(STEP, simTime);
      simTime += STEP;
      accumulator -= STEP;
    }
    updateScene();
    renderer.render(scene, camera);
  }

  function updateRunning() {
    const shouldRun = started && inView && !document.hidden;
    if (shouldRun && !running) {
      running = true;
      lastFrame = performance.now();
      requestAnimationFrame(frame);
    } else if (!shouldRun) {
      running = false;
    }
  }

  new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    updateRunning();
  }).observe(stage);
  document.addEventListener('visibilitychange', updateRunning);

  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---------- Mulai: setelah opening selesai ---------- */
  function start() {
    if (started) return;
    started = true;
    if (reduceMotion) placeAtRest(); else placeForDrop();
    updateScene();
    renderer.render(scene, camera);
    updateRunning();
    setTimeout(showHint, reduceMotion ? 300 : 1800);
  }

  root.classList.add('has-webgl');

  if (root.classList.contains('intro-done') || root.classList.contains('intro-released')) {
    start();
  } else {
    document.addEventListener('intro:done', start, { once: true });
  }
}

/* ==========================================================================
   OBJEK 3D
   ========================================================================== */
function makeCard(frontTex, backTex) {
  const geometry = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D);

  // Sisi tebal kartu menyala neon
  const edge = new THREE.MeshStandardMaterial({
    color: 0x0a0a12,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.9,
    metalness: 0.4,
    roughness: 0.4
  });

  // Permukaan depan/belakang: mengkilap + efek hologram (iridescence)
  const face = (tex) => new THREE.MeshPhysicalMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    roughness: 0.32,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    iridescence: 0.55,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [180, 520]
  });

  // Urutan sisi BoxGeometry: kanan, kiri, atas, bawah, depan, belakang
  return new THREE.Mesh(geometry, [edge, edge, edge, edge, face(frontTex), face(backTex)]);
}

function makeClip() {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0d0, metalness: 1, roughness: 0.25 });
  const group = new THREE.Group();

  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), metal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 10, 24), metal);
  ring.position.y = 0.12;

  group.add(plate, ring);
  return group;
}

// Tali berbentuk pita pipih yang mengikuti titik-titik fisika
function makeStrap(texture) {
  const SAMPLES = 64;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(SAMPLES * 2 * 3);
  const uvs = new Float32Array(SAMPLES * 2 * 2);
  const index = [];
  for (let i = 0; i < SAMPLES - 1; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: 0.45,
    roughness: 0.55,
    metalness: 0.2,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const curve = new THREE.CatmullRomCurve3([], false, 'centripetal');
  const samples = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const towardCamera = new THREE.Vector3(0, 0, 1);

  function update(points, cardRight) {
    curve.points = points;
    for (let i = 0; i < SAMPLES; i++) curve.getPoint(i / (SAMPLES - 1), samples[i]);

    let length = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const prev = samples[Math.max(i - 1, 0)];
      const next = samples[Math.min(i + 1, SAMPLES - 1)];
      tangent.subVectors(next, prev).normalize();

      // Pita menghadap kamera, tapi di dekat kartu ikut terpuntir mengikuti kartu
      side.crossVectors(tangent, towardCamera);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      facing.copy(cardRight);
      if (facing.dot(side) < 0) facing.negate();
      side.lerp(facing, smoothstep(0.75, 1, i / (SAMPLES - 1))).normalize();

      if (i > 0) length += samples[i].distanceTo(samples[i - 1]);

      const p = samples[i];
      const o = i * 6;
      positions[o] = p.x - side.x * STRAP_W / 2;
      positions[o + 1] = p.y - side.y * STRAP_W / 2;
      positions[o + 2] = p.z - side.z * STRAP_W / 2;
      positions[o + 3] = p.x + side.x * STRAP_W / 2;
      positions[o + 4] = p.y + side.y * STRAP_W / 2;
      positions[o + 5] = p.z + side.z * STRAP_W / 2;

      const t = i * 4;
      uvs[t] = 0;
      uvs[t + 1] = length / STRAP_REPEAT;
      uvs[t + 2] = 1;
      uvs[t + 3] = length / STRAP_REPEAT;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { mesh, update };
}

// Pantulan neon di permukaan kartu: "ruangan" kecil berisi lampu strip berwarna
function makeNeonEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x020205);

  const strip = (hex, intensity, w, h, x, y, z) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };

  strip(0x00f0ff, 4, 1.2, 8, -5, 0, 3);
  strip(0xff2a6d, 4, 1.2, 8, 5, 0, 3);
  strip(0xffffff, 2.5, 8, 1, 0, 5, 4);
  strip(0x6a5cff, 2, 6, 1, 0, -5, 2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return texture;
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 8);

  const rimCyan = new THREE.DirectionalLight(0x00f0ff, 2.2);
  rimCyan.position.set(-6, 1, 3);

  const rimMagenta = new THREE.DirectionalLight(0xff2a6d, 2.0);
  rimMagenta.position.set(6, -2, 3);

  scene.add(key, rimCyan, rimMagenta);
}

function makeTexture(source, anisotropy) {
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/* ==========================================================================
   DESAIN KARTU (digambar dengan Canvas 2D)
   ========================================================================== */

// Latar, bingkai neon, dan lubang klip: sama untuk sisi depan & belakang
function drawCardBase(ctx, W, H) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) line(ctx, x + 0.5, 0, x + 0.5, H);
  for (let y = 0; y <= H; y += 32) line(ctx, 0, y + 0.5, W, y + 0.5);

  ctx.save();
  ctx.shadowColor = COLORS.cyan;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 5;
  chamfer(ctx, 22, 22, W - 44, H - 44, 64);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
  ctx.lineWidth = 2;
  chamfer(ctx, 40, 40, W - 80, H - 80, 52);
  ctx.stroke();

  // Lubang tempat klip
  ctx.fillStyle = '#000';
  roundRect(ctx, W / 2 - 90, 72, 180, 30, 15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawFront(photo) {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  const W = TEX_W;
  drawCardBase(ctx, W, TEX_H);

  // Kepala kartu
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 40px ${DISPLAY_FONT}`;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('A.R SYSTEMS', 72, 160);
  ctx.textAlign = 'right';
  ctx.font = `500 24px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('ID // NO.001', W - 72, 158);
  ctx.textAlign = 'left';

  ctx.fillStyle = COLORS.magenta;
  ctx.fillRect(72, 180, W - 144, 3);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(W - 132, 178, 60, 7);

  // Jendela foto
  const px = 72;
  const py = 204;
  const pw = W - 144;
  const ph = 720;
  ctx.save();
  chamfer(ctx, px, py, pw, ph, 40);
  ctx.clip();
  ctx.fillStyle = '#11111c';
  ctx.fillRect(px, py, pw, ph);
  if (photo) {
    const scale = Math.max(pw / photo.width, ph / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    ctx.drawImage(photo, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
  ctx.fillRect(px, py, pw, ph);
  ctx.globalCompositeOperation = 'source-over';
  const fade = ctx.createLinearGradient(0, py + ph * 0.55, 0, py + ph);
  fade.addColorStop(0, 'rgba(8, 8, 15, 0)');
  fade.addColorStop(1, 'rgba(8, 8, 15, 0.9)');
  ctx.fillStyle = fade;
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = py; y < py + ph; y += 6) ctx.fillRect(px, y, pw, 2);
  ctx.restore();

  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 3;
  chamfer(ctx, px, py, pw, ph, 40);
  ctx.stroke();

  ctx.font = `700 22px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.yellow;
  ctx.fillText('[ VERIFIED ]', px + 26, py + 46);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('SUBJ: A.RUDOLPH', px + 26, py + ph - 28);
  ctx.textAlign = 'right';
  ctx.fillText('SI // 06', px + pw - 26, py + ph - 28);
  ctx.textAlign = 'left';

  // Level: 6 hexagon = semester 6
  ctx.font = `700 28px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.magenta;
  ctx.fillText('LV', 72, 990);
  ctx.save();
  ctx.shadowColor = COLORS.cyan;
  ctx.shadowBlur = 10;
  ctx.fillStyle = COLORS.cyan;
  for (let i = 0; i < 6; i++) {
    hexagon(ctx, 140 + i * 46, 980, 16, Math.PI / 6);
    ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = 'right';
  ctx.font = `500 24px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('SEMESTER 06', W - 72, 990);
  ctx.textAlign = 'left';

  // Nama & tipe
  ctx.save();
  fitFont(ctx, 'AGHASHA RUDOLPH', 700, DISPLAY_FONT, 92, W - 144);
  ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('AGHASHA RUDOLPH', 72, 1072);
  ctx.restore();

  ctx.font = `500 28px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.magenta;
  ctx.fillText('[ SYSTEM ANALYST / APP BUILDER ]', 72, 1120);

  // Kotak "efek" ala trading card
  chamfer(ctx, 72, 1150, W - 144, 246, 28);
  ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `700 22px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('EFFECT //', 100, 1194);
  ctx.font = `500 31px ${DISPLAY_FONT}`;
  ctx.fillStyle = '#d5def0';
  wrapText(ctx, 'When this card joins a project: map the current process, model the data, then ship the features that remove busywork.', 100, 1242, W - 200, 42);

  // Barcode & stat
  const rand = rng(2026);
  ctx.fillStyle = 'rgba(232, 241, 255, 0.85)';
  for (let x = 72; x < 440;) {
    const bw = 2 + Math.floor(rand() * 7);
    if (rand() > 0.3) ctx.fillRect(x, 1432, bw, 84);
    x += bw + 2 + Math.floor(rand() * 4);
  }
  ctx.font = `500 20px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('AR-2026-SI-06', 72, 1550);

  drawStat(ctx, 'LOGIC ', '2400', COLORS.cyan, W - 72, 1470);
  drawStat(ctx, 'BUILD ', '2100', COLORS.magenta, W - 72, 1520);

  return c;
}

function drawStat(ctx, label, value, color, right, y) {
  ctx.textAlign = 'right';
  ctx.font = `700 34px ${MONO_FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(value, right, y);
  const valueWidth = ctx.measureText(value).width;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText(label, right - valueWidth, y);
  ctx.textAlign = 'left';
}

function drawBack() {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  const W = TEX_W;
  const cx = W / 2;
  drawCardBase(ctx, W, TEX_H);

  hazardStripe(ctx, 72, 140, W - 144, 34);
  hazardStripe(ctx, 72, 1500, W - 144, 34);

  // Logo A.R SYSTEMS: hexagon + monogram "AR"
  const cy = 600;
  ctx.save();
  ctx.shadowColor = COLORS.cyan;
  ctx.shadowBlur = 30;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 10;
  hexagon(ctx, cx, cy, 250, Math.PI / 6);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
  ctx.lineWidth = 3;
  hexagon(ctx, cx, cy, 212, Math.PI / 6);
  ctx.stroke();

  ctx.fillStyle = COLORS.magenta;
  hexagon(ctx, cx, cy - 250, 18, Math.PI / 6);
  ctx.fill();
  hexagon(ctx, cx, cy + 250, 18, Math.PI / 6);
  ctx.fill();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 200px ${DISPLAY_FONT}`;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.7)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('AR', cx, cy + 4);
  ctx.restore();
  ctx.fillStyle = COLORS.magenta;
  ctx.fillRect(cx - 90, cy + 100, 180, 8);

  // Nama korporat
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  fitFont(ctx, 'A.R SYSTEMS', 700, DISPLAY_FONT, 100, W - 200);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('A.R SYSTEMS', cx, 980);
  ctx.font = `500 28px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('INFORMATION SYSTEMS DIVISION', cx, 1030);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  line(ctx, 140, 1070, W - 140, 1070);

  // Data pemilik
  const rows = [
    ['OWNER', 'AGHASHA RUDOLPH'],
    ['ROLE', 'SYSTEM ANALYST'],
    ['STACK', 'LARAVEL / FLUTTER / REACT'],
    ['GITHUB', 'RUDOLPH-04']
  ];
  ctx.font = `500 27px ${MONO_FONT}`;
  rows.forEach(([label, value], i) => {
    const y = 1130 + i * 48;
    const prefix = label + ' ' + '.'.repeat(9 - label.length) + ' ';
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(prefix, 110, y);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(value, 110 + ctx.measureText(prefix).width, y);
  });

  ctx.font = `500 21px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('PROPERTY OF A.R SYSTEMS.', 110, 1400);
  ctx.fillText('IF FOUND, RETURN TO OWNER.', 110, 1432);

  // Pola titik-titik dekoratif
  const rand = rng(7);
  const cell = 12;
  const mx = W - 110 - cell * 10;
  ctx.fillStyle = COLORS.cyan;
  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 10; gx++) {
      if (rand() > 0.5) ctx.fillRect(mx + gx * cell, 1342 + gy * cell, cell - 2, cell - 2);
    }
  }

  return c;
}

// Motif tali: tulisan berulang di sepanjang pita
function drawStrap() {
  const [c, ctx] = makeCanvas(256, 1024);
  ctx.fillStyle = '#0b0b14';
  ctx.fillRect(0, 0, 256, 1024);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(10, 0, 6, 1024);
  ctx.fillRect(240, 0, 6, 1024);

  ctx.save();
  ctx.translate(128, 512);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 72px ${DISPLAY_FONT}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('A.R SYSTEMS', -110, 4);
  ctx.fillStyle = COLORS.magenta;
  ctx.fillText('//', 330, 4);
  ctx.restore();
  return c;
}

/* ==========================================================================
   FUNGSI BANTU
   ========================================================================== */
function hasWebGL() {
  try {
    const test = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (test.getContext('webgl2') || test.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // kartu tetap jadi, tanpa foto
    img.src = src;
  });
}

// Tunggu font selesai dimuat supaya teks di kartu tidak pakai font cadangan
function loadFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const fonts = [
    `700 80px ${DISPLAY_FONT}`,
    `500 30px ${DISPLAY_FONT}`,
    `500 26px ${MONO_FONT}`,
    `700 30px ${MONO_FONT}`
  ];
  const loading = Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
  return Promise.race([loading, timeout]);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Persegi panjang dengan sudut kanan-atas & kiri-bawah terpotong miring
function chamfer(ctx, x, y, w, h, cut) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexagon(ctx, cx, cy, radius, rotation) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i * Math.PI) / 3;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function hazardStripe(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#111118';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.yellow;
  for (let sx = x - h; sx < x + w + h; sx += 44) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + 22, y + h);
    ctx.lineTo(sx + 22 + h, y);
    ctx.lineTo(sx + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let lineText = '';
  for (const word of text.split(' ')) {
    const test = lineText ? lineText + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && lineText) {
      ctx.fillText(lineText, x, y);
      lineText = word;
      y += lineHeight;
    } else {
      lineText = test;
    }
  }
  if (lineText) ctx.fillText(lineText, x, y);
}

// Kecilkan ukuran font sampai teks muat di lebar yang tersedia
function fitFont(ctx, text, weight, family, maxSize, maxWidth) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > 20) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
}

// Angka acak yang selalu sama tiap kali dibuka (supaya barcode tidak berubah-ubah)
function rng(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
