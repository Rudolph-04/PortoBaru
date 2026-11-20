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

// Posisi jendela foto di gambar kartu depan (dalam piksel texture)
const PHOTO = { x: 72, y: 204, w: TEX_W - 144, h: 720, cut: 40 };

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

/* ---------- Shader glitch untuk foto di kartu ----------
   Shader = program kecil yang jalan di GPU untuk tiap piksel.
   uGlitch (0..1) mengatur seberapa parah efeknya:
   0.05 = tenang, 0.4 = glitch kecil, 1 = overload (merah + kilat listrik). */
const GLITCH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLITCH_FRAGMENT = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Satu sambaran listrik vertikal yang zig-zag
  float bolt(vec2 uv, float seed) {
    float x0 = 0.15 + 0.7 * hash(seed);
    float y0 = 0.05 + 0.4 * hash(seed + 1.0);
    float y1 = y0 + 0.35 + 0.45 * hash(seed + 2.0);
    float n = (noise(vec2(uv.y * 9.0, seed * 7.0)) - 0.5) * 0.22
            + (noise(vec2(uv.y * 34.0, seed * 13.0)) - 0.5) * 0.06;
    float d = abs(uv.x - x0 - n);
    float mask = smoothstep(y0, y0 + 0.04, uv.y) * (1.0 - smoothstep(y1 - 0.04, y1, uv.y));
    return mask * 0.0022 / (d + 0.0015);
  }

  void main() {
    // Bagian di luar bingkai miring dibuang supaya bentuk sudutnya tetap
    if (texture2D(uTex, vUv).a < 0.5) discard;

    float g = uGlitch;
    float t = floor(uTime * 24.0) + uSeed; // pola acak berganti 24x per detik
    vec2 uv = vUv;

    // 1. Irisan horizontal yang bergeser
    float band = floor(uv.y * 28.0);
    float on = step(1.0 - 0.5 * g, hash2(vec2(band * 1.7, t)));
    uv.x += (hash2(vec2(band, t)) - 0.5) * 0.12 * g * on;

    // 2. Robekan blok besar saat overload
    float row = floor(uv.y * 6.0);
    float tear = step(0.6, g) * step(0.82, hash2(vec2(row, floor(t * 0.5))));
    uv.x += (hash2(vec2(row, t)) - 0.5) * 0.25 * g * tear;

    // 3. Warna RGB pecah
    float split = 0.002 + 0.025 * g;
    vec3 col = vec3(
      texture2D(uTex, uv + vec2(split, 0.0)).r,
      texture2D(uTex, uv).g,
      texture2D(uTex, uv - vec2(split, split * 0.3)).b
    );

    // 4. Blok noise cyan / magenta
    vec2 blk = floor(vUv * vec2(18.0, 24.0));
    float showBlk = step(0.35, g) * step(1.0 - 0.07 * g, hash2(blk + t));
    vec3 blkCol = mix(vec3(0.0, 0.94, 1.0), vec3(1.0, 0.16, 0.43), step(0.5, hash2(blk * 2.0 + t)));
    col = mix(col, blkCol, showBlk * 0.75);

    // 5. Rona merah saat overload (naik-turun halus, tidak berkedip)
    float red = smoothstep(0.55, 1.0, g);
    col = mix(col, col * vec3(1.3, 0.5, 0.6) + vec3(0.1, 0.0, 0.03), red * 0.85);

    // 6. Garis scan yang berjalan pelan
    float s = fract(vUv.y - uTime * 0.35);
    col += smoothstep(0.0, 0.015, s) * (1.0 - smoothstep(0.015, 0.05, s)) * 0.05;

    // 7. Kilat listrik, hanya saat overload
    float e = bolt(vUv, floor(uTime * 16.0) + uSeed)
            + bolt(vUv, floor(uTime * 12.0) + uSeed + 31.0) * step(0.8, g);
    col += vec3(0.6, 0.95, 1.0) * e * smoothstep(0.5, 0.75, g);

    // 8. Kecerahan bergetar tipis (dibatasi supaya aman untuk mata)
    col *= 1.0 + (hash(t + 3.0) - 0.5) * 0.12 * g;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

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

  // Layar foto ber-glitch, ditempel tepat di atas jendela foto kartu
  const screen = makePhotoScreen(makeTexture(drawPhotoLayer(photo), aniso));
  card.add(screen.mesh);

  // Kilat listrik di pinggir layar (tidak dibuat kalau animasi dimatikan pengguna)
  const edgeFx = reduceMotion ? null : createEdgeFx();

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
    // Dilempar kencang -> kartu "kesetrum"
    if (pointerVel.length() > 9) overload(performance.now() / 1000);
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

  /* ---------- Glitch & overload ----------
     - Glitch kecil muncul acak tiap 3-6.5 detik
     - Overload (merah + kilat di foto & pinggir layar) tiap 10-16 detik,
       atau langsung saat kartu dilempar kencang
     - Saat kursor di atas kartu / kartu dipegang, glitch naik sedikit */
  const t0 = performance.now() / 1000;
  const fx = { level: 0, peak: 0, until: 0, nextMicro: Infinity, nextOverload: Infinity, lastOverload: -99 };

  function overload(now) {
    if (reduceMotion || root.classList.contains('fx-off') || now - fx.lastOverload < 2.5) return;
    fx.lastOverload = now;
    // Nama di hero ikut glitch selama overload
    root.classList.add('is-overload');
    setTimeout(() => root.classList.remove('is-overload'), 750);
    fx.peak = 1;
    fx.until = now + 0.75;
    fx.nextOverload = now + 10 + Math.random() * 6;
    fx.nextMicro = Math.max(fx.nextMicro, now + 2.5);
    if (edgeFx) edgeFx.play();
  }

  function updateGlitch(now) {
    if (reduceMotion) return;
    screen.material.uniforms.uTime.value = (now - t0) % 1000;
    if (root.classList.contains('fx-off')) {
      // Efek dimatikan pengunjung: foto tenang, jadwal glitch tetap jalan diam-diam
      screen.material.uniforms.uGlitch.value = 0;
      fx.level = 0;
      return;
    }
    if (now >= fx.nextMicro) {
      if (now >= fx.until) {
        fx.peak = 0.4;
        fx.until = now + 0.15 + Math.random() * 0.15;
      }
      fx.nextMicro = now + 3 + Math.random() * 3.5;
    }
    if (now >= fx.nextOverload) overload(now);

    let target = (dragging || hero.classList.contains('is-hovering')) ? 0.2 : 0.05;
    if (now < fx.until) target = Math.max(target, fx.peak);
    // Naik cepat, turun pelan
    fx.level += (target - fx.level) * (target > fx.level ? 0.5 : 0.12);

    screen.material.uniforms.uGlitch.value = fx.level;
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
    updateGlitch(now / 1000);
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

    // Overload pertama pas kartu baru "mendarat", lalu glitch acak
    const now = performance.now() / 1000;
    fx.nextOverload = now + 1.6;
    fx.nextMicro = now + 4;
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

// Bidang tipis di atas jendela foto kartu, digambar oleh shader glitch
function makePhotoScreen(texture) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: texture },
      uTime: { value: 0 },
      uGlitch: { value: 0.05 },
      uSeed: { value: Math.floor(Math.random() * 100) }
    },
    vertexShader: GLITCH_VERTEX,
    fragmentShader: GLITCH_FRAGMENT
  });

  const w = (PHOTO.w / TEX_W) * CARD_W;
  const h = (PHOTO.h / TEX_H) * CARD_H;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(
    ((PHOTO.x + PHOTO.w / 2) / TEX_W - 0.5) * CARD_W,
    (0.5 - (PHOTO.y + PHOTO.h / 2) / TEX_H) * CARD_H,
    CARD_D / 2 + 0.002 // sedikit di depan permukaan kartu
  );
  return { mesh, material };
}

/* Efek pinggir layar saat overload: rona merah samar + kilat listrik
   yang merambat di tepi layar. Digambar di <canvas> 2D yang menutupi layar,
   hanya selama ±0.8 detik, lalu dibersihkan lagi. */
function createEdgeFx() {
  const DURATION = 0.8;
  const canvasFx = document.createElement('canvas');
  canvasFx.className = 'fx-edge';
  canvasFx.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvasFx);
  const ctx = canvasFx.getContext('2d');

  let w = 0;
  let h = 0;
  let dpr = 1;
  let active = false;
  let startTime = 0;
  let lastRegen = 0;
  let arcs = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvasFx.width = Math.round(w * dpr);
    canvasFx.height = Math.round(h * dpr);
  }

  // Satu kali naik lalu turun pelan: tidak berkedip-kedip (aman untuk mata)
  function envelope(t) {
    if (t < 0.12) return t / 0.12;
    if (t < 0.35) return 1;
    return Math.max(0, 1 - (t - 0.35) / (DURATION - 0.35));
  }

  // Garis zig-zag dengan metode "midpoint displacement"
  function jagged(x1, y1, x2, y2, spread, depth, out) {
    if (depth === 0) {
      out.push([x2, y2]);
      return;
    }
    const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * spread;
    const my = (y1 + y2) / 2 + (Math.random() - 0.5) * spread;
    jagged(x1, y1, mx, my, spread / 2, depth - 1, out);
    jagged(mx, my, x2, y2, spread / 2, depth - 1, out);
  }

  // Kilat yang menempel di salah satu tepi layar, melengkung sedikit ke dalam
  function makeArc() {
    const edge = Math.floor(Math.random() * 4); // 0 atas, 1 kanan, 2 bawah, 3 kiri
    const along = edge % 2 === 0 ? w : h;
    const len = 140 + Math.random() * 220;
    const s = Math.random() * Math.max(along - len, 1);
    const depth = 18 + Math.random() * 46;
    const toXY = (a, d) => {
      if (edge === 0) return [a, d];
      if (edge === 1) return [w - d, a];
      if (edge === 2) return [a, h - d];
      return [d, a];
    };
    const [ax, ay] = toXY(s, 2);
    const [mx, my] = toXY(s + len / 2, depth);
    const [bx, by] = toXY(s + len, 2);
    const pts = [[ax, ay]];
    jagged(ax, ay, mx, my, 34, 4, pts);
    jagged(mx, my, bx, by, 34, 4, pts);

    // Cabang kecil
    const from = pts[Math.floor(pts.length * (0.3 + Math.random() * 0.4))];
    const [tx, ty] = toXY(s + len * Math.random(), depth + 30 + Math.random() * 40);
    const branch = [[from[0], from[1]]];
    jagged(from[0], from[1], tx, ty, 26, 3, branch);
    return [pts, branch];
  }

  function strokePath(points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
  }

  function tick(now) {
    const t = (now - startTime) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (t > DURATION) {
      active = false;
      return;
    }
    requestAnimationFrame(tick);
    const k = envelope(t);

    // Rona merah di tepi layar
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
    vignette.addColorStop(0, 'rgba(255, 42, 109, 0)');
    vignette.addColorStop(1, `rgba(255, 42, 109, ${0.24 * k})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Kilat dibuat ulang tiap 60ms supaya terlihat "menyambar"
    if (now - lastRegen > 60) {
      arcs = [];
      const count = w < 600 ? 2 : 3;
      for (let i = 0; i < count; i++) arcs.push(...makeArc());
      lastRegen = now;
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.7 * k})`;
    ctx.lineWidth = 5;
    arcs.forEach(strokePath);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(235, 255, 255, ${0.95 * k})`;
    ctx.lineWidth = 1.3;
    arcs.forEach(strokePath);
  }

  window.addEventListener('resize', () => { if (active) resize(); });

  return {
    play() {
      if (active) return;
      resize();
      active = true;
      startTime = performance.now();
      lastRegen = 0;
      requestAnimationFrame(tick);
    }
  };
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
  ctx.fillText('PERSONNEL ID', 72, 160);
  ctx.textAlign = 'right';
  ctx.font = `500 24px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('NO. 001', W - 72, 158);
  ctx.textAlign = 'left';

  ctx.fillStyle = COLORS.magenta;
  ctx.fillRect(72, 180, W - 144, 3);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(W - 132, 178, 60, 7);

  // Jendela foto versi diam. Versi glitch digambar shader tepat di atasnya;
  // yang ini tetap ada sebagai cadangan kalau shader gagal jalan.
  drawPhotoWindow(ctx, photo, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);

  // Level: 6 hexagon = semester 6
  drawFrontBottom(ctx, W);
  return c;
}

// Foto + efek warna + scanline + label, di dalam bingkai bersudut miring
function drawPhotoWindow(ctx, photo, px, py, pw, ph) {
  ctx.save();
  chamfer(ctx, px, py, pw, ph, PHOTO.cut);
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
  ctx.fillStyle = 'rgba(0, 240, 255, 0.11)'; // tint tipis supaya warna kulit tetap natural
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
}

// Canvas terpisah yang isinya cuma jendela foto, untuk shader glitch.
// Area di luar bingkai miring dibiarkan transparan.
function drawPhotoLayer(photo) {
  const [c, ctx] = makeCanvas(PHOTO.w, PHOTO.h);
  drawPhotoWindow(ctx, photo, 0, 0, PHOTO.w, PHOTO.h);
  return c;
}

// Bagian bawah kartu depan: level, nama, tipe, kotak efek, barcode, stat
function drawFrontBottom(ctx, W) {
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
  drawBarcode(ctx, 72, 1432, 368, 84, 2026);
  ctx.font = `500 20px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('AR-2026-SI-06', 72, 1550);

  drawStat(ctx, 'LOGIC ', '2400', COLORS.cyan, W - 72, 1470);
  drawStat(ctx, 'BUILD ', '2100', COLORS.magenta, W - 72, 1520);
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

// Sisi belakang dibuat seperti kartu akses asli: formal, tenang, satu warna aksen
function drawBack() {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  const W = TEX_W;
  const H = TEX_H;
  const cx = W / 2;

  // Latar polos + bingkai tipis
  ctx.fillStyle = '#0b0b10';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(232, 241, 255, 0.16)';
  ctx.lineWidth = 2;
  chamfer(ctx, 40, 40, W - 80, H - 80, 52);
  ctx.stroke();

  // Lubang klip
  ctx.fillStyle = '#000';
  roundRect(ctx, W / 2 - 90, 72, 180, 30, 15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.stroke();

  // Strip magnetik selebar kartu
  const stripe = ctx.createLinearGradient(0, 150, 0, 262);
  stripe.addColorStop(0, '#040405');
  stripe.addColorStop(0.5, '#18181e');
  stripe.addColorStop(1, '#040405');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 150, W, 112);

  // Logo: simpul-simpul yang saling terhubung (gambaran alur data), tanpa huruf
  drawNodeMark(ctx, cx, 600, 170);

  // Judul kartu
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 64px ${DISPLAY_FONT}`;
  ctx.letterSpacing = '10px'; // diabaikan browser yang belum mendukung, tidak masalah
  ctx.fillText('ACCESS CARD', cx + 5, 890);
  ctx.letterSpacing = '0px';
  ctx.font = `500 24px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('AUTHORIZED PERSONNEL ONLY', cx, 938);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(232, 241, 255, 0.14)';
  ctx.lineWidth = 2;
  line(ctx, 110, 990, W - 110, 990);

  // Kolom tanda tangan
  ctx.font = `500 18px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('AUTHORIZED SIGNATURE', 110, 1036);
  ctx.save();
  ctx.beginPath();
  ctx.rect(110, 1052, W - 220, 92);
  ctx.clip();
  ctx.fillStyle = '#9ea4b0';
  ctx.fillRect(110, 1052, W - 220, 92);
  ctx.strokeStyle = 'rgba(11, 11, 16, 0.08)';
  ctx.lineWidth = 2;
  for (let x = 110 - 92; x < W - 110; x += 14) line(ctx, x, 1144, x + 92, 1052);
  ctx.restore();

  // Ketentuan kartu
  ctx.font = `500 21px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ['This card is non-transferable and must be',
   'presented on request. If found, please',
   'return it to the cardholder.'].forEach((text, i) => ctx.fillText(text, 110, 1200 + i * 32));

  // Barcode + nomor kartu (sama dengan sisi depan)
  drawBarcode(ctx, 110, 1330, 400, 90, 2026);
  ctx.font = `500 20px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('AR-2026-SI-06', 110, 1452);

  // Pemegang kartu
  ctx.textAlign = 'right';
  ctx.font = `500 18px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('CARDHOLDER', W - 110, 1360);
  ctx.font = `600 32px ${DISPLAY_FONT}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('AGHASHA RUDOLPH', W - 110, 1400);
  ctx.font = `500 20px ${MONO_FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('INFORMATION SYSTEMS', W - 110, 1434);
  ctx.textAlign = 'left';

  // Satu-satunya warna aksen
  ctx.fillStyle = COLORS.magenta;
  ctx.fillRect(110, H - 130, 64, 4);

  return c;
}

// Logo abstrak: lingkaran berisi jaringan simpul. Simpul tengah = sistemnya,
// tiga simpul luar = pengguna/proses yang terhubung ke sistem.
function drawNodeMark(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const nodes = [[0, -0.55], [-0.48, 0.3], [0.48, 0.3], [0, 0.02]].map(([x, y]) => [cx + x * r, cy + y * r]);
  ctx.lineWidth = 5;
  [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]].forEach(([a, b]) => {
    line(ctx, nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
  });
  nodes.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, i === 3 ? 16 : 22, 0, Math.PI * 2);
    ctx.fillStyle = i === 3 ? COLORS.magenta : COLORS.text;
    ctx.fill();
  });
  ctx.restore();
}

// Barcode dekoratif; seed tetap supaya polanya tidak berubah tiap dibuka
function drawBarcode(ctx, x, y, w, h, seed) {
  const rand = rng(seed);
  ctx.fillStyle = 'rgba(232, 241, 255, 0.85)';
  for (let bx = x; bx < x + w;) {
    const bw = 2 + Math.floor(rand() * 7);
    if (rand() > 0.3) ctx.fillRect(bx, y, bw, h);
    bx += bw + 2 + Math.floor(rand() * 4);
  }
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
  ctx.fillText('AUTHORIZED', -110, 4);
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
