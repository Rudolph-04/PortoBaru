/* ==========================================================================
   case-data.js — isi "Case Files" (dossier tiap project)

   Semua angka, tabel, status, dan aturan akses di sini diambil langsung
   dari source code masing-masing repo (migration, file .sql, endpoint API,
   types.ts, dan script Luau). Kalau project-nya berubah, ubah juga di sini.

   Format diagram:
   - erd.tables : kotak tabel. x/y = posisi di kanvas, cols = [nama, tanda]
                  tanda: 'pk' (primary key), 'fk' (foreign key), atau teks catatan
   - erd.links  : [tabel asal, kolom FK, tabel tujuan]
   - flow       : diagram status (nodes + edges) atau urutan langkah (lanes)
   - access     : tabel hak akses, atau ringkasan endpoint per tingkat akses
   ========================================================================== */

window.CASE_FILES = [
  {
    id: 'posyandu',
    no: '01',
    name: 'SIP Posyandu',
    year: '2026',
    type: 'Web app',
    repo: 'https://github.com/Rudolph-04/sip-posyandu',
    summary: 'Child health records for a posyandu. Admins and health cadres manage children, immunizations, and weighing sessions; parents get their own dashboard.',
    facts: [['3', 'user roles'], ['4', 'tables'], ['3', 'CRUD resources']],
    actors: ['Admin', 'Kader', 'Orang tua'],
    modules: ['Data anak', 'Imunisasi', 'Penimbangan'],
    features: [
      'Role-based routes: admin, kader, and parent each land on their own dashboard',
      'Full CRUD for child records, immunizations, and weighing sessions (admin & kader)',
      'Deleting a child also removes their immunization and weighing history (cascade)'
    ],
    stack: ['Laravel 12', 'PHP 8.2', 'Laravel Breeze', 'Tailwind CSS', 'SQLite'],
    erd: {
      width: 1000,
      height: 360,
      tables: [
        { id: 'users', x: 20, y: 40, cols: [['id', 'pk'], ['name'], ['email'], ['role', 'admin · kader · ortu']] },
        { id: 'anak', x: 340, y: 40, cols: [['id', 'pk'], ['user_id', 'fk'], ['nama'], ['tanggal_lahir'], ['jenis_kelamin', 'L · P'], ['nama_ibu']] },
        { id: 'imunisasi', x: 680, y: 10, cols: [['id', 'pk'], ['anak_id', 'fk'], ['jenis_imunisasi'], ['tanggal'], ['keterangan']] },
        { id: 'penimbangan', x: 680, y: 185, cols: [['id', 'pk'], ['anak_id', 'fk'], ['tanggal'], ['berat_badan'], ['tinggi_badan']] }
      ],
      links: [['anak', 'user_id', 'users'], ['imunisasi', 'anak_id', 'anak'], ['penimbangan', 'anak_id', 'anak']]
    },
    access: {
      kind: 'matrix',
      title: 'Who can do what',
      cols: ['Admin', 'Kader', 'Orang tua'],
      rows: [
        ['Manage child records', 'yes', 'yes', 'no'],
        ['Manage immunizations', 'yes', 'yes', 'no'],
        ['Manage weighing sessions', 'yes', 'yes', 'no'],
        ['Own dashboard', 'yes', 'yes', 'yes']
      ]
    }
  },

  {
    id: 'playbook',
    no: '02',
    name: 'PlayBook',
    year: '2026',
    type: 'Mobile app + REST API',
    repo: 'https://github.com/Rudolph-04/playbook_lib',
    summary: 'PlayStation rental with a Flutter client and a native PHP REST API: book a console on-site or take it home, pay, and get fined when you return it late.',
    facts: [['10', 'tables'], ['40', 'API endpoints'], ['5', 'rental states']],
    actors: ['Admin', 'Customer'],
    modules: ['Units', 'Packages', 'Rentals', 'Payments', 'Fines', 'Reports'],
    features: [
      'Availability check: a unit is busy while any rental on it is pending, confirmed, or ongoing',
      'Admin-only actions (confirm, start, complete, fines, user management) behind an admin middleware',
      'Late fees calculated from the hours past the rental end time, rounded up'
    ],
    stack: ['Flutter', 'Dart', 'GetX', 'PHP (native REST API)', 'MySQL'],
    erd: {
      width: 1000,
      height: 660,
      tables: [
        { id: 'roles', x: 20, y: 20, cols: [['id', 'pk'], ['role_name']] },
        { id: 'role_permissions', x: 270, y: 20, cols: [['id', 'pk'], ['role_id', 'fk'], ['permission_id', 'fk']] },
        { id: 'permissions', x: 520, y: 20, cols: [['id', 'pk'], ['permission_name']] },
        { id: 'users', x: 20, y: 220, cols: [['id', 'pk'], ['role_id', 'fk'], ['name'], ['email'], ['status']] },
        { id: 'rentals', x: 270, y: 220, cols: [['id', 'pk'], ['user_id', 'fk'], ['rental_unit_id', 'fk'], ['rental_package_id', 'fk'], ['rental_type', 'onsite · take_home'], ['rental_status'], ['pickup_status'], ['total_price']] },
        { id: 'rental_units', x: 520, y: 220, cols: [['id', 'pk'], ['unit_name'], ['console_type'], ['usage_type'], ['status'], ['condition_status']] },
        { id: 'rental_unit_images', x: 770, y: 220, cols: [['id', 'pk'], ['rental_unit_id', 'fk'], ['image_url']] },
        { id: 'payments', x: 20, y: 490, cols: [['id', 'pk'], ['rental_id', 'fk'], ['payment_method'], ['amount'], ['payment_status', 'unpaid · paid · failed']] },
        { id: 'fines', x: 270, y: 490, cols: [['id', 'pk'], ['rental_id', 'fk'], ['overdue_hours'], ['fine_amount'], ['fine_status', 'unpaid · paid']] },
        { id: 'rental_packages', x: 520, y: 490, cols: [['id', 'pk'], ['package_name'], ['duration_hours'], ['price'], ['status']] }
      ],
      links: [
        ['role_permissions', 'role_id', 'roles'],
        ['role_permissions', 'permission_id', 'permissions'],
        ['users', 'role_id', 'roles'],
        ['rentals', 'user_id', 'users'],
        ['rentals', 'rental_unit_id', 'rental_units'],
        ['rentals', 'rental_package_id', 'rental_packages'],
        ['rental_unit_images', 'rental_unit_id', 'rental_units'],
        ['payments', 'rental_id', 'rentals'],
        ['fines', 'rental_id', 'rentals']
      ]
    },
    flow: {
      kind: 'states',
      title: 'Rental lifecycle',
      width: 1000,
      height: 330,
      start: { x: 34, y: 170, label: 'Customer books' },
      nodes: [
        { id: 'pending', x: 200, y: 170 },
        { id: 'confirmed', x: 430, y: 170 },
        { id: 'ongoing', x: 660, y: 170 },
        { id: 'completed', x: 890, y: 170, final: true },
        { id: 'cancelled', x: 430, y: 290, final: true, warn: true }
      ],
      edges: [
        ['pending', 'confirmed', 'admin · confirm'],
        ['confirmed', 'ongoing', 'admin · start'],
        ['ongoing', 'completed', 'admin · complete'],
        ['pending', 'ongoing', 'admin · start, skipping confirm', { arc: 120 }],
        ['pending', 'cancelled', 'cancel'],
        ['confirmed', 'cancelled', 'cancel']
      ],
      notes: [
        'Only the admin or the customer who made the booking can cancel, and only while it is pending or confirmed.',
        'Starting a rental marks the unit as picked up; completing it marks the unit as returned.',
        'Fines can only be issued for ongoing or completed rentals.'
      ]
    },
    access: {
      kind: 'endpoints',
      title: 'API access levels',
      total: 40,
      groups: [
        ['Public', 6, 'login, register, unit & package lists, availability check'],
        ['Signed in', 17, 'own rentals, payments, fines, reports, profile'],
        ['Admin only', 16, 'confirm / start / complete rentals, units, packages, users, fines'],
        ['User only', 1, 'customer-only test route']
      ]
    }
  },

  {
    id: 'sijapam',
    no: '03',
    name: 'SIJAPAM',
    year: '2025',
    type: 'Web app prototype',
    repo: 'https://github.com/Rudolph-04/gudang-inventory',
    summary: 'Sistem Informasi Penjualan Jajanan Amel: a sales and stock dashboard for a small snack business, built as a React + TypeScript front-end prototype.',
    facts: [['5', 'entities'], ['7', 'screens'], ['2', 'user roles']],
    actors: ['Admin', 'Cashier', 'Gemini AI'],
    modules: ['Products', 'Orders', 'Customers', 'Reports'],
    features: [
      'Low-stock warning per product using a minimum stock level',
      'Orders with line items, discount, tax, and three payment methods',
      'Product descriptions generated through the Gemini API'
    ],
    stack: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS', 'Recharts', 'Gemini API'],
    erd: {
      width: 1000,
      height: 470,
      tables: [
        { id: 'User', x: 20, y: 20, cols: [['id', 'pk'], ['username'], ['email'], ['role', 'admin · cashier']] },
        { id: 'Order', x: 350, y: 20, cols: [['id', 'pk'], ['orderNumber'], ['customerId', 'fk'], ['userId', 'fk'], ['finalAmount'], ['paymentMethod', 'cash · card · transfer'], ['status']] },
        { id: 'OrderItem', x: 700, y: 20, cols: [['id', 'pk'], ['orderId', 'fk'], ['productId', 'fk'], ['quantity'], ['subtotal']] },
        { id: 'Customer', x: 20, y: 270, cols: [['id', 'pk'], ['name'], ['phone'], ['address']] },
        { id: 'Product', x: 700, y: 270, cols: [['id', 'pk'], ['name'], ['price'], ['stock'], ['minStockLevel']] }
      ],
      links: [['Order', 'customerId', 'Customer'], ['Order', 'userId', 'User'], ['OrderItem', 'orderId', 'Order'], ['OrderItem', 'productId', 'Product']],
      note: 'Defined as TypeScript interfaces; an order holds its items as a list.'
    },
    flow: {
      kind: 'states',
      title: 'Order status',
      width: 1000,
      height: 240,
      start: { x: 60, y: 120, label: 'Order created' },
      nodes: [
        { id: 'pending', x: 300, y: 120 },
        { id: 'completed', x: 680, y: 55, final: true },
        { id: 'cancelled', x: 680, y: 185, final: true, warn: true }
      ],
      edges: [
        ['pending', 'completed', 'paid & handed over'],
        ['pending', 'cancelled', 'cancelled']
      ]
    }
  },

  {
    id: 'juragan',
    no: '04',
    name: 'Juragan Tahu',
    year: '2026',
    type: 'Roblox game, in progress',
    repo: 'https://github.com/Rudolph-04/RObelox',
    summary: 'A Roblox game about running a fried-tofu stall. The server decides frying quality and payouts, so a player cannot cheat from their own client.',
    facts: [['13', 'Luau scripts'], ['4', 'quality grades'], ['0', 'trust in the client']],
    actors: ['Player', 'NPC customer'],
    modules: ['Frying', 'Queue', 'Vehicle', 'Leaderstats'],
    features: [
      'Server-authoritative frying: the client only says "lift now"; timing, quality, and money are computed on the server',
      'NPC customers with patience, served from a queue at the stall',
      'Drivable cart that can only sell when parked at a selling spot'
    ],
    stack: ['Luau', 'Roblox Studio', 'Rojo'],
    flow: {
      kind: 'lanes',
      title: 'How one frying round works',
      lanes: ['Client', 'Server'],
      steps: [
        ['Client', 'Player presses the prompt at the wok'],
        ['Server', 'Records the start time'],
        ['Client', 'Shows the doneness bar'],
        ['Client', 'Player taps "Lift"'],
        ['Server', 'Measures elapsed time itself'],
        ['Server', 'Grades it: raw, ok, perfect, or burnt'],
        ['Server', 'Pays the player']
      ]
    },
    access: {
      kind: 'modules',
      title: 'Code layout',
      groups: [
        ['Server', 5, 'FryService, PembeliService, KendaraanService, Antrean, Leaderstats'],
        ['Client', 4, 'FryController, KendaraanController, KendaraanMenu, MasakAnimasi'],
        ['Shared', 4, 'FryConfig, PembeliConfig, KendaraanConfig, Remotes']
      ]
    }
  }
];

/* Matriks skill: skill mana dipakai di project mana (bukti dari repo) */
window.SKILL_MATRIX = {
  projects: ['SIP Posyandu', 'PlayBook', 'SIJAPAM', 'Juragan Tahu'],
  groups: [
    ['Analysis & design', [
      ['Data modeling / ERD', [1, 1, 1, 0]],
      ['Role-based access', [1, 1, 1, 0]],
      ['Status flow design', [0, 1, 1, 1]],
      ['Server-authoritative logic', [0, 1, 0, 1]]
    ]],
    ['Build', [
      ['Laravel (PHP)', [1, 0, 0, 0]],
      ['Native PHP REST API', [0, 1, 0, 0]],
      ['Flutter and Dart, with GetX', [0, 1, 0, 0]],
      ['React and TypeScript', [0, 0, 1, 0]],
      ['Tailwind CSS', [1, 0, 1, 0]],
      ['Luau for Roblox', [0, 0, 0, 1]]
    ]],
    ['Data & integration', [
      ['SQL: MySQL and SQLite', [1, 1, 0, 0]],
      ['Charts (Recharts)', [0, 0, 1, 0]],
      ['AI API (Gemini)', [0, 0, 1, 0]]
    ]]
  ]
};
