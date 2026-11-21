/* ==========================================================================
   main.js — interaksi halaman
   1. Opening: loading sungguhan (font, mesin 3D, foto, kartu ID),
      nama ter-"decode", lalu transisi bilah yang membuka halaman
   2. Tahun otomatis di footer
   3. Menu hamburger (mobile) + tombol FX on/off
   4. Link navigasi aktif mengikuti section yang sedang dilihat
   5. Animasi muncul saat di-scroll (reveal) + judul ter-"decode"
   6. Progres scroll: garis header, rail HUD, timeline Process
   7. Micro interaction: kartu miring mengikuti kursor, skeleton foto

   Kartu ID 3D ada di file terpisah: js/lanyard.js
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Simbol + katakana setengah lebar, biar decode-nya terasa "sistem asing"
  var SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ';

  /* EFEK DECODE ----------------------------------------------------------
     Huruf acak berganti-ganti sebelum jadi teks asli. Dihitung pakai waktu
     (bukan jumlah frame), jadi tetap selesai tepat waktu walaupun HP lambat.
     opts.maxStart / opts.minDur / opts.rangeDur mengatur lamanya (ms).
     opts.repeat = boleh diputar lagi (dipakai untuk efek hover). */
  function scramble(el, opts, onDone) {
    opts = opts || {};
    var finish = onDone || function () {};
    if (!el || reduceMotion || root.classList.contains('fx-off') ||
        el.dataset.busy || (!opts.repeat && el.dataset.scrambled)) {
      finish();
      return;
    }
    el.dataset.scrambled = '1';
    el.dataset.busy = '1';
    var finalText = el.dataset.text || (el.dataset.text = el.textContent);
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
        delete el.dataset.busy;
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
      // Opening cukup sekali per sesi; reload berikutnya langsung ke halaman
      try { sessionStorage.setItem('booted', '1'); } catch (e) {}
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
      document.dispatchEvent(new CustomEvent('site:log', { detail: { msg: 'visual fx ' + (off ? 'off' : 'on') } }));
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

  /* 5. REVEAL SAAT DI-SCROLL --------------------------------------------
     Tiap kata dibungkus "masker" kecil. Kata-kata di baris yang sama naik
     bersamaan, baris berikutnya menyusul (urutan baris dihitung dari posisi
     kata di layar, jadi tetap benar di layar sempit maupun lebar). */
  function splitWords(el) {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }
        var mask = document.createElement('span');
        mask.className = 'wm';
        var word = document.createElement('span');
        word.className = 'wi';
        word.textContent = part;
        mask.appendChild(word);
        frag.appendChild(mask);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  function lineReveal(el) {
    if (!el || reduceMotion || root.classList.contains('fx-off')) return;
    splitWords(el);
    var lastTop = null;
    var line = -1;
    el.querySelectorAll('.wm').forEach(function (w) {
      var top = Math.round(w.getBoundingClientRect().top);
      if (lastTop === null || Math.abs(top - lastTop) > 4) {
        line++;
        lastTop = top;
      }
      w.style.setProperty('--line', line);
    });
    el.classList.add('lr-hide');
    void el.offsetWidth; // gambar dulu keadaan tersembunyi, baru animasikan
    requestAnimationFrame(function () { el.classList.remove('lr-hide'); });
  }

  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        if (entry.target.classList.contains('section-head')) scramble(entry.target.querySelector('h2'));
        entry.target.querySelectorAll('.section-intro, .about-lead').forEach(lineReveal);
        revealObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('.reveal').forEach(function (el) {
    revealObserver.observe(el);
  });

  /* 6. PROGRES SCROLL ----------------------------------------------------
     Satu fungsi yang dipanggil maksimal sekali per frame saat scroll:
     - --scroll di <html>: garis header & rail (0..1 seluruh halaman)
     - rail HUD: muncul setelah lewat hero, section aktif ditandai
     - timeline Process: garis terisi sesuai posisi section di layar */
  var rail = document.getElementById('hud-rail');
  var railPct = document.getElementById('rail-pct');
  var railLinks = rail ? rail.querySelectorAll('a[data-rail]') : [];
  var hero = document.querySelector('.hero');
  var timeline = document.getElementById('timeline');
  var steps = timeline ? timeline.querySelectorAll('.step') : [];
  var sections = Array.prototype.slice.call(document.querySelectorAll('main section[id]'));
  var ticking = false;

  // Angka section besar (outline) di belakang tiap judul: lapisan paling belakang
  var ghosts = [];
  document.querySelectorAll('.section-head').forEach(function (head) {
    var num = head.querySelector('.section-num');
    var digits = num && num.textContent.replace(/\D/g, '');
    if (!digits) return;
    var ghost = document.createElement('span');
    ghost.className = 'ghost-num';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = digits;
    head.appendChild(ghost);
    ghosts.push({ head: head, el: ghost });
  });

  if (timeline && !reduceMotion) timeline.classList.add('is-live');

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function onScroll() {
    ticking = false;
    var vh = window.innerHeight;
    var max = document.documentElement.scrollHeight - vh;
    var p = max > 0 ? clamp01(window.scrollY / max) : 0;
    root.style.setProperty('--scroll', p.toFixed(4));

    if (rail) {
      rail.classList.toggle('is-on', !!hero && hero.getBoundingClientRect().bottom < vh * 0.5);
      railPct.textContent = String(Math.round(p * 100)).padStart(3, '0');
      var current = null;
      sections.forEach(function (s) {
        if (s.getBoundingClientRect().top < vh * 0.5) current = s.id;
      });
      railLinks.forEach(function (a) { a.classList.toggle('is-active', a.dataset.rail === current); });
    }

    // Angka besar bergerak lebih lambat dari teks -> kesan berlapis
    if (!reduceMotion) {
      ghosts.forEach(function (g) {
        var hr = g.head.getBoundingClientRect();
        if (hr.bottom < -200 || hr.top > vh + 200) return;
        var off = (hr.top + hr.height / 2 - vh / 2) * 0.22;
        g.el.style.transform = 'translate3d(0,' + off.toFixed(1) + 'px,0)';
      });
    }

    if (timeline) {
      // 0 saat bagian atas timeline di 80% tinggi layar, 1 saat bagian bawahnya di 55%
      var r = timeline.getBoundingClientRect();
      var tp = reduceMotion ? 1 : clamp01((vh * 0.8 - r.top) / (r.height + vh * 0.25));
      timeline.style.setProperty('--progress', tp.toFixed(4));
      var vertical = window.matchMedia('(max-width: 960px)').matches;
      steps.forEach(function (step, i) {
        // Titik langkah ke-i ada di i/n sepanjang garis (horizontal) atau di posisi atasnya (vertikal)
        var at = vertical ? (step.offsetTop / r.height) : (i / steps.length);
        step.classList.toggle('is-on', tp > at + 0.02 || tp >= 1);
      });
    }
  }

  function requestTick() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick);
  onScroll();

  /* 7. MICRO INTERACTION -------------------------------------------------
     a. Foto About: skeleton shimmer sampai foto selesai dimuat
     b. Panel pratinjau project & foto About miring sedikit mengikuti kursor
        (hanya mouse, bukan layar sentuh; mati kalau FX off / reduced motion) */
  var aboutPhoto = document.querySelector('.about-photo');
  var aboutImg = aboutPhoto && aboutPhoto.querySelector('img');
  if (aboutImg) {
    var markLoaded = function () { aboutPhoto.classList.add('is-loaded'); };
    if (aboutImg.complete && aboutImg.naturalWidth) markLoaded();
    else {
      aboutImg.addEventListener('load', markLoaded);
      aboutImg.addEventListener('error', markLoaded); // gagal dimuat: jangan shimmer selamanya
    }
  }

  var MAX_TILT = 5; // derajat
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  function bindTilt(el, surface) {
    if (!el) return;
    surface = surface || el;
    surface.addEventListener('pointermove', function (e) {
      if (!finePointer.matches || reduceMotion || root.classList.contains('fx-off')) return;
      var r = surface.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;   // 0..1
      var py = (e.clientY - r.top) / r.height;   // 0..1
      var dx = px - 0.5;
      var dy = py - 0.5;
      // Sumbu putar tegak lurus arah kursor dari tengah; besar sudut = jarak dari tengah
      var len = Math.hypot(dx, dy) || 1e-6;
      el.style.setProperty('--tx', (-dy / len).toFixed(3));
      el.style.setProperty('--ty', (dx / len).toFixed(3));
      el.style.setProperty('--ta', (Math.min(len * 2, 1) * MAX_TILT).toFixed(2) + 'deg');
      el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      el.classList.add('is-tilting');
    });
    surface.addEventListener('pointerleave', function () {
      el.classList.remove('is-tilting');
    });
  }

  bindTilt(document.querySelector('.case-preview'));
  bindTilt(aboutImg, aboutPhoto);

  /* c. Label menu & rail ter-decode ulang tiap disorot */
  document.querySelectorAll('.site-nav a > span, .rail-list a > b').forEach(function (label) {
    var link = label.parentElement;
    ['pointerenter', 'focus'].forEach(function (type) {
      link.addEventListener(type, function () {
        scramble(label, { repeat: true, maxStart: 80, minDur: 120, rangeDur: 180 });
      });
    });
  });

  /* d. Spotlight: garis tepi menyala mengikuti kursor (kotak angka & kontak).
        Satu listener untuk semua, termasuk yang dibuat belakangan di dossier. */
  var spotQueued = false;
  var spotEvent = null;
  document.addEventListener('pointermove', function (e) {
    if (!finePointer.matches || root.classList.contains('fx-off')) return;
    spotEvent = e;
    if (spotQueued) return;
    spotQueued = true;
    requestAnimationFrame(function () {
      spotQueued = false;
      var group = spotEvent.target.closest && spotEvent.target.closest('.case-facts, .contact-list');
      if (!group) return;
      group.querySelectorAll('.case-facts > div, .contact-list a').forEach(function (item) {
        var r = item.getBoundingClientRect();
        item.style.setProperty('--mx', (spotEvent.clientX - r.left).toFixed(0) + 'px');
        item.style.setProperty('--my', (spotEvent.clientY - r.top).toFixed(0) + 'px');
      });
    });
  }, { passive: true });

  /* 8. EASTER EGG DI CONSOLE ------------------------------------------- */
  try {
    console.log(
      '%c ACCESS GRANTED %c\nYou opened the console, so you are probably a developer.\n' +
      'Press Ctrl+K (or the > _ button in the menu) to open the terminal. Try: help',
      'background:#00f0ff;color:#001417;font:700 13px monospace;padding:4px 8px',
      'color:#9aa3bf;font:12px monospace'
    );
  } catch (e) {}
})();
