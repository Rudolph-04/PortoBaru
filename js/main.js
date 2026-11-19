/* ==========================================================================
   main.js — interaksi halaman
   1. Opening (boot screen + tombol Enter)
   2. Tahun otomatis di footer
   3. Menu hamburger (mobile)
   4. Link navigasi aktif mengikuti section yang sedang dilihat
   5. Animasi muncul saat di-scroll (reveal)

   Kartu ID 3D ada di file terpisah: js/lanyard.js
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;

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
    var log = document.getElementById('intro-log');
    var fill = document.getElementById('intro-bar-fill');
    var pct = document.getElementById('intro-pct');
    var enterBtn = document.getElementById('intro-enter');
    var skipBtn = document.getElementById('intro-skip');

    // [teks, status, kelas warna status]
    var lines = [
      ['> BOOT A.R_SYSTEMS', '', ''],
      ['> LOADING PROFILE ............. ', 'OK', 'ok'],
      ['> MOUNTING PROJECTS [4] ....... ', 'OK', 'ok'],
      ['> CALIBRATING LANYARD PHYSICS . ', 'OK', 'ok'],
      ['> CLEARANCE LEVEL ............. ', 'STUDENT', 'warn'],
      ['> IDENTITY CONFIRMED', '', '']
    ];

    var timers = [];
    var ready = false;
    var leaving = false;
    var caret = document.createElement('span');
    caret.className = 'caret';

    behind.forEach(function (el) { if (el) el.inert = true; });
    skipBtn.focus({ preventScroll: true });

    function later(fn, ms) {
      timers.push(setTimeout(fn, ms));
    }

    function setProgress(value) {
      fill.style.width = value + '%';
      pct.textContent = value + '%';
    }

    // Ketik satu baris huruf per huruf, lalu tampilkan statusnya
    function typeLine(index) {
      if (index >= lines.length) {
        later(identify, 250);
        return;
      }

      var text = lines[index][0];
      var status = lines[index][1];
      var statusClass = lines[index][2];
      var lineEl = document.createElement('span');
      log.appendChild(lineEl);
      log.appendChild(caret);

      var pos = 0;
      (function typeChar() {
        pos += 2; // 2 huruf per tick supaya tidak kelamaan
        lineEl.textContent = text.slice(0, pos);
        if (pos < text.length) {
          later(typeChar, 14);
          return;
        }
        if (status) {
          var s = document.createElement('span');
          s.className = statusClass;
          s.textContent = status;
          lineEl.appendChild(s);
        }
        log.insertBefore(document.createTextNode('\n'), caret);
        setProgress(Math.round(((index + 1) / lines.length) * 100));
        later(function () { typeLine(index + 1); }, status ? 120 : 200);
      })();
    }

    function identify() {
      intro.classList.add('is-identified');
      later(setReady, 500);
    }

    function setReady() {
      if (ready) return;
      ready = true;
      setProgress(100);
      intro.classList.add('is-ready');
      enterBtn.focus({ preventScroll: true });
    }

    // Lompat langsung ke akhir animasi (kalau user tekan Enter sebelum selesai)
    function fastForward() {
      timers.forEach(clearTimeout);
      timers = [];
      log.textContent = '';
      lines.forEach(function (l) {
        var lineEl = document.createElement('span');
        lineEl.textContent = l[0];
        if (l[1]) {
          var s = document.createElement('span');
          s.className = l[2];
          s.textContent = l[1];
          lineEl.appendChild(s);
        }
        log.appendChild(lineEl);
        log.appendChild(document.createTextNode('\n'));
      });
      log.appendChild(caret);
      intro.classList.add('is-identified');
      setReady();
    }

    function leave() {
      if (leaving) return;
      leaving = true;
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey);
      intro.classList.add('is-leaving');

      // Kartu mulai jatuh sedikit sebelum layar opening benar-benar hilang
      setTimeout(function () {
        root.classList.add('intro-released');
        document.dispatchEvent(new CustomEvent('intro:done'));
      }, 250);

      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        intro.hidden = true;
        root.classList.remove('intro-active');
        root.classList.add('intro-done');
        behind.forEach(function (el) { if (el) el.inert = false; });
        document.getElementById('main').focus({ preventScroll: true });
      }
      intro.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 900); // jaga-jaga kalau animationend tidak terpanggil
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        leave();
      } else if ((e.key === 'Enter' || e.key === ' ') && e.target !== enterBtn && e.target !== skipBtn) {
        e.preventDefault();
        if (ready) leave(); else fastForward();
      }
    }

    enterBtn.addEventListener('click', leave);
    skipBtn.addEventListener('click', leave);
    document.addEventListener('keydown', onKey);

    later(function () { typeLine(0); }, 300);
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
     Mematikan glitch, scanline, dan efek overload kartu. Pilihan disimpan
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
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#01';

  // Efek "decode": huruf acak berganti-ganti sebelum jadi teks asli.
  // Dihitung pakai waktu (bukan jumlah frame), jadi selalu selesai < 1 detik
  // walaupun HP-nya lambat.
  function scramble(el) {
    if (!el || reduceMotion || root.classList.contains('fx-off') || el.dataset.scrambled) return;
    el.dataset.scrambled = '1';
    var finalText = el.textContent;
    var queue = [];
    for (var i = 0; i < finalText.length; i++) {
      var start = Math.random() * 250;                  // mulai acak 0-250ms
      queue.push({ to: finalText[i], start: start, end: start + 200 + Math.random() * 350 });
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
      }
    })();
  }

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
