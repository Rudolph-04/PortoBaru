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
const TWIST_STIFFNESS = 6;      // seberapa kuat tali yang terpuntir menarik kartu balik
const TWIST_DAMPING = 0.012;    // redaman putaran, supaya akhirnya berhenti
// Klik kartu = dibalik. Pegas khusus yang lebih kuat & teredam, supaya kartu
// berbalik ~0,45 detik, kelewatan sedikit (~12%), lalu diam menghadap belakang.
const FLIP_STIFFNESS = 70;                            // ω ≈ √70 ≈ 8,4 rad/s
const FLIP_DAMPING = (zeta) => (2 * zeta * Math.sqrt(FLIP_STIFFNESS)) * STEP;
const CLICK_MAX_MOVE = 6;       // px: lebih dari ini dianggap drag, bukan klik
const CLICK_MAX_TIME = 400;     // ms
const STRAP_W = 0.2;            // lebar tali
const STRAP_REPEAT = STRAP_W * 4; // panjang satu ulangan motif tali

const TEX_W = 1024;
const TEX_H = Math.round(TEX_W * CARD_H / CARD_W);

// Area yang diberi efek glitch = seluruh muka depan kartu (dalam piksel texture)
const PHOTO = { x: 0, y: 0, w: TEX_W, h: TEX_H };

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
   0 = tenang (foto bersih), 0.4 = glitch kecil, 1 = error berat (datamosh, noise, merah).
   uError = 1 selama frame rusak sesaat (diatur JS, maksimal 2x per error). */
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
  uniform float uError;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main() {
    // Bagian di luar bingkai miring dibuang supaya bentuk sudutnya tetap
    if (texture2D(uTex, vUv).a < 0.5) discard;

    float g = uGlitch;
    float t = floor(uTime * 24.0) + uSeed; // pola acak berganti 24x per detik
    vec2 uv = vUv;

    // 1. Irisan horizontal yang bergeser (sinyal gambar "robek")
    float band = floor(uv.y * 28.0);
    float on = step(1.0 - 0.5 * g, hash2(vec2(band * 1.7, t)));
    uv.x += (hash2(vec2(band, t)) - 0.5) * 0.12 * g * on;

    // 2. Datamosh: blok gambar yang "macet", pikselnya molor ke samping
    vec2 bsize = vec2(1.0 / 12.0, 1.0 / 10.0);
    vec2 bid = floor(vUv / bsize);
    float mosh = step(0.5, g) * step(1.0 - 0.2 * g, hash2(bid + floor(t * 0.5)));
    vec2 borg = bid * bsize;
    vec2 smear = vec2(borg.x + (uv.x - borg.x) * 0.08 + hash2(bid + 3.0) * 0.06, uv.y);
    uv = mix(uv, smear, mosh);

    // 3. Warna RGB pecah + bayangan ganda (ghosting)
    float split = 0.002 + 0.02 * g;
    vec3 col = vec3(
      texture2D(uTex, uv + vec2(split, 0.0)).r,
      texture2D(uTex, uv).g,
      texture2D(uTex, uv - vec2(split, 0.0)).b
    );
    vec3 ghost = texture2D(uTex, uv + vec2(0.04 * g, 0.0)).rgb;
    col = mix(col, max(col, ghost * 0.7), 0.4 * g);

    // 4. Bintik noise statis
    vec2 cell = floor(vUv * vec2(240.0, 200.0));
    float speck = step(0.3, g) * step(1.0 - 0.08 * g * g, hash2(cell + t));
    col = mix(col, vec3(step(0.5, hash2(cell * 1.3 + t))), speck * 0.85);

    // 5. Rona merah saat error berat (naik-turun halus, tidak berkedip)
    float red = smoothstep(0.55, 1.0, g);
    col = mix(col, col * vec3(1.3, 0.5, 0.6) + vec3(0.1, 0.0, 0.03), red * 0.8);

    // 6. Frame rusak sesaat: warna tertukar & sebagian terbalik
    if (uError > 0.5) {
      vec3 post = floor(col * 3.0) / 3.0;
      col = vec3(post.b, post.r, post.g);
      col = mix(col, 1.0 - col, step(0.55, hash2(vec2(floor(vUv.y * 14.0), t))));
    }

    // 7. Garis error tipis yang menyala sesaat
    float ly = hash(t + 7.0);
    float lineMask = (1.0 - smoothstep(0.0, 0.004, abs(vUv.y - ly))) * step(0.6, g);
    col = mix(col, vec3(1.0, 0.35, 0.45), lineMask * 0.9);

    // 8. Garis scan + kecerahan bergetar tipis (hanya saat glitch; saat tenang foto bersih)
    float s = fract(vUv.y - uTime * 0.35);
    col += smoothstep(0.0, 0.015, s) * (1.0 - smoothstep(0.015, 0.05, s)) * 0.04 * smoothstep(0.0, 0.2, g);
    col *= 1.0 + (hash(t + 3.0) - 0.5) * 0.1 * g;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
  }
`;

// Laporkan progres ke opening (js/main.js) lewat event "lanyard:status"
emitStatus('engine');
if (stage && canvas && hasWebGL()) {
  init().catch((err) => {
    console.warn('[lanyard] kartu 3D dimatikan:', err);
    emitStatus('assets');
    emitStatus('card');
  });
} else {
  // Tanpa WebGL: yang tampil kartu cadangan, opening tidak perlu menunggu
  emitStatus('assets');
  emitStatus('card');
}

/* ==========================================================================
   SETUP
   ========================================================================== */
async function init() {
  const [photo] = await Promise.all([loadImage('assets/img/card-photo.jpg'), loadFonts()]);
  emitStatus('assets');

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

  // Lapisan glitch di atas muka depan kartu (pakai gambar depan yang sama)
  const screen = makePhotoScreen(frontTex);
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

  // Total putaran kartu terhadap arah awal (radian). 2π = tali terpuntir 1 kali.
  let twistTotal = 0;
  let lastYaw = 0;
  // Arah diam kartu. 0 = depan menghadap layar; ±π = belakang menghadap layar.
  // Klik menggeser arah diam ini 180°, lalu pegas memutar kartu ke sana.
  let twistRest = 0;
  let flipping = false;
  let flipUntil = 0;

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
    cardFrame();
    // spin: putar kartu di sekitar sumbu tali (tali ikut terpuntir)
    P[BL].p.addScaledVector(n, -spin);
    P[BR].p.addScaledVector(n, spin);
    // flip: jungkir ke depan/belakang
    P[BL].p.z += flip;
    P[BR].p.z += flip;
  }

  // Arah hadap kartu di bidang horizontal (radian)
  function cardYaw() {
    return Math.atan2(-r.z, r.x);
  }

  function resetTwist() {
    cardFrame();
    lastYaw = cardYaw();
    twistTotal = 0;
    twistRest = 0;
    flipping = false;
  }

  // Balik kartu. dir = +1 / -1: arah putar (sisi kanan diklik -> sisi kanan
  // terdorong ke belakang). Pengait dianggap punya swivel, jadi tali tidak
  // ikut terpuntir saat kartu dibalik.
  function flipCard(dir) {
    if (!started) return;
    twistRest += Math.PI * dir;
    flipping = true;
    flipUntil = performance.now() + 2000;
    hideHint();
    updateRunning();
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

    // 3. Tali yang terpuntir. Setiap kartu berputar, puntirannya dijumlahkan
    //    (bisa beberapa putaran). Tali lalu menarik kartu memutar balik sejauh
    //    itu juga, sempat kelewatan sedikit, sampai kembali ke arah semula.
    cardFrame();
    const yaw = cardYaw();
    let dYaw = yaw - lastYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    lastYaw = yaw;
    twistTotal += dYaw;
    const err = twistTotal - twistRest;
    if (flipping && ((Math.abs(err) < 0.08 && Math.abs(dYaw) < 0.002) || performance.now() > flipUntil)) {
      flipping = false;
    }
    const alpha = flipping
      ? -FLIP_STIFFNESS * err * dt * dt - FLIP_DAMPING(reduceMotion ? 1 : 0.55) * dYaw
      : -TWIST_STIFFNESS * err * dt * dt - TWIST_DAMPING * dYaw;
    P[BL].p.addScaledVector(n, alpha * CARD_W / 2);
    P[BR].p.addScaledVector(n, -alpha * CARD_W / 2);

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
    resetTwist();
  }

  // Mulai dari atas layar, lalu jatuh dan berayun
  function placeForDrop() {
    const sway = desktopQuery.matches ? 0.16 : 0.07; // layar HP sempit, ayunannya dikecilkan
    for (let i = 0; i <= SEGMENTS; i++) {
      setPoint(i, anchor.x + sway * i, anchor.y + SEG_LEN * i * 0.92, 0);
    }
    placeCardBelowHole();
    resetTwist();
    // Sedikit putaran awal biar jatuhnya dramatis
    P[BL].q.z = P[BL].p.z - 0.012;
    P[BR].q.z = P[BR].p.z + 0.012;
  }

  /* ---------- Sinkronkan objek 3D dengan fisika ---------- */
  const strapPoints = [];
  for (let i = 0; i <= SEGMENTS + 1; i++) strapPoints.push(new THREE.Vector3());

  // Easter egg: pertama kali sisi belakang kartu menghadap layar
  let eggFound = false;
  function checkEasterEgg() {
    if (eggFound || !hint || n.z > -0.85) return;
    eggFound = true;
    interacted = true;
    hint.textContent = '[ ACCESS GRANTED ]';
    hint.classList.add('is-visible', 'is-egg');
    setTimeout(() => hint.classList.remove('is-visible'), 2600);
  }

  function updateScene() {
    cardFrame();
    checkEasterEgg();
    basis.makeBasis(r, u, n);
    card.position.copy(center);
    card.quaternion.setFromRotationMatrix(basis);

    clip.position.copy(P[H].p).addScaledVector(u, 0.03);
    clip.quaternion.copy(card.quaternion);

    // Tali: dari jauh di atas layar -> ruas-ruas tali -> ujung atas klip
    strapPoints[0].copy(anchor).add(tmp.set(0, 3, 0));
    for (let i = 0; i < SEGMENTS; i++) strapPoints[i + 1].copy(P[i].p);
    strapPoints[SEGMENTS + 1].copy(P[H].p).addScaledVector(u, 0.16);
    // Saat dibalik lewat klik, swivel di pengait yang berputar -> tali tetap rata
    strap.update(strapPoints, flipping ? 0 : twistTotal - twistRest);
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
    flipping = false; // dipegang -> pegas flip berhenti, kartu ikut tangan
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

  // Klik / tap: pointer hampir tidak bergerak dan cepat dilepas -> kartu dibalik
  let press = null;
  function pressStart(x, y) {
    press = { x, y, t: performance.now(), dir: grab.lx >= 0 ? 1 : -1 };
  }
  function pressEnd(x, y) {
    if (!press) return;
    const isClick = Math.hypot(x - press.x, y - press.y) < CLICK_MAX_MOVE &&
      performance.now() - press.t < CLICK_MAX_TIME;
    const dir = press.dir;
    press = null;
    if (isClick) flipCard(dir);
  }
  function pressMove(x, y) {
    if (press && Math.hypot(x - press.x, y - press.y) >= CLICK_MAX_MOVE) press = null;
  }

  // Mouse & pen pakai Pointer Events
  hero.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (startDrag(e.clientX, e.clientY)) {
      pressStart(e.clientX, e.clientY);
      hero.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  let hoverQueued = false;
  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (dragging) {
      pressMove(e.clientX, e.clientY);
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

  hero.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    endDrag();
    pressEnd(e.clientX, e.clientY);
  });
  hero.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') return;
    press = null;
    endDrag();
  });
  hero.addEventListener('pointerleave', () => hero.classList.remove('is-hovering'));

  // Sentuhan: halaman tetap bisa di-scroll, kecuali jari tepat menyentuh kartu
  hero.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (startDrag(t.clientX, t.clientY)) {
      pressStart(t.clientX, t.clientY);
      e.preventDefault();
    }
  }, { passive: false });

  hero.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    pressMove(t.clientX, t.clientY);
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });

  hero.addEventListener('touchend', (e) => {
    if (!dragging) return;
    endDrag();
    const t = e.changedTouches[0];
    if (t) pressEnd(t.clientX, t.clientY);
  });
  hero.addEventListener('touchcancel', () => {
    press = null;
    endDrag();
  });

  // Pindah antara layout desktop & HP -> posisi jangkar ikut pindah
  desktopQuery.addEventListener('change', resize);

  // Keyboard: Enter/Spasi = balik kartu, panah kiri/kanan = putar, atas/bawah = jungkir
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && started) {
      e.preventDefault();
      flipCard(1);
      return;
    }
    const keys = { ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] };
    const k = keys[e.key];
    if (!k || !started) return;
    e.preventDefault();
    twist(k[0], k[1]);
    hideHint();
    updateRunning();
  });

  function showHint() {
    if (!hint || interacted) return;
    hint.textContent = window.matchMedia('(pointer: coarse)').matches
      ? '[ Tap to flip · drag to swing ]'
      : '[ Click to flip · drag to swing ]';
    hint.classList.add('is-visible');
  }

  function hideHint() {
    interacted = true;
    if (hint) hint.classList.remove('is-visible');
  }

  /* ---------- Glitch & overload ----------
     - Glitch kecil muncul acak tiap 3-6.5 detik
     - Error berat (datamosh, noise, merah di foto + error di pinggir layar)
       tiap 10-16 detik,
       atau langsung saat kartu dilempar kencang
     - Saat kursor di atas kartu / kartu dipegang, glitch naik sedikit */
  const t0 = performance.now() / 1000;
  const fx = { level: 0, peak: 0, until: 0, nextMicro: Infinity, nextOverload: Infinity, lastOverload: -99, errorFrames: [] };

  function overload(now) {
    if (reduceMotion || root.classList.contains('fx-off') || now - fx.lastOverload < 2.5) return;
    fx.lastOverload = now;
    // Nama di hero ikut glitch selama overload
    root.classList.add('is-overload');
    setTimeout(() => root.classList.remove('is-overload'), 750);
    fx.peak = 1;
    fx.until = now + 0.75;
    // Dua frame rusak sesaat di dalam error ini (aman: jauh di bawah 3 kedipan/detik)
    fx.errorFrames = [now + 0.08 + Math.random() * 0.2, now + 0.42 + Math.random() * 0.22];
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
      screen.material.uniforms.uError.value = 0;
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

    // Tenang = 0 (foto bersih total); naik sedikit saat kartu disentuh
    let target = (dragging || hero.classList.contains('is-hovering')) ? 0.12 : 0;
    if (now < fx.until) target = Math.max(target, fx.peak);
    // Naik cepat, turun pelan
    fx.level += (target - fx.level) * (target > fx.level ? 0.5 : 0.12);

    screen.material.uniforms.uGlitch.value = fx.level;
    screen.material.uniforms.uError.value = fx.errorFrames.some((e) => now >= e && now < e + 0.06) ? 1 : 0;
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
  emitStatus('card');

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
    metalness: 0.2,
    roughness: 0.7
  });

  // Permukaan depan/belakang: doff seperti kartu PVC, tidak memantulkan lampu sorot
  const face = (tex) => new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: 0xffffff,
    emissiveIntensity: 0.62,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.25
  });

  // Urutan sisi BoxGeometry: kanan, kiri, atas, bawah, depan, belakang
  // Sisi belakang tidak terkena lampu sama sekali, supaya hitamnya benar-benar hitam polos
  const back = new THREE.MeshBasicMaterial({ map: backTex });

  return new THREE.Mesh(geometry, [edge, edge, edge, edge, face(frontTex), back]);
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

  function update(points, twist) {
    curve.points = points;
    for (let i = 0; i < SAMPLES; i++) curve.getPoint(i / (SAMPLES - 1), samples[i]);

    let length = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const prev = samples[Math.max(i - 1, 0)];
      const next = samples[Math.min(i + 1, SAMPLES - 1)];
      tangent.subVectors(next, prev).normalize();

      // Pita menghadap kamera, lalu diputar mengelilingi arah tali.
      // Makin ke bawah makin terpuntir; di ujung bawah puntirannya = total putaran kartu,
      // jadi kalau kartu diputar 2x, pitanya kelihatan melilit 2x.
      side.crossVectors(tangent, towardCamera);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const phi = -twist * (i / (SAMPLES - 1));
      facing.crossVectors(tangent, side);
      side.multiplyScalar(Math.cos(phi)).addScaledVector(facing, Math.sin(phi)).normalize();

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

// Bidang tipis di atas muka depan kartu, digambar oleh shader glitch
function makePhotoScreen(texture) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: texture },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uError: { value: 0 },
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

/* Efek pinggir layar saat error berat: rona merah samar, bilah gambar "robek",
   bintik noise, garis error tipis, dan kotak pesan error kecil di tepi layar.
   Digambar di <canvas> 2D yang menutupi layar selama ±0.9 detik, lalu dibersihkan. */
function createEdgeFx() {
  const DURATION = 0.9;
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
  let lastBars = 0;
  let lastPopups = 0;
  let bars = [];
  let noise = [];
  let lines = [];
  let popups = [];

  const HEX = '0123456789ABCDEF';
  const hex = (n) => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join('');
  const rand = (a, b) => a + Math.random() * (b - a);
  const MESSAGES = [
    () => `ERR 0x${hex(4)}`,
    () => `SIGNAL INTEGRITY ${Math.floor(Math.random() * 30)}%`,
    () => 'SYNC LOST',
    () => `MEMORY FAULT @ 0x${hex(6)}`,
    () => 'INPUT OVERFLOW',
    () => `RETRY ${1 + Math.floor(Math.random() * 3)}/3`
  ];
  const BAR_COLORS = ['255, 42, 109', '0, 240, 255', '245, 230, 99'];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvasFx.width = Math.round(w * dpr);
    canvasFx.height = Math.round(h * dpr);
  }

  // Satu kali naik lalu turun pelan: tidak berkedip-kedip (aman untuk mata)
  function envelope(t) {
    if (t < 0.1) return t / 0.1;
    if (t < 0.4) return 1;
    return Math.max(0, 1 - (t - 0.4) / (DURATION - 0.4));
  }

  // Bilah-bilah tipis yang menempel di tepi kiri/kanan (kadang atas/bawah)
  function makeBars() {
    const list = [];
    const count = w < 600 ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const bw = rand(60, w < 600 ? 160 : 260);
      const bh = rand(3, 24);
      const r = Math.random();
      let x;
      let y;
      if (r < 0.4) { x = 0; y = rand(0, h - bh); }
      else if (r < 0.8) { x = w - bw; y = rand(0, h - bh); }
      else if (r < 0.9) { x = rand(0, w - bw); y = rand(0, 40); }
      else { x = rand(0, w - bw); y = h - bh - rand(0, 40); }
      list.push({ x, y, w: bw, h: bh, color: BAR_COLORS[Math.floor(Math.random() * BAR_COLORS.length)] });
    }
    return list;
  }

  // Petak bintik noise statis di dekat tepi kiri/kanan
  function makeNoise() {
    return [0, 1].map(() => {
      const pw = rand(70, 150);
      const ph = rand(30, 80);
      return {
        x: Math.random() < 0.5 ? rand(0, 40) : w - pw - rand(0, 40),
        y: rand(h * 0.1, h * 0.9 - ph),
        w: pw,
        h: ph
      };
    });
  }

  // Kotak pesan error kecil
  function makePopups() {
    const count = w < 600 ? 1 : 2;
    return Array.from({ length: count }, (_, i) => {
      const left = i % 2 === 0;
      return {
        text: MESSAGES[Math.floor(Math.random() * MESSAGES.length)](),
        x: left ? rand(16, 60) : w - rand(16, 60),
        y: rand(h * 0.2, h * 0.85),
        alignRight: !left
      };
    });
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
    vignette.addColorStop(1, `rgba(255, 42, 109, ${0.2 * k})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Bilah, noise, dan garis diacak ulang tiap 90ms; pesan error tiap 280ms
    if (now - lastBars > 90) {
      bars = makeBars();
      noise = makeNoise();
      lines = Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => rand(0, h));
      lastBars = now;
    }
    if (now - lastPopups > 280) {
      popups = makePopups();
      lastPopups = now;
    }

    // Bilah gambar robek + pantulan putih tipis
    bars.forEach((bar) => {
      ctx.fillStyle = `rgba(${bar.color}, ${0.5 * k})`;
      ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.22 * k})`;
      ctx.fillRect(bar.x + 6, bar.y + 2, bar.w * 0.6, Math.max(1, bar.h * 0.25));
    });

    // Bintik noise
    noise.forEach((nz) => {
      for (let yy = 0; yy < nz.h; yy += 3) {
        for (let xx = 0; xx < nz.w; xx += 3) {
          if (Math.random() < 0.35) {
            ctx.fillStyle = Math.random() < 0.5 ? `rgba(232, 241, 255, ${0.5 * k})` : `rgba(255, 42, 109, ${0.5 * k})`;
            ctx.fillRect(nz.x + xx, nz.y + yy, 2, 2);
          }
        }
      }
    });

    // Garis error tipis selebar layar
    ctx.fillStyle = `rgba(232, 241, 255, ${0.3 * k})`;
    lines.forEach((ly) => ctx.fillRect(0, ly, w, 1));

    // Kotak pesan error
    ctx.font = '700 12px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';
    popups.forEach((pp) => {
      const bw = ctx.measureText(pp.text).width + 22;
      const bh = 24;
      const x = pp.alignRight ? pp.x - bw : pp.x;
      ctx.fillStyle = `rgba(6, 6, 11, ${0.85 * k})`;
      ctx.fillRect(x, pp.y, bw, bh);
      ctx.strokeStyle = `rgba(255, 42, 109, ${0.9 * k})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, pp.y + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = `rgba(255, 42, 109, ${k})`;
      ctx.fillRect(x, pp.y, 4, bh);
      ctx.fillStyle = `rgba(232, 241, 255, ${k})`;
      ctx.fillText(pp.text, x + 12, pp.y + bh / 2 + 1);
    });
  }

  window.addEventListener('resize', () => { if (active) resize(); });

  return {
    play() {
      if (active) return;
      resize();
      active = true;
      startTime = performance.now();
      lastBars = 0;
      lastPopups = 0;
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 4, 8);

  const rimCyan = new THREE.DirectionalLight(0x00f0ff, 1.1);
  rimCyan.position.set(-6, 1, 3);

  const rimMagenta = new THREE.DirectionalLight(0xff2a6d, 0.9);
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

// Sisi depan: foto penuh satu kartu + nama. Sengaja tanpa ornamen lain.
function drawFront(photo) {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  const W = TEX_W;
  const H = TEX_H;

  ctx.fillStyle = '#0b0b10';
  ctx.fillRect(0, 0, W, H);
  if (photo) {
    const scale = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  // Gradasi gelap di bagian bawah supaya nama tetap terbaca
  const fade = ctx.createLinearGradient(0, H * 0.55, 0, H);
  fade.addColorStop(0, 'rgba(5, 5, 6, 0)');
  fade.addColorStop(1, 'rgba(5, 5, 6, 0.92)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Lubang klip (bagian fisik kartu)
  ctx.fillStyle = '#000';
  roundRect(ctx, W / 2 - 90, 72, 180, 30, 15);
  ctx.fill();

  // Nama, dua baris di kiri bawah
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const size = Math.min(
    fitFont(ctx, 'AGHASHA', 700, DISPLAY_FONT, 150, W - 160),
    fitFont(ctx, 'RUDOLPH', 700, DISPLAY_FONT, 150, W - 160)
  );
  ctx.font = `700 ${size}px ${DISPLAY_FONT}`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('AGHASHA', 80, H - 90 - size * 0.92);
  ctx.fillText('RUDOLPH', 80, H - 90);
  ctx.restore();

  return c;
}

// Sisi belakang = easter egg: hitam polos, satu logo merah, satu baris teks kecil.
// Cuma kelihatan kalau pengunjung berhasil memutar kartunya.
function drawBack() {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  const W = TEX_W;
  const H = TEX_H;
  const cx = W / 2;

  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);

  // Lubang klip tetap ada (bagian fisik kartu)
  ctx.fillStyle = '#000';
  roundRect(ctx, W / 2 - 90, 72, 180, 30, 15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawNodeMark(ctx, cx, H / 2 - 60, 190, '#ff2a3d', '#ff2a3d');

  ctx.textAlign = 'center';
  ctx.font = `700 26px ${MONO_FONT}`;
  ctx.letterSpacing = '8px';
  ctx.fillStyle = 'rgba(255, 42, 61, 0.75)';
  ctx.fillText('ACCESS GRANTED', cx + 4, H / 2 + 230);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';

  return c;
}

// Logo abstrak: lingkaran berisi jaringan simpul. Simpul tengah = sistemnya,
// tiga simpul luar = pengguna/proses yang terhubung ke sistem.
function drawNodeMark(ctx, cx, cy, r, color = COLORS.text, accent = COLORS.magenta) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const nodes = [[0, -0.55], [-0.48, 0.3], [0.48, 0.3], [0, 0.02]].map(([x, y]) => [cx + x * r, cy + y * r]);
  ctx.lineWidth = r * 0.035;
  [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]].forEach(([a, b]) => {
    line(ctx, nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
  });
  nodes.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, r * (i === 3 ? 0.1 : 0.13), 0, Math.PI * 2);
    ctx.fillStyle = i === 3 ? accent : color;
    ctx.fill();
  });
  ctx.restore();
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
function emitStatus(step) {
  document.dispatchEvent(new CustomEvent('lanyard:status', { detail: { step } }));
}

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

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Kecilkan ukuran font sampai teks muat di lebar yang tersedia
function fitFont(ctx, text, weight, family, maxSize, maxWidth) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > 20) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
