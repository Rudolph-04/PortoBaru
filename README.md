# Porto

Portfolio Aghasha Rudolph, mahasiswa Sistem Informasi.

Live: https://rudolph-04.github.io/PortoBaru/

## Isi

- Opening ala boot screen
- Kartu ID 3D di lanyard, bisa di-drag dan diputar
- Project dalam bentuk case file (SIP Posyandu, PlayBook, SIJAPAM, Juragan Tahu): ERD, alur status, dan hak akses, diambil dari source code masing-masing
- Matriks skill: skill mana dipakai di project mana
- Terminal (Ctrl+K atau tombol `>_` di menu): ketik `help`, bisa buka project, pindah section, nyalain/matiin efek, sampai balik kartu ID

## Jalanin di lokal

```bash
python -m http.server 8000
```

Buka `http://localhost:8000`. Kartu 3D butuh server lokal; kalau `index.html` dibuka langsung, yang muncul versi statis.

## Tech

HTML, CSS, JavaScript, [three.js](https://threejs.org) r170 (lisensi MIT, ada di `js/vendor`).
