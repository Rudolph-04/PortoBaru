/* ==========================================================================
   case-files.js — section Projects versi "Case Files"

   1. Index project: hover / fokus pada baris -> panel pratinjau di kanan berubah
   2. Klik baris -> dossier layar penuh (<dialog>) dengan tab:
      Overview · Data model (ERD) · Flow (diagram status / urutan) · Access
   3. Matriks skill (skill mana dipakai di project mana)

   Data diambil dari js/case-data.js. Semua diagram digambar sebagai SVG,
   lalu "digambar ulang" dengan animasi garis saat tab dibuka.
   ========================================================================== */

(function () {
  'use strict';

  var CASES = window.CASE_FILES || [];
  var currentCase = null;
  var root = document.documentElement;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  if (!CASES.length) return;

  /* ---------- Pembuat elemen kecil ---------- */
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function s(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function setAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }

  function append(node, children) {
    if (children === undefined || children === null) return;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  function byId(id) {
    for (var i = 0; i < CASES.length; i++) if (CASES[i].id === id) return CASES[i];
    return null;
  }

  /* ---------- Peta sistem kecil (aktor -> modul) ---------- */
  function systemMap(c) {
    return h('figure', { class: 'sysmap', 'aria-label': 'System map: ' + c.actors.join(', ') + ' use ' + c.modules.join(', ') }, [
      h('figcaption', { text: 'Sys.map' }),
      h('div', { class: 'sysmap-row actors' }, c.actors.map(function (a) {
        return h('span', { class: 'node' + (/AI$/.test(a) ? ' node-ext' : ''), text: a });
      })),
      h('div', { class: 'sysmap-link', 'aria-hidden': 'true' }),
      h('div', { class: 'sysmap-row modules' }, c.modules.map(function (m) {
        return h('span', { class: 'node', text: m });
      }))
    ]);
  }

  function factsRow(c) {
    return h('dl', { class: 'case-facts' }, c.facts.map(function (f) {
      return h('div', null, [h('dt', { text: f[1] }), h('dd', { text: f[0] })]);
    }));
  }

  /* ==========================================================================
     DIAGRAM: ERD
     ========================================================================== */
  var BOX_W = 220;
  var HEAD_H = 30;
  var ROW_H = 22;

  function tableHeight(t) {
    return HEAD_H + t.cols.length * ROW_H + 8;
  }

  function rowY(t, index) {
    return t.y + HEAD_H + index * ROW_H + ROW_H / 2 + 4;
  }

  function buildErd(erd, label) {
    var svg = s('svg', {
      class: 'diagram erd',
      viewBox: '0 0 ' + erd.width + ' ' + erd.height,
      role: 'img',
      'aria-label': label
    });
    var tables = {};
    erd.tables.forEach(function (t) { tables[t.id] = t; });

    // Relasi digambar duluan supaya berada di belakang kotak tabel
    var linkLayer = s('g', { class: 'erd-links' });
    erd.links.forEach(function (link, i) {
      var a = tables[link[0]];
      var b = tables[link[2]];
      var ay = rowY(a, a.cols.findIndex(function (c) { return c[0] === link[1]; }));
      var by = rowY(b, 0);
      var aCx = a.x + BOX_W / 2;
      var bCx = b.x + BOX_W / 2;
      var ax;
      var bx;
      var d;
      if (Math.abs(bCx - aCx) < 10) {
        // Satu kolom: keluar dari sisi kiri lalu masuk lagi dari kiri
        ax = a.x;
        bx = b.x;
        var out = Math.max(4, ax - 34);
        d = 'M' + ax + ' ' + ay + ' C' + out + ' ' + ay + ' ' + out + ' ' + by + ' ' + bx + ' ' + by;
      } else {
        var toRight = bCx > aCx;
        ax = toRight ? a.x + BOX_W : a.x;
        bx = toRight ? b.x : b.x + BOX_W;
        var dx = Math.min(60, Math.max(12, Math.abs(bx - ax) / 2)) * (toRight ? 1 : -1);
        d = 'M' + ax + ' ' + ay + ' C' + (ax + dx) + ' ' + ay + ' ' + (bx - dx) + ' ' + by + ' ' + bx + ' ' + by;
      }
      linkLayer.appendChild(s('path', { class: 'draw', d: d, pathLength: '1', style: '--d:' + (0.25 + i * 0.06) + 's' }));
      linkLayer.appendChild(s('circle', { class: 'erd-fk-dot', cx: ax, cy: ay, r: 3.5 }));
      linkLayer.appendChild(s('rect', { class: 'erd-pk-mark', x: bx - 2, y: by - 6, width: 4, height: 12 }));
    });
    svg.appendChild(linkLayer);

    erd.tables.forEach(function (t, i) {
      var g = s('g', { class: 'erd-table pop', style: '--d:' + (i * 0.05) + 's' });
      var hgt = tableHeight(t);
      g.appendChild(s('rect', { class: 'erd-box', x: t.x, y: t.y, width: BOX_W, height: hgt, rx: 2 }));
      g.appendChild(s('rect', { class: 'erd-head', x: t.x, y: t.y, width: BOX_W, height: HEAD_H, rx: 2 }));
      g.appendChild(s('text', { class: 'erd-title', x: t.x + 12, y: t.y + 20, text: t.id }));
      t.cols.forEach(function (col, r) {
        var y = rowY(t, r);
        if (r > 0) g.appendChild(s('line', { class: 'erd-sep', x1: t.x + 8, x2: t.x + BOX_W - 8, y1: y - ROW_H / 2, y2: y - ROW_H / 2 }));
        var tag = col[1];
        var isKey = tag === 'pk' || tag === 'fk';
        g.appendChild(s('text', { class: 'erd-col' + (isKey ? ' is-' + tag : ''), x: t.x + 12, y: y + 4, text: col[0] }));
        if (isKey) {
          g.appendChild(s('text', { class: 'erd-tag is-' + tag, x: t.x + BOX_W - 12, y: y + 4, 'text-anchor': 'end', text: tag.toUpperCase() }));
        } else if (tag) {
          g.appendChild(s('text', { class: 'erd-note', x: t.x + BOX_W - 12, y: y + 4, 'text-anchor': 'end', text: tag }));
        }
      });
      svg.appendChild(g);
    });
    return svg;
  }

  /* ==========================================================================
     DIAGRAM: alur status
     ========================================================================== */
  var NODE_W = 150;
  var NODE_H = 44;

  // Titik di tepi kotak (cx, cy) yang searah dengan titik tujuan (tx, ty)
  function edgePoint(cx, cy, tx, ty) {
    var dx = tx - cx;
    var dy = ty - cy;
    var sx = dx === 0 ? Infinity : (NODE_W / 2) / Math.abs(dx);
    var sy = dy === 0 ? Infinity : (NODE_H / 2) / Math.abs(dy);
    var k = Math.min(sx, sy);
    return [cx + dx * k, cy + dy * k];
  }

  function buildStates(flow, label) {
    var id = 'arrow-' + (++uid);
    var svg = s('svg', {
      class: 'diagram states',
      viewBox: '0 0 ' + flow.width + ' ' + flow.height,
      role: 'img',
      'aria-label': label
    });
    svg.appendChild(s('defs', null, [
      s('marker', { id: id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, [
        s('path', { class: 'arrow-head', d: 'M0 0 L10 5 L0 10 z' })
      ])
    ]));

    var nodes = {};
    flow.nodes.forEach(function (n) { nodes[n.id] = n; });

    var edges = s('g', { class: 'state-edges' });
    // Titik awal -> state pertama
    var first = flow.nodes[0];
    var p0 = edgePoint(first.x, first.y, flow.start.x, flow.start.y);
    edges.appendChild(s('path', { class: 'draw', d: 'M' + (flow.start.x + 8) + ' ' + flow.start.y + ' L' + p0[0] + ' ' + p0[1], pathLength: '1', 'marker-end': 'url(#' + id + ')', style: '--d:.1s' }));

    var CHAR_W = 6.7; // lebar kira-kira satu huruf label (font mono 11px)

    flow.edges.forEach(function (e, i) {
      var a = nodes[e[0]];
      var b = nodes[e[1]];
      var opt = e[3] || {};
      var text = e[2];
      var w = text.length * CHAR_W;
      var d, lx, ly, anchor = 'middle';

      if (opt.arc) {
        // Garis lengkung lewat atas: dari atas node asal ke atas node tujuan
        var q1 = [a.x, a.y - NODE_H / 2];
        var q2 = [b.x, b.y - NODE_H / 2];
        var c = [(q1[0] + q2[0]) / 2, Math.min(q1[1], q2[1]) - opt.arc];
        d = 'M' + q1[0] + ' ' + q1[1] + ' Q' + c[0] + ' ' + c[1] + ' ' + q2[0] + ' ' + q2[1];
        // Label di puncak lengkungan (titik tengah kurva kuadrat)
        lx = 0.25 * q1[0] + 0.5 * c[0] + 0.25 * q2[0];
        ly = 0.25 * q1[1] + 0.5 * c[1] + 0.25 * q2[1] - 8;
      } else {
        var p1 = edgePoint(a.x, a.y, b.x, b.y);
        var p2 = edgePoint(b.x, b.y, a.x, a.y);
        d = 'M' + p1[0] + ' ' + p1[1] + ' L' + p2[0] + ' ' + p2[1];
        var dx = p2[0] - p1[0];
        var dy = p2[1] - p1[1];
        var mx = (p1[0] + p2[0]) / 2;
        var my = (p1[1] + p2[1]) / 2;
        if (Math.abs(dx) >= Math.abs(dy)) {
          // Garis landai: label di atas garis, dinaikkan sesuai kemiringan
          // supaya ujung label tidak menyentuh garis
          var slope = Math.abs(dy / dx);
          lx = mx;
          ly = my - 9 - slope * w / 2;
          // Celah antar node terlalu sempit untuk label -> taruh di atas node
          if (Math.abs(dy) < 8 && w > Math.abs(dx) - 12) ly = my - NODE_H / 2 - 9;
        } else {
          // Garis curam: label di samping kanan garis
          lx = mx + 10;
          ly = my + 4;
          anchor = 'start';
        }
      }

      edges.appendChild(s('path', {
        class: 'draw' + (b.warn ? ' is-warn' : ''),
        d: d,
        pathLength: '1',
        'marker-end': 'url(#' + id + ')',
        style: '--d:' + (0.3 + i * 0.12) + 's'
      }));
      edges.appendChild(s('text', {
        class: 'state-label pop',
        x: lx.toFixed(1),
        y: ly.toFixed(1),
        'text-anchor': anchor,
        style: '--d:' + (0.5 + i * 0.12) + 's',
        text: text
      }));
    });
    svg.appendChild(edges);

    // Titik awal + label
    svg.appendChild(s('g', { class: 'pop', style: '--d:0s' }, [
      s('circle', { class: 'state-start', cx: flow.start.x, cy: flow.start.y, r: 7 }),
      s('text', { class: 'state-label', x: flow.start.x - 6, y: flow.start.y + 30, text: flow.start.label })
    ]));

    flow.nodes.forEach(function (n, i) {
      var g = s('g', { class: 'state-node pop' + (n.final ? ' is-final' : '') + (n.warn ? ' is-warn' : ''), style: '--d:' + (0.1 + i * 0.1) + 's' });
      g.appendChild(s('rect', { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, rx: NODE_H / 2 }));
      if (n.final) g.appendChild(s('rect', { class: 'inner', x: n.x - NODE_W / 2 + 4, y: n.y - NODE_H / 2 + 4, width: NODE_W - 8, height: NODE_H - 8, rx: (NODE_H - 8) / 2 }));
      g.appendChild(s('text', { x: n.x, y: n.y + 5, 'text-anchor': 'middle', text: n.id }));
      svg.appendChild(g);
    });
    return svg;
  }

  /* ---------- Alur dua jalur (Client / Server) ---------- */
  function buildLanes(flow) {
    return h('div', { class: 'lanes' }, [
      h('div', { class: 'lanes-head' }, flow.lanes.map(function (l) { return h('span', { text: l }); })),
      h('ol', { class: 'lanes-steps' }, flow.steps.map(function (step, i) {
        return h('li', {
          class: 'lane-step pop lane-' + (flow.lanes.indexOf(step[0]) === 0 ? 'a' : 'b'),
          style: '--d:' + (i * 0.1) + 's'
        }, [h('span', { class: 'lane-no', text: String(i + 1).padStart(2, '0') }), h('span', { text: step[1] })]);
      }))
    ]);
  }

  /* ---------- Akses ---------- */
  function buildAccess(access) {
    if (access.kind === 'matrix') {
      return h('table', { class: 'access-matrix' }, [
        h('thead', null, h('tr', null, [h('th', { scope: 'col', text: 'Capability' })].concat(access.cols.map(function (c) {
          return h('th', { scope: 'col', text: c });
        })))),
        h('tbody', null, access.rows.map(function (row) {
          return h('tr', null, [h('th', { scope: 'row', text: row[0] })].concat(row.slice(1).map(function (v) {
            return h('td', { class: 'is-' + v }, [
              h('span', { class: 'mark', 'aria-hidden': 'true' }),
              h('span', { class: 'sr-only', text: v === 'yes' ? 'Allowed' : 'Not allowed' })
            ]);
          })));
        }))
      ]);
    }

    if (access.kind === 'endpoints') {
      var bar = h('div', { class: 'endpoint-bar', 'aria-hidden': 'true' }, access.groups.map(function (g, i) {
        return h('span', { class: 'seg seg-' + i, style: 'flex:' + g[1] });
      }));
      return h('div', { class: 'endpoints' }, [
        h('p', { class: 'endpoints-total' }, [h('strong', { text: String(access.total) }), ' endpoints, by who can call them']),
        bar,
        h('ul', { class: 'endpoint-legend' }, access.groups.map(function (g, i) {
          return h('li', null, [
            h('span', { class: 'swatch seg-' + i, 'aria-hidden': 'true' }),
            h('span', { class: 'legend-name', text: g[0] }),
            h('span', { class: 'legend-count', text: String(g[1]) }),
            h('span', { class: 'legend-desc', text: g[2] })
          ]);
        }))
      ]);
    }

    // kind: 'modules'
    return h('div', { class: 'module-groups' }, access.groups.map(function (g) {
      return h('div', { class: 'module-group' }, [
        h('p', { class: 'module-count' }, [h('strong', { text: String(g[1]) }), ' ' + g[0].toLowerCase() + ' scripts']),
        h('p', { class: 'module-files', text: g[2] })
      ]);
    }));
  }

  /* ==========================================================================
     DOSSIER (dialog)
     ========================================================================== */
  var dialog = document.getElementById('dossier');
  var lastTrigger = null;

  function buildPanels(c) {
    var panels = [];

    panels.push({
      id: 'overview',
      label: 'Overview',
      body: [
        h('p', { class: 'dossier-summary', text: c.summary }),
        factsRow(c),
        h('div', { class: 'dossier-split' }, [
          h('div', null, [
            h('h4', { class: 'dossier-sub', text: 'Key features' }),
            h('ul', { class: 'project-points' }, c.features.map(function (f) { return h('li', { text: f }); })),
            h('h4', { class: 'dossier-sub', text: 'Stack' }),
            h('p', { class: 'project-stack', text: c.stack.join(' · ') })
          ]),
          systemMap(c)
        ])
      ]
    });

    if (c.erd) {
      panels.push({
        id: 'data',
        label: 'Data model',
        body: [
          h('p', { class: 'dossier-sub-lead', text: c.erd.tables.length + ' tables · ' + c.erd.links.length + ' relations' + (c.erd.note ? ' — ' + c.erd.note : '') }),
          h('div', { class: 'diagram-scroll' }, buildErd(c.erd, 'Entity relationship diagram of ' + c.name))
        ]
      });
    }

    if (c.flow) {
      panels.push({
        id: 'flow',
        label: 'Flow',
        body: [
          h('p', { class: 'dossier-sub-lead', text: c.flow.title }),
          c.flow.kind === 'lanes'
            ? buildLanes(c.flow)
            : h('div', { class: 'diagram-scroll' }, buildStates(c.flow, c.flow.title + ' of ' + c.name)),
          c.flow.notes ? h('ul', { class: 'flow-notes' }, c.flow.notes.map(function (n) { return h('li', { text: n }); })) : null
        ]
      });
    }

    if (c.access) {
      panels.push({
        id: 'access',
        label: c.access.kind === 'modules' ? 'Code' : 'Access',
        body: [h('p', { class: 'dossier-sub-lead', text: c.access.title }), buildAccess(c.access)]
      });
    }
    return panels;
  }

  /* ---------- Efek transisi ----------
     glitch(): potongan-potongan panel bergeser sebentar (0,3 detik)
     canMorph(): browser mendukung View Transitions & efek tidak dimatikan */
  function effectsOn() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !root.classList.contains('fx-off');
  }

  function glitch(el) {
    if (!el || !effectsOn()) return;
    el.classList.remove('glitch');
    void el.offsetWidth; // mulai ulang animasi
    el.classList.add('glitch');
  }

  document.addEventListener('animationend', function (e) {
    if (e.target.classList && e.target.classList.contains('glitch')) e.target.classList.remove('glitch');
  });

  function canMorph() {
    return typeof document.startViewTransition === 'function' && effectsOn();
  }

  function inView(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  // Kirim catatan ke log sistem (ditampilkan oleh js/alive.js)
  function siteLog(msg, kind) {
    document.dispatchEvent(new CustomEvent('site:log', { detail: { msg: msg, kind: kind } }));
  }

  function rowFor(id) {
    return document.querySelector('.case-row[data-case="' + id + '"]');
  }

  function selectTab(tabs, panelEls, index, focus, animate) {
    if (animate) {
      glitch(panelEls[index].parentElement);
      siteLog('reading ' + currentCase + '/' + tabs[index].textContent.toLowerCase().replace(/\s+/g, '-'), 'glitch');
    }
    tabs.forEach(function (t, i) {
      var on = i === index;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panelEls[i].hidden = !on;
      panelEls[i].classList.remove('is-drawn');
    });
    if (focus) tabs[index].focus();
    // Satu frame kemudian supaya animasi garis berjalan dari awal
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { panelEls[index].classList.add('is-drawn'); });
    });
  }

  function openDossier(id, trigger) {
    var c = byId(id);
    if (!c || !dialog) return;
    lastTrigger = trigger || null;
    currentCase = id;
    siteLog('decrypting case file ' + c.no + ' // ' + c.name, 'open');
    dialog.textContent = '';

    var panels = buildPanels(c);
    var tabs = [];
    var panelEls = [];
    var base = 'dossier-' + c.id;

    var tablist = h('div', { class: 'dossier-tabs', role: 'tablist', 'aria-label': c.name + ' file' });
    panels.forEach(function (p, i) {
      var tab = h('button', {
        class: 'dossier-tab',
        type: 'button',
        role: 'tab',
        id: base + '-tab-' + p.id,
        'aria-controls': base + '-panel-' + p.id,
        text: p.label
      });
      tab.addEventListener('click', function () {
        if (tab.getAttribute('aria-selected') !== 'true') selectTab(tabs, panelEls, i, false, true);
      });
      tabs.push(tab);
      tablist.appendChild(tab);

      panelEls.push(h('section', {
        class: 'dossier-panel',
        role: 'tabpanel',
        id: base + '-panel-' + p.id,
        'aria-labelledby': base + '-tab-' + p.id,
        tabindex: '0'
      }, p.body));
    });

    // Panah kiri/kanan untuk pindah tab
    tablist.addEventListener('keydown', function (e) {
      var current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs, panelEls, next, true, true);
      }
    });

    var index = CASES.indexOf(c);
    var nextCase = CASES[(index + 1) % CASES.length];

    var closeBtn = h('button', { class: 'dossier-close', type: 'button', 'aria-label': 'Close file' }, [h('span', { 'aria-hidden': 'true', text: 'Close' }), h('span', { class: 'dossier-x', 'aria-hidden': 'true' })]);
    closeBtn.addEventListener('click', closeDossier);

    var nextBtn = h('button', { class: 'dossier-next', type: 'button' }, [
      h('span', { class: 'dossier-next-label', text: 'Next file' }),
      h('span', { class: 'dossier-next-name', text: nextCase.no + ' ' + nextCase.name })
    ]);
    nextBtn.addEventListener('click', function () {
      openDossier(nextCase.id, rowFor(nextCase.id));
      glitch(dialog.querySelector('.dossier-inner'));
    });

    dialog.setAttribute('aria-labelledby', base + '-title');
    append(dialog, h('div', { class: 'dossier-inner' }, [
      h('header', { class: 'dossier-head' }, [
        h('div', null, [
          h('p', { class: 'dossier-meta', text: 'Case file ' + c.no + ' // ' + c.type + ' // ' + c.year }),
          h('h3', { class: 'dossier-title', id: base + '-title', text: c.name })
        ]),
        closeBtn
      ]),
      tablist,
      h('div', { class: 'dossier-body' }, panelEls),
      h('footer', { class: 'dossier-foot' }, [
        h('a', { class: 'project-link', href: c.repo, target: '_blank', rel: 'noopener' }, [
          'Source on GitHub ',
          s('svg', { class: 'i-arrow', viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('path', { d: 'M4.5 11.5l7-7M5.5 4.5h6v6' }))
        ]),
        nextBtn
      ])
    ]));

    if (!dialog.open) {
      root.classList.add('dossier-open');
      dialog.showModal();
    }
    dialog.scrollTop = 0;
    selectTab(tabs, panelEls, 0, false);
    closeBtn.focus();
  }

  /* Buka: nama project di daftar "terbang" dan membesar jadi judul dossier.
     Tutup: kebalikannya. Browser tanpa View Transitions tetap buka/tutup biasa. */
  function openWithMorph(id, row) {
    var name = row && row.querySelector('.case-name');
    if (!canMorph() || !name || dialog.open || !inView(row)) {
      openDossier(id, row);
      return;
    }
    name.style.viewTransitionName = 'case-title';
    var vt = document.startViewTransition(function () {
      name.style.viewTransitionName = '';
      openDossier(id, row);
      var title = dialog.querySelector('.dossier-title');
      if (title) title.style.viewTransitionName = 'case-title';
    });
    vt.finished.catch(function () {}).then(function () {
      var title = dialog.querySelector('.dossier-title');
      if (title) title.style.viewTransitionName = '';
    });
  }

  function closeDossier() {
    if (!dialog || !dialog.open) return;
    var title = dialog.querySelector('.dossier-title');
    var row = rowFor(currentCase);
    var name = row && row.querySelector('.case-name');
    if (!canMorph() || !title || !name || !inView(row)) {
      dialog.close();
      return;
    }
    title.style.viewTransitionName = 'case-title';
    var vt = document.startViewTransition(function () {
      title.style.viewTransitionName = '';
      dialog.close();
      name.style.viewTransitionName = 'case-title';
    });
    vt.finished.catch(function () {}).then(function () { name.style.viewTransitionName = ''; });
  }

  if (dialog && typeof dialog.showModal === 'function') {
    dialog.addEventListener('close', function () {
      root.classList.remove('dossier-open');
      if (lastTrigger) lastTrigger.focus();
    });
    // Esc: tutup lewat closeDossier supaya animasinya ikut jalan
    dialog.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeDossier();
    });
    // Klik di luar panel (latar gelap) = tutup
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) closeDossier();
    });
  }

  /* ==========================================================================
     INDEX + PRATINJAU
     ========================================================================== */
  var preview = document.querySelector('.case-preview');
  var rows = document.querySelectorAll('.case-row');
  var current = null;

  function showPreview(id) {
    if (!preview || id === current) return;
    var c = byId(id);
    if (!c) return;
    current = id;
    rows.forEach(function (r) { r.classList.toggle('is-current', r.dataset.case === id); });
    preview.classList.remove('is-in');
    preview.textContent = '';
    append(preview, [
      h('p', { class: 'case-preview-meta', text: 'File ' + c.no + ' // preview' }),
      systemMap(c),
      factsRow(c),
      h('p', { class: 'case-preview-hint', text: 'Click to open the full file' })
    ]);
    requestAnimationFrame(function () { preview.classList.add('is-in'); });
  }

  rows.forEach(function (row) {
    var id = row.dataset.case;
    row.addEventListener('mouseenter', function () { showPreview(id); });
    row.addEventListener('focus', function () { showPreview(id); });
    if (dialog && typeof dialog.showModal === 'function') {
      row.addEventListener('click', function (e) {
        // Ctrl/Cmd-klik tetap membuka GitHub di tab baru seperti link biasa
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openWithMorph(id, row);
      });
    }
  });

  if (rows.length) showPreview(rows[0].dataset.case);

  // Dipakai js/terminal.js: perintah "projects" dan "open <nama>"
  window.CaseFiles = {
    list: CASES.map(function (c) { return { id: c.id, no: c.no, name: c.name, type: c.type, year: c.year }; }),
    open: function (id) {
      if (!dialog || typeof dialog.showModal !== 'function' || !byId(id)) return false;
      openWithMorph(id, rowFor(id));
      return true;
    },
    close: closeDossier
  };

  /* ==========================================================================
     MATRIKS SKILL
     ========================================================================== */
  var matrixHost = document.getElementById('skill-matrix');
  var matrix = window.SKILL_MATRIX;
  if (matrixHost && matrix) {
    var table = h('table', { class: 'skill-matrix' }, [
      h('caption', { class: 'sr-only', text: 'Skills and the projects that use them' }),
      h('thead', null, h('tr', null, [h('th', { scope: 'col', text: 'Skill' })].concat(matrix.projects.map(function (p, i) {
        return h('th', { scope: 'col' }, [h('span', { class: 'col-no', text: '0' + (i + 1) }), h('span', { class: 'col-name', text: p })]);
      }))))
    ]);
    var rowNo = 0; // dipakai untuk jeda animasi: tanda muncul baris demi baris
    matrix.groups.forEach(function (group) {
      var body = h('tbody', null, [h('tr', { class: 'group-row' }, h('th', { scope: 'rowgroup', colspan: String(matrix.projects.length + 1), text: group[0] }))]);
      group[1].forEach(function (row) {
        var r = rowNo++;
        body.appendChild(h('tr', null, [h('th', { scope: 'row', text: row[0] })].concat(row[1].map(function (v, i) {
          return h('td', { class: v ? 'is-yes' : 'is-no' }, [
            h('span', { class: 'mark', 'aria-hidden': 'true', style: '--d:' + (r * 0.045 + i * 0.07).toFixed(3) + 's' }),
            h('span', { class: 'sr-only', text: (v ? 'Used in ' : 'Not used in ') + matrix.projects[i] })
          ]);
        }))));
      });
      table.appendChild(body);
    });
    matrixHost.textContent = '';
    matrixHost.appendChild(h('div', { class: 'matrix-scroll' }, table));
  }
})();
