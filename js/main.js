/* ==========================================================================
   main.js — interaksi halaman
   1. Opening: loading sungguhan (font, mesin 3D, foto, kartu ID),
      nama ter-"decode", lalu transisi bilah yang membuka halaman
   2. Tahun otomatis di footer
   3. Menu hamburger (mobile) + tombol FX on/off
   4. Link navigasi aktif mengikuti section yang sedang dilihat
   5. Animasi muncul saat di-scroll (reveal) + judul ter-"decode"

   Kartu ID 3D ada di file terpisah: js/lanyard.js
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#01';

  /* EFEK DECODE ----------------------------------------------------------
     Huruf acak berganti-ganti sebelum jadi teks asli. Dihitung pakai waktu
     (bukan jumlah frame), jadi tetap selesai tepat waktu walaupun HP lambat.
     opts.maxStart / opts.minDur / opts.rangeDur mengatur lamanya (ms). */
  function scramble(el, opts, onDone) {
    opts = opts || {};
    var finish = onDone || function () {};
    if (!el || reduceMotion || root.classList.contains('fx-off') || el.dataset.scrambled) {
      finish();
      return;
    }
    el.dataset.scrambled = '1';
    var finalText = el.textContent;
    var maxStart = opts.maxStart || 250;
    var minDur = opts.minDur || 200;
    var rangeDur = opts.rangeDur || 350;
    var queue = [];
    for (var i = 0; i < finalText.length; i++) {
      var start = Math.random() * maxStart;
      queue.push({ to: finalText[i], start: start, end: start + minDur + Math.random() * rangeDur });
    }
    el.setAttribute('aria-label', finalText); // pembaca layar tetap baca teks asli
    var t0 = performance.now();
    var lastSwap = 0;

    (function update(now) {
      var elapsed = (now || performance.now()) - t0;
      // Ganti huruf acak tiap ~50ms supaya tidak terlalu berkedip
      var swap = elapsed - lastSwap > 50;
      if (swap) lastSwap = elapsed;

      var frag = document.createDocumentFragment();
      var done = 0;
      for (var j = 0; j < queue.length; j++) {
        var q = queue[j];
        if (q.to === ' ' || elapsed >= q.end) {
          frag.appendChild(document.createTextNode(q.to));
          done++;
          continue;
        }
        if (swap || !q.ch) q.ch = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        var dud = document.createElement('span');
        dud.className = 'dud';
        dud.textContent = elapsed >= q.start ? q.ch : q.to;
        if (elapsed < q.start) dud.style.opacity = '0';
        frag.appendChild(dud);
      }
      el.textContent = '';
      el.appendChild(frag);

      if (done < queue.length) {
        requestAnimationFrame(update);
      } else {
        el.textContent = finalText;
        el.removeAttribute('aria-label');
        finish();
      }
    })();
  }

  /* 1. OPENING ----------------------------------------------------------- */
  var intro = document.getElementById('intro');

  // Bagian halaman yang "dibekukan" (tidak bisa di-klik/Tab) selama opening tampil
  var behind = [document.querySelector('.site-header'), document.getElementById('main'), document.querySelector('.site-footer')];

  if (intro && root.classList.contains('intro-active')) {
    runIntro();
  } else if (intro) {
    intro.hidden = true;
  }

  function runIntro() {
    var fill = document.getElementById('intro-bar-fill');
    var pctEl = document.getElementById('intro-pct');
    var stepEl = document.getElementById('intro-step');
    var enterBtn = document.getElementById('intro-enter');
    var skipBtn = document.getElementById('intro-skip');
    var clockEl = document.getElementById('intro-clock');
    var nameLines = intro.querySelectorAll('.intro-line');

    // Tahap loading yang benar-benar terjadi. "engine", "assets", dan "card"
    // dilaporkan oleh js/lanyard.js lewat event "lanyard:status".
    var STEPS = [
      { id: 'fonts', label: 'Loading fonts' },
      { id: 'engine', label: 'Loading 3D engine' },
      { id: 'assets', label: 'Loading photo' },
      { id: 'card', label: 'Building ID card' }
    ];
    var MIN_TIME = 1600;  // opening tampil minimal segini supaya animasinya sempat terlihat
    var MAX_WAIT = 5000;  // jaringan lambat / 3D gagal: lanjut saja setelah ini

    var doneSteps = {};
    var target = 0;
    var shown = 0;
    var decoded = false;
    var ready = false;
    var leaving = false;
    var enterQueued = false;
    var t0 = performance.now();

    behind.forEach(function (el) { if (el) el.inert = true; });
    skipBtn.focus({ preventScroll: true });

    // Jam lokal pengunjung di pojok layar
    function tickClock() {
      var d = new Date();
      clockEl.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map(function (n) { return String(n).padStart(2, '0'); }).join(':');
    }
    tickClock();
    var clockTimer = setInterval(tickClock, 1000);

    function completeStep(id) {
      if (doneSteps[id]) return;
      doneSteps[id] = true;
      var count = STEPS.filter(function (s) { return doneSteps[s.id]; }).length;
      target = count / STEPS.length;
      var next = STEPS.filter(function (s) { return !doneSteps[s.id]; })[0];
      stepEl.textContent = next ? next.label : 'System ready';
    }

    function completeAll() {
      STEPS.forEach(function (s) { completeStep(s.id); });
    }

    stepEl.textContent = STEPS[0].label;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { completeStep('fonts'); });
    } else {
      completeStep('fonts');
    }
    document.addEventListener('lanyard:status', function (e) {
      if (e.detail && e.detail.step) completeStep(e.detail.step);
    });
    var maxTimer = setTimeout(completeAll, MAX_WAIT);

    // Nama di-decode pelan-pelan
    var pending = nameLines.length;
    setTimeout(function () {
      nameLines.forEach(function (line) {
        scramble(line, { maxStart: 450, minDur: 450, rangeDur: 600 }, function () {
          pending--;
          if (pending <= 0) decoded = true;
        });
      });
    }, 250);

    // Bar progres bergerak halus menuju progres yang sebenarnya
    (function animate() {
      if (leaving) return;
      shown += (target - shown) * 0.12;
      if (target - shown < 0.002) shown = target;
      fill.style.transform = 'scaleX(' + shown.toFixed(4) + ')';
      pctEl.textContent = String(Math.round(shown * 100)).padStart(3, '0') + '%';
      if (!ready && shown >= 1 && decoded && performance.now() - t0 >= MIN_TIME) setReady();
      requestAnimationFrame(animate);
    })();

    function setReady() {
      ready = true;
      clearTimeout(maxTimer);
      intro.classList.add('is-ready');
      if (enterQueued) {
        leave();
        return;
      }
      enterBtn.focus({ preventScroll: true });
    }

    function leave() {
      if (leaving) return;
      leaving = true;
      clearTimeout(maxTimer);
      clearInterval(clockTimer);
      document.removeEventListener('keydown', onKey);
      intro.classList.add('is-leaving');

      // Kartu mulai jatuh saat bilah-bilah layar mulai terbuka
      setTimeout(function () {
        root.classList.add('intro-released');
        document.dispatchEvent(new CustomEvent('intro:done'));
      }, 250);

      setTimeout(function () {
        intro.hidden = true;
        root.classList.remove('intro-active');
        root.classList.add('intro-done');
        behind.forEach(function (el) { if (el) el.inert = false; });
        document.getElementById('main').focus({ preventScroll: true });
      }, 1100);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        leave();
      } else if ((e.key === 'Enter' || e.key === ' ') && e.target !== enterBtn && e.target !== skipBtn) {
        e.preventDefault();
        // Belum siap? Masuk otomatis begitu loading selesai
        if (ready) leave(); else enterQueued = true;
      }
    }

    enterBtn.addEventListener('click', leave);
    skipBtn.addEventListener('click', leave);
    document.addEventListener('keydown', onKey);
  }

  /* 2. TAHUN DI FOOTER --------------------------------------------------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* 3. MENU HAMBURGER ---------------------------------------------------- */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');

  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', open);
  }

  toggle.addEventListener('click', function () {
    setMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (nav.classList.contains('is-open') && !nav.contains(e.target) && !toggle.contains(e.target)) {
      setMenu(false);
    }
  });

  /* 3b. TOMBOL FX ON/OFF ------------------------------------------------
     Mematikan glitch, scanline, dan efek error kartu. Pilihan disimpan
     di browser pengunjung, jadi tetap mati saat halaman dibuka lagi. */
  var fxBtn = document.getElementById('fx-toggle');

  function renderFx() {
    var off = root.classList.contains('fx-off');
    fxBtn.setAttribute('aria-pressed', String(!off));
    fxBtn.querySelector('span').textContent = off ? 'off' : 'on';
  }

  if (fxBtn) {
    renderFx();
    fxBtn.addEventListener('click', function () {
      var off = !root.classList.contains('fx-off');
      root.classList.toggle('fx-off', off);
      try { localStorage.setItem('fx', off ? 'off' : 'on'); } catch (e) {}
      renderFx();
    });
  }

  // Browser lama tanpa IntersectionObserver: tampilkan semua konten apa adanya
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  /* 4. LINK NAVIGASI AKTIF ---------------------------------------------- */
  var navLinks = nav.querySelectorAll('a[href^="#"]');
  var linkById = {};

  navLinks.forEach(function (link) {
    linkById[link.getAttribute('href').slice(1)] = link;
  });

  var sectionObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      navLinks.forEach(function (l) { l.classList.remove('is-active'); });
      var active = linkById[entry.target.id];
      if (active) active.classList.add('is-active');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  document.querySelectorAll('main section[id]').forEach(function (s) {
    sectionObserver.observe(s);
  });

  /* 5. REVEAL SAAT DI-SCROLL -------------------------------------------- */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        if (entry.target.classList.contains('section-head')) scramble(entry.target.querySelector('h2'));
        revealObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('.reveal').forEach(function (el) {
    revealObserver.observe(el);
  });
})();
