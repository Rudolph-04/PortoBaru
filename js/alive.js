/* ==========================================================================
   alive.js — lapisan yang bikin halaman terasa "hidup"

   1. Background grid sinyal: node menyala di dekat kursor, paket data
      berjalan di sepanjang garis, klik memancarkan gelombang
   2. Pita teks berjalan: kecepatan & arahnya ikut scroll
   3. Judul section miring sedikit saat scroll kencang
   4. Log sistem di pojok: mencatat apa yang benar-benar dilakukan pengunjung
   5. Kursor HUD dengan label (desktop)
   6. Suara antarmuka yang disintesis (default mati, tombol SND)
   7. Judul tab berubah saat pengunjung pindah tab

   Semua animasi berbagi satu requestAnimationFrame. Browser otomatis
   menghentikannya saat tab tidak dilihat.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var hero = document.querySelector('.hero');

  function fxOn() { return !root.classList.contains('fx-off'); }
  function dialogOpen() { return root.classList.contains('dossier-open') || root.classList.contains('term-open'); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Posisi pointer bersama (dipakai grid & kursor)
  var pointer = { x: -9999, y: -9999, inside: false };
  window.addEventListener('pointermove', function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = e.pointerType !== 'touch';
  }, { passive: true });
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget) { pointer.inside = false; pointer.x = pointer.y = -9999; }
  });

  /* ==========================================================================
     1. GRID SINYAL
     ========================================================================== */
  var GAP = 48;          // sama dengan jarak grid lama, jadi tampilan dasarnya tidak berubah
  var REACH = 170;       // jangkauan cahaya di sekitar kursor (px)
  var canvas = document.createElement('canvas');
  canvas.className = 'field';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, cols = 0, rows = 0;
  var ripples = [];
  var packets = [];
  var nextPacket = 0;
  if (ctx) root.classList.add('has-field');

  function resizeField() {
    if (!ctx) return;
    // Garis & titik setipis ini tidak butuh resolusi retina: 1x cukup dan
    // jauh lebih ringan (di layar retina jumlah piksel jadi seperempatnya)
    var dpr = 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / GAP) + 1;
    rows = Math.ceil(H / GAP) + 2;
    if (reduce) drawField(performance.now());
  }

  function spawnPacket(now) {
    var horizontal = Math.random() < 0.55;
    packets.push({
      h: horizontal,
      dir: Math.random() < 0.5 ? 1 : -1,
      lane: Math.floor(Math.random() * (horizontal ? rows : cols)),
      speed: 0.22 + Math.random() * 0.26,          // px per ms
      len: 80 + Math.random() * 120,
      t0: now,
      hot: Math.random() < 0.25                      // sebagian berwarna magenta
    });
  }

  function drawField(now) {
    ctx.clearRect(0, 0, W, H);
    var offY = ((window.scrollY * 0.25) % GAP + GAP) % GAP; // grid bergerak lebih lambat dari konten
    var c, r, x, y;

    // Garis grid
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (c = 0; c < cols; c++) { x = c * GAP + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (r = 0; r < rows; r++) { y = r * GAP - offY + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Paket data
    if (!reduce) {
      if (now > nextPacket && packets.length < 7) {
        spawnPacket(now);
        nextPacket = now + 450 + Math.random() * 900;
      }
      packets = packets.filter(function (p) {
        var travel = (now - p.t0) * p.speed;
        var span = (p.h ? W : H) + p.len * 2;
        if (travel > span) return false;
        var head = p.dir > 0 ? travel - p.len : (p.h ? W : H) + p.len - travel;
        var tail = head - p.dir * p.len;
        var x1, y1, x2, y2;
        if (p.h) { y1 = y2 = p.lane * GAP - offY + 0.5; x1 = tail; x2 = head; }
        else { x1 = x2 = p.lane * GAP + 0.5; y1 = tail; y2 = head; }
        var g = ctx.createLinearGradient(x1, y1, x2, y2);
        var col = p.hot ? '255, 42, 109' : '0, 240, 255';
        g.addColorStop(0, 'rgba(' + col + ', 0)');
        g.addColorStop(1, 'rgba(' + col + ', 0.75)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });
    }

    // Gelombang klik yang sudah habis dibuang
    ripples = ripples.filter(function (rp) { return now - rp.t0 < 1300; });

    // Node di tiap persilangan
    ctx.fillStyle = '#00f0ff';
    var px = pointer.inside ? pointer.x : -9999;
    var py = pointer.inside ? pointer.y : -9999;
    for (c = 0; c < cols; c++) {
      x = c * GAP;
      for (r = 0; r < rows; r++) {
        y = r * GAP - offY;
        var a = 0.07;
        var dx = x - px, dy = y - py;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < REACH) { var k = 1 - d / REACH; a += k * k * 0.6; }
        for (var i = 0; i < ripples.length; i++) {
          var rp = ripples[i];
          var age = now - rp.t0;
          var rx = x - rp.x, ry = y - rp.y;
          var band = Math.sqrt(rx * rx + ry * ry) - age * 0.6;     // jari-jari gelombang 600 px/detik
          a += Math.exp(-(band * band) / 1500) * (1 - age / 1300) * 0.7;
        }
        if (a < 0.08) {
          ctx.globalAlpha = a;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        } else {
          var s = 2 + Math.min(a, 1) * 2.5;
          ctx.globalAlpha = Math.min(a, 1);
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  document.addEventListener('pointerdown', function (e) {
    if (reduce || !fxOn()) return;
    ripples.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
    if (ripples.length > 4) ripples.shift();
  }, { passive: true });

  /* ==========================================================================
     2. PITA TEKS BERJALAN
     ========================================================================== */
  var tickers = [];
  document.querySelectorAll('.ticker').forEach(function (el) {
    var track = el.querySelector('.ticker-track');
    if (!track) return;
    // Gandakan isi (salinan elemen, bukan HTML string) sampai cukup panjang
    // untuk berputar tanpa celah, lalu gandakan sekali lagi untuk putaran mulus
    var original = Array.prototype.slice.call(track.children);
    var guard = 0;
    while (track.scrollWidth < window.innerWidth * 2.2 && guard++ < 12) {
      original.forEach(function (node) { track.appendChild(node.cloneNode(true)); });
    }
    Array.prototype.slice.call(track.children).forEach(function (node) { track.appendChild(node.cloneNode(true)); });
    var t = { el: el, track: track, x: 0, dir: el.classList.contains('alt') ? 1 : -1, visible: false };
    tickers.push(t);
  });
  if ('IntersectionObserver' in window) {
    var tickerIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        tickers.forEach(function (t) { if (t.el === en.target) t.visible = en.isIntersecting; });
      });
    });
    tickers.forEach(function (t) { tickerIO.observe(t.el); });
  }

  /* ==========================================================================
     3. KECEPATAN SCROLL -> pita & judul section
     ========================================================================== */
  var lastScroll = window.scrollY;
  var velocity = 0;        // px per detik, dihaluskan
  var scrollSign = 1;
  var lastSkew = 0;

  /* ==========================================================================
     4. LOG SISTEM
     ========================================================================== */
  // Satu baris status di header (antara logo & menu), jadi tidak pernah menutupi konten
  var log = document.createElement('div');
  log.className = 'syslog';
  log.setAttribute('aria-hidden', 'true');
  var logo = document.querySelector('.header-inner .logo');
  if (logo) logo.insertAdjacentElement('afterend', log);
  else document.body.appendChild(log);
  var dimTimer = null;

  function stamp() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
  }

  function writeLog(msg, kind) {
    var p = document.createElement('p');
    if (kind) p.className = 'k-' + kind;
    var time = document.createElement('time');
    time.textContent = stamp();
    var text = document.createElement('span');
    p.appendChild(time);
    p.appendChild(text);
    log.textContent = '';          // hanya pesan terbaru yang tampil
    log.appendChild(p);
    // Teks diketik cepat, bukan langsung muncul
    if (reduce) text.textContent = msg;
    else {
      var i = 0;
      (function type() {
        i += 2;
        text.textContent = msg.slice(0, i);
        if (i < msg.length) setTimeout(type, 16);
      })();
    }
    clearTimeout(dimTimer);
    dimTimer = setTimeout(function () { p.classList.add('is-old'); }, 6000);
    sfx(kind === 'glitch' ? 'glitch' : kind === 'flip' ? 'flip' : kind === 'open' ? 'open' : null);
  }

  document.addEventListener('site:log', function (e) {
    if (e.detail && e.detail.msg) writeLog(e.detail.msg, e.detail.kind);
  });

  var started = false;   // log baru aktif setelah opening selesai

  // Section yang sedang dibaca
  var currentSection = null;
  if ('IntersectionObserver' in window) {
    var secIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id || 'home';
        if (id === currentSection) return;
        currentSection = id;
        if (started) writeLog('entering /' + id);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    if (hero) secIO.observe(hero);
    document.querySelectorAll('main section[id]').forEach(function (s) { secIO.observe(s); });
  }

  // Pesan pembuka: zona waktu pengunjung (data asli dari browser)
  function startLog() {
    if (started) return;
    started = true;
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    writeLog('link established' + (tz ? ' // ' + tz : ''));
    setTimeout(function () {
      var n = window.CaseFiles && window.CaseFiles.list ? window.CaseFiles.list.length : 0;
      if (n) writeLog('case files online: ' + n);
    }, 1400);
    if (fine.matches) setTimeout(function () { writeLog('hint: ctrl+k opens the terminal'); }, 3200);
  }
  if (root.classList.contains('intro-done')) setTimeout(startLog, 600);
  else document.addEventListener('intro:done', function () { setTimeout(startLog, 900); }, { once: true });

  // Diam lama -> sapa sekali
  var idleTimer = null;
  var idleSaid = false;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!document.hidden && started && !idleSaid) {
        idleSaid = true;
        writeLog('no input for 25s // still there?');
      }
    }, 25000);
  }
  ['pointermove', 'keydown', 'scroll', 'touchstart'].forEach(function (t) {
    window.addEventListener(t, resetIdle, { passive: true });
  });
  resetIdle();

  // Sampai paling bawah
  var endSaid = false;

  /* ==========================================================================
     7. JUDUL TAB
     ========================================================================== */
  var baseTitle = document.title;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      document.title = 'Signal lost // come back';
    } else {
      document.title = baseTitle;
      if (started) writeLog('signal restored');
    }
  });

  /* ==========================================================================
     5. KURSOR HUD
     ========================================================================== */
  var cursorOn = fine.matches && !reduce;
  var dot, ring, label;
  var ringPos = { x: -100, y: -100, w: 34, h: 34 };
  var lockTarget = null;

  if (cursorOn) {
    dot = document.createElement('div');
    dot.className = 'cur-dot';
    ring = document.createElement('div');
    ring.className = 'cur-ring';
    for (var ci = 0; ci < 4; ci++) ring.appendChild(document.createElement('i'));
    label = document.createElement('div');
    label.className = 'cur-label';
    [dot, ring, label].forEach(function (el) {
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    });

    document.addEventListener('pointerover', function (e) {
      lockTarget = e.target.closest ? e.target.closest('a, button, [role="tab"], .case-row, input, label') : null;
    });
    document.addEventListener('pointerdown', function () { ring.classList.add('is-down'); });
    document.addEventListener('pointerup', function () { ring.classList.remove('is-down'); });
  }

  function cursorLabelFor(t) {
    if (hero && hero.classList.contains('is-grabbing')) return 'HOLD';
    if (hero && hero.classList.contains('is-hovering') && !t) return 'DRAG / CLICK';
    if (!t) return '';
    if (t.classList.contains('case-row')) return 'OPEN FILE';
    if (t.tagName === 'A' && t.target === '_blank') return 'EXTERNAL';
    return '';
  }

  function updateCursor() {
    var show = cursorOn && pointer.inside && fxOn() && !dialogOpen();
    var overInput = lockTarget && /^(INPUT|LABEL)$/.test(lockTarget.tagName);
    root.classList.toggle('has-cursor', show && !overInput);
    if (!show || overInput) return;

    dot.style.transform = 'translate3d(' + pointer.x + 'px,' + pointer.y + 'px,0)';

    var tx = pointer.x, ty = pointer.y, tw = 34, th = 34, lock = false;
    if (lockTarget && document.contains(lockTarget)) {
      var r = lockTarget.getBoundingClientRect();
      // Target kecil (tombol, link menu) dikunci penuh; target lebar cukup diberi label
      if (r.width < 360 && r.height < 140) {
        tx = r.left + r.width / 2;
        ty = r.top + r.height / 2;
        tw = r.width + 12;
        th = r.height + 10;
        lock = true;
      }
    }
    var k = 0.22;
    ringPos.x += (tx - ringPos.x) * k;
    ringPos.y += (ty - ringPos.y) * k;
    ringPos.w += (tw - ringPos.w) * k;
    ringPos.h += (th - ringPos.h) * k;
    ring.style.transform = 'translate3d(' + (ringPos.x - ringPos.w / 2).toFixed(1) + 'px,' + (ringPos.y - ringPos.h / 2).toFixed(1) + 'px,0)';
    ring.style.width = ringPos.w.toFixed(1) + 'px';
    ring.style.height = ringPos.h.toFixed(1) + 'px';
    ring.classList.toggle('is-lock', lock);

    var text = cursorLabelFor(lockTarget);
    if (label.textContent !== text) label.textContent = text;
    label.classList.toggle('is-on', !!text);
    if (text) label.style.transform = 'translate3d(' + (pointer.x + 18) + 'px,' + (pointer.y + 16) + 'px,0)';
  }

  /* ==========================================================================
     6. SUARA (Web Audio, tanpa file)
     ========================================================================== */
  var sndBtn = document.getElementById('snd-toggle');
  var snd = { on: false, ctx: null, out: null, lastTick: 0 };
  try { snd.on = localStorage.getItem('snd') === 'on'; } catch (e) {}

  function audio() {
    if (!snd.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      snd.ctx = new AC();
      snd.out = snd.ctx.createGain();
      snd.out.gain.value = 0.6;
      snd.out.connect(snd.ctx.destination);
    }
    if (snd.ctx.state === 'suspended') snd.ctx.resume();
    return snd.ctx;
  }

  function tone(freq, dur, type, gain, freqEnd, delay) {
    var ac = audio();
    if (!ac) return;
    var t = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(snd.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, gain) {
    var ac = audio();
    if (!ac) return;
    var len = Math.floor(ac.sampleRate * dur);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource();
    src.buffer = buf;
    var bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    var g = ac.createGain();
    g.gain.value = gain;
    src.connect(bp);
    bp.connect(g);
    g.connect(snd.out);
    src.start();
  }

  function sfx(name) {
    if (!snd.on || !name) return;
    if (name === 'tick') tone(2400, 0.025, 'square', 0.012);
    else if (name === 'click') tone(700, 0.06, 'square', 0.025, 1400);
    else if (name === 'glitch') noise(0.16, 0.08);
    else if (name === 'flip') tone(240, 0.24, 'sawtooth', 0.025, 980);
    else if (name === 'open') { tone(440, 0.09, 'triangle', 0.05, 880); tone(880, 0.09, 'triangle', 0.04, 1320, 0.07); }
    else if (name === 'type') tone(3200, 0.012, 'square', 0.006);
  }

  function renderSnd() {
    if (!sndBtn) return;
    sndBtn.setAttribute('aria-pressed', String(snd.on));
    sndBtn.querySelector('span').textContent = snd.on ? 'on' : 'off';
  }

  if (sndBtn) {
    renderSnd();
    sndBtn.addEventListener('click', function () {
      snd.on = !snd.on;
      try { localStorage.setItem('snd', snd.on ? 'on' : 'off'); } catch (e) {}
      renderSnd();
      if (snd.on) sfx('open');
      if (started) writeLog('audio ' + (snd.on ? 'on' : 'off'));
    });
  }

  // Bunyi kecil saat menyorot / mengklik elemen interaktif
  var lastHover = null;
  document.addEventListener('pointerover', function (e) {
    if (!snd.on) return;
    var t = e.target.closest ? e.target.closest('a, button, [role="tab"], .case-row') : null;
    if (t && t !== lastHover && performance.now() - snd.lastTick > 60) {
      snd.lastTick = performance.now();
      sfx('tick');
    }
    lastHover = t;
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a, button, [role="tab"], .case-row') && e.target.id !== 'snd-toggle') sfx('click');
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'term-input' && e.key.length === 1) sfx('type');
  });

  /* ==========================================================================
     LOOP BERSAMA
     ========================================================================== */
  var last = performance.now();
  var fieldFrame = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(now - last, 64);
    last = now;

    // Kecepatan scroll (dihaluskan)
    var sy = window.scrollY;
    var inst = dt > 0 ? (sy - lastScroll) / dt * 1000 : 0;
    if (sy !== lastScroll) scrollSign = sy > lastScroll ? 1 : -1;
    lastScroll = sy;
    velocity += (inst - velocity) * 0.15;

    if (!reduce && fxOn()) {
      // Judul section miring sedikit sesuai kecepatan scroll
      var skew = clamp(velocity * 0.0022, -3, 3);
      if (Math.abs(skew - lastSkew) > 0.02) {
        lastSkew = skew;
        root.style.setProperty('--skew', skew.toFixed(2) + 'deg');
      }
      // Pita: kecepatan dasar + dorongan dari scroll, arah ikut arah scroll
      tickers.forEach(function (t) {
        if (!t.visible) return;
        var speed = (45 + Math.abs(velocity) * 0.35) * dt / 1000;
        t.x += speed * t.dir * scrollSign;
        var half = t.track.scrollWidth / 2;
        if (t.x <= -half) t.x += half;
        if (t.x > 0) t.x -= half;
        t.track.style.transform = 'translate3d(' + t.x.toFixed(1) + 'px,0,0)';
      });
    } else if (lastSkew !== 0) {
      lastSkew = 0;
      root.style.setProperty('--skew', '0deg');
    }

    // Layar sentuh (HP): grid cukup digambar 30x per detik
    fieldFrame++;
    if (ctx && !reduce && fxOn() && (fine.matches || fieldFrame % 2 === 0)) drawField(now);
    if (cursorOn) updateCursor();

    // Sampai paling bawah halaman
    if (!endSaid && started && sy + window.innerHeight >= document.documentElement.scrollHeight - 4) {
      endSaid = true;
      writeLog('end of file // thanks for reading');
    }
  }

  window.addEventListener('resize', resizeField);
  resizeField();
  requestAnimationFrame(frame);
})();
