/* ==========================================================================
   terminal.js — terminal kecil untuk menjelajah porto

   Buka: Ctrl+K / Cmd+K, tombol " >_ " di menu, atau tombol ` (backtick).
   Ketik "help" untuk daftar perintah. Panah atas/bawah = riwayat,
   Tab = lengkapi otomatis, Esc = tutup.

   Semua teks keluaran dibuat lewat textContent (bukan innerHTML), jadi
   apa pun yang diketik pengunjung tidak bisa menyisipkan HTML.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var dialog = document.getElementById('term');
  var out = document.getElementById('term-out');
  var form = document.getElementById('term-form');
  var input = document.getElementById('term-input');
  var openBtn = document.getElementById('term-toggle');
  var closeBtn = document.getElementById('term-close');
  if (!dialog || typeof dialog.showModal !== 'function' || !out || !form || !input) return;

  var SECTIONS = ['about', 'process', 'projects', 'skills', 'contact'];
  var LINKS = [
    ['LinkedIn', 'https://www.linkedin.com/in/aghasha-rudolph-23bb78292'],
    ['GitHub', 'https://github.com/Rudolph-04'],
    ['Instagram', 'https://www.instagram.com/ghash_rdlph/'],
    ['Discord', 'https://discord.com/users/787335381929820161']
  ];
  var history = [];
  var historyIndex = 0;
  var greeted = false;

  /* ---------- Menulis ke layar ---------- */
  function line(text, cls) {
    var p = document.createElement('p');
    p.className = 'term-line' + (cls ? ' ' + cls : '');
    p.textContent = text;
    out.appendChild(p);
    return p;
  }

  function linkLine(label, href) {
    var p = document.createElement('p');
    p.className = 'term-line';
    var name = document.createElement('span');
    name.className = 'term-key';
    name.textContent = label.padEnd(11, ' ');
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = href.replace(/^https:\/\/(www\.)?/, '');
    p.appendChild(name);
    p.appendChild(a);
    out.appendChild(p);
  }

  function table(rows) {
    var width = rows.reduce(function (w, r) { return Math.max(w, r[0].length); }, 0) + 3;
    rows.forEach(function (r) {
      var p = document.createElement('p');
      p.className = 'term-line';
      var k = document.createElement('span');
      k.className = 'term-key';
      k.textContent = r[0].padEnd(width, ' ');
      p.appendChild(k);
      p.appendChild(document.createTextNode(r[1]));
      out.appendChild(p);
    });
  }

  function echoCommand(cmd) {
    var p = document.createElement('p');
    p.className = 'term-line term-echo';
    var prompt = document.createElement('span');
    prompt.className = 'term-prompt';
    prompt.textContent = 'guest@aghasha:~$ ';
    p.appendChild(prompt);
    p.appendChild(document.createTextNode(cmd));
    out.appendChild(p);
  }

  function scrollDown() {
    out.scrollTop = out.scrollHeight;
  }

  /* ---------- Aksi ke halaman ---------- */
  function closeTerm() {
    if (dialog.open) dialog.close();
  }

  function goto(id) {
    var target = id === 'top' ? document.body : document.getElementById(id);
    if (!target) return false;
    closeTerm();
    if (window.CaseFiles && window.CaseFiles.close) window.CaseFiles.close();
    if (id === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else target.scrollIntoView({ behavior: 'smooth' });
    return true;
  }

  function findCase(query) {
    var list = (window.CaseFiles && window.CaseFiles.list) || [];
    var q = query.toLowerCase().replace(/\s+/g, '');
    var n = parseInt(q, 10);
    return list.filter(function (c) {
      return (!isNaN(n) && parseInt(c.no, 10) === n) ||
        c.id === q ||
        c.name.toLowerCase().replace(/\s+/g, '').indexOf(q) === 0;
    })[0];
  }

  /* ---------- Daftar perintah ---------- */
  var COMMANDS = {
    help: {
      desc: 'list commands',
      run: function () {
        table(Object.keys(COMMANDS).filter(function (k) { return !COMMANDS[k].hidden; }).map(function (k) {
          return [k + (COMMANDS[k].args ? ' ' + COMMANDS[k].args : ''), COMMANDS[k].desc];
        }));
        line('Tip: Tab completes, arrow up/down browses history.', 'term-dim');
      }
    },
    whoami: {
      desc: 'who built this',
      run: function () {
        line('Aghasha Rudolph');
        line('Information Systems student, semester 6, Smart Application Supporting Information Systems track.');
        line('Maps how a process runs today, then designs the system features that take the busywork off.', 'term-dim');
      }
    },
    projects: {
      desc: 'list case files',
      run: function () {
        var list = (window.CaseFiles && window.CaseFiles.list) || [];
        table(list.map(function (c) { return [c.no + '  ' + c.name, c.type + ' · ' + c.year]; }));
        line('Open one with: open 2   or   open playbook', 'term-dim');
      }
    },
    open: {
      args: '<no|name>',
      desc: 'open a case file',
      run: function (arg) {
        if (!arg) { line('usage: open <no|name>   e.g. open 2', 'term-err'); return; }
        var c = findCase(arg);
        if (!c) { line('no case file matches "' + arg + '". Try: projects', 'term-err'); return; }
        line('Decrypting case file ' + c.no + ' // ' + c.name + ' ...', 'term-ok');
        setTimeout(function () {
          closeTerm();
          document.getElementById('projects').scrollIntoView({ block: 'start' });
          window.CaseFiles.open(c.id);
        }, 350);
      }
    },
    goto: {
      args: '<section>',
      desc: SECTIONS.join(' / '),
      run: function (arg) {
        var id = (arg || '').toLowerCase();
        if (id === '~' || id === 'home') id = 'top';
        if (id !== 'top' && SECTIONS.indexOf(id) < 0) {
          line('usage: goto <' + SECTIONS.join('|') + '>', 'term-err');
          return;
        }
        goto(id);
      }
    },
    skills: {
      desc: 'skills, grouped',
      run: function () {
        var m = window.SKILL_MATRIX;
        if (!m) { line('skill data not loaded', 'term-err'); return; }
        m.groups.forEach(function (g) {
          line(g[0], 'term-head');
          line('  ' + g[1].map(function (row) { return row[0]; }).join(', '));
        });
      }
    },
    contact: {
      desc: 'ways to reach me',
      run: function () {
        LINKS.forEach(function (l) { linkLine(l[0], l[1]); });
      }
    },
    fx: {
      args: '[on|off]',
      desc: 'visual effects on or off',
      run: function (arg) {
        var off = root.classList.contains('fx-off');
        var want = arg === 'on' ? false : arg === 'off' ? true : !off;
        var fxBtn = document.getElementById('fx-toggle');
        if (want !== off && fxBtn) fxBtn.click();
        line('fx ' + (want ? 'off' : 'on'), 'term-ok');
      }
    },
    flip: {
      desc: 'flip the ID card',
      run: function () {
        if (!root.classList.contains('has-webgl')) { line('3D card is not available in this browser', 'term-err'); return; }
        line('Flipping ID card ...', 'term-ok');
        setTimeout(function () {
          goto('top');
          setTimeout(function () { document.dispatchEvent(new CustomEvent('lanyard:flip')); }, 450);
        }, 250);
      }
    },
    reboot: {
      desc: 'replay the boot screen',
      run: function () {
        line('Rebooting ...', 'term-ok');
        try { sessionStorage.removeItem('booted'); } catch (e) {}
        setTimeout(function () {
          location.href = location.pathname + location.search;
        }, 500);
      }
    },
    echo: {
      args: '<text>',
      desc: 'print text',
      run: function (arg) { line(arg || ''); }
    },
    clear: {
      desc: 'clear the screen',
      run: function () { out.textContent = ''; }
    },
    exit: {
      desc: 'close the terminal',
      run: function () { closeTerm(); }
    },
    sudo: {
      hidden: true,
      run: function (arg) {
        if (/^hire/.test(arg || '')) {
          line('[sudo] password for recruiter: ********');
          setTimeout(function () {
            line('ACCESS GRANTED. Routing you to contact ...', 'term-ok');
            scrollDown();
            setTimeout(function () { goto('contact'); }, 900);
          }, 600);
          return;
        }
        line('guest is not in the sudoers file. This incident will be reported.', 'term-err');
      }
    }
  };
  // Alias
  COMMANDS.ls = { hidden: true, run: COMMANDS.projects.run };
  COMMANDS.cd = { hidden: true, run: COMMANDS.goto.run };

  function run(raw) {
    var cmd = raw.trim();
    echoCommand(cmd);
    if (cmd) {
      history.push(cmd);
      historyIndex = history.length;
      var space = cmd.indexOf(' ');
      var name = (space < 0 ? cmd : cmd.slice(0, space)).toLowerCase();
      var arg = space < 0 ? '' : cmd.slice(space + 1).trim();
      if (COMMANDS[name]) COMMANDS[name].run(arg);
      else line('command not found: ' + name + '. Type help.', 'term-err');
    }
    scrollDown();
  }

  /* ---------- Tab: lengkapi perintah / argumen ---------- */
  function complete(value) {
    var parts = value.split(' ');
    if (parts.length === 1) {
      var cmds = Object.keys(COMMANDS).filter(function (k) { return k.indexOf(parts[0].toLowerCase()) === 0; });
      return cmds.length === 1 ? cmds[0] + ' ' : null;
    }
    var head = parts[0].toLowerCase();
    var rest = parts.slice(1).join(' ').toLowerCase();
    var pool = [];
    if (head === 'goto' || head === 'cd') pool = SECTIONS;
    if (head === 'open') pool = ((window.CaseFiles && window.CaseFiles.list) || []).map(function (c) { return c.id; });
    if (head === 'fx') pool = ['on', 'off'];
    var hits = pool.filter(function (x) { return x.indexOf(rest) === 0; });
    return hits.length === 1 ? head + ' ' + hits[0] : null;
  }

  /* ---------- Buka / tutup ---------- */
  function openTerm() {
    var intro = document.getElementById('intro');
    if (intro && !intro.hidden) return; // jangan ganggu opening
    if (dialog.open) { input.focus(); return; }
    root.classList.add('term-open');
    dialog.showModal();
    if (!greeted) {
      greeted = true;
      line('AGHASHA//OS  v6.0  (semester 6 build)', 'term-head');
      line('Type help to see what you can do here.', 'term-dim');
    }
    scrollDown();
    input.focus();
  }

  dialog.addEventListener('close', function () {
    root.classList.remove('term-open');
    if (openBtn && document.activeElement === document.body) openBtn.focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = input.value;
    input.value = '';
    run(value);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex];
    } else if (e.key === 'ArrowDown' && history.length) {
      e.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
    } else if (e.key === 'Tab') {
      var done = complete(input.value);
      if (done) {
        e.preventDefault();
        input.value = done;
      }
    }
  });

  // Klik di area luar panel = tutup; klik di dalam = fokus ke input
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) closeTerm();
    else if (!e.target.closest('a, button') && !window.getSelection().toString()) input.focus();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeTerm);
  if (openBtn) openBtn.addEventListener('click', openTerm);

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (dialog.open) closeTerm(); else openTerm();
    } else if (e.key === '`' && !typing && !dialog.open) {
      e.preventDefault();
      openTerm();
    }
  });

  // Dipakai tombol / link lain kalau perlu
  window.Terminal = { open: openTerm, close: closeTerm, run: run };
})();
