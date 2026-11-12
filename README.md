# XYZ Project Hub

Hub pemantauan proyek untuk **Yayasan XYZ** dan **XYZ Store** dalam satu aplikasi, dengan dua portal terpisah, hak akses berjenjang (MA / SA / PA), peta GIS nyata, Kanban, kalender, logbook lapangan, dan anggaran yang bisa diaudit.

Antarmuka berbahasa Indonesia, zona waktu **Asia/Jakarta**, mata uang **IDR**.

---

## 1. Ringkasan fitur

| Area | Yang tersedia |
| --- | --- |
| **Landing** | Dua kartu organisasi fotografi (foto bisa diganti dari editor branding), hero, ringkasan kapabilitas, footer. |
| **Autentikasi** | Undangan saja (tanpa pendaftaran mandiri), login email + kata sandi, sesi 14 hari di cookie HttpOnly, pembatasan percobaan login, audit login. |
| **Home** | KPI nyata (proyek aktif, anggota tim, lokasi terpetakan, logbook, tugas selesai, anggaran pasti), grafik progres per proyek, komposisi status, Agenda Terdekat 7 hari, aktivitas terbaru. |
| **Katalog proyek** | Kartu dengan sampul, kode, kategori, lokasi, PIC, tim, progres, status, visibilitas. CRUD, arsip, hapus lunak, filter/pencarian. |
| **Ruang kerja proyek** | 8 tab: Dashboard, Kanban, Peta, Tabel Data, Catatan, Logbook, Anggaran, Pengaturan. |
| **Kanban** | Drag-and-drop sungguhan (pointer events, mendukung sentuh dengan tahan ±0,25 dtk), kolom CRUD + urutan, kartu CRUD, urutan dalam kolom persisten, checklist dengan progres, komentar, lampiran, prioritas, tenggat, assignee. Fallback **Pindahkan tahap** di detail tugas. |
| **Peta GIS** | Leaflet + tile OpenStreetMap berlisensi, marker cluster, popup, foto, garis & poligon, impor KML/GeoJSON/koordinat dengan pratinjau + validasi, riwayat monitoring per lokasi, peta proyek dan peta entitas. |
| **Kalender** | Tampilan Hari / Minggu / Bulan / Tahun, agenda tampil di dalam sel tanggal (`08.00 Monitoring Lapangan`), `+N lagi`, kategori & warna kustom, filter proyek, agenda khusus tim vs entitas, hari libur opsional, satu kalender per entitas. |
| **Tabel data** | Kolom kustom, pencarian/filter/urut, edit sel, impor CSV/XLS/XLSX (pilih sheet, pratinjau, pemetaan kolom, validasi, dedupe, Append/Update/Skip), ekspor CSV, riwayat impor, sinkronisasi Google Sheets manual dengan pratinjau konflik. |
| **Logbook** | Entri ramah ponsel: proyek, lokasi, tanggal, staf, aktivitas, observasi, indikator kustom, foto, GPS, tindak lanjut. Riwayat tetap utuh saat anggota dikeluarkan. |
| **Anggaran** | Nominal anggaran + centang **Anggaran Sudah Pasti**. Nominal belum pasti tersimpan tetapi tidak dihitung pada total resmi/grafik. Perubahan nominal pasti memerlukan konfirmasi ulang, lengkap dengan riwayat perubahan. |
| **Notifikasi** | Persisten, terdeduplikasi, belum/sudah dibaca, preferensi, tautan langsung ke objek. |
| **Administrasi** | Undang pengguna (manual & impor CSV/XLS/XLSX dengan pratinjau), atur peran/entitas, nonaktifkan, editor branding (global + per entitas), audit log. |
| **Privasi** | `Khusus Tim` / `Entitas` untuk proyek, anggaran, agenda, data, peta, catatan, logbook, lampiran. Visibilitas ≠ hak edit — keduanya ditegakkan di server. |
| **Responsif** | Navigasi bawah untuk ponsel, grid KPI 2 kolom, Kanban geser + tahan, kalender agenda, sheet peta, unggah kamera, notifikasi, profil. |

---

## 2. Tumpukan teknologi

- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, React Router 7, Leaflet + markercluster, SheetJS (`xlsx`), Lucide.
- **Backend**: Hono di Cloudflare Workers (`server/`), Cloudflare **D1** (SQLite) untuk data, **R2** untuk berkas (sampul, avatar, foto logbook, lampiran).
- **Auth**: kata sandi PBKDF2-SHA256 (120.000 iterasi, WebCrypto), token sesi acak 32 byte yang **di-hash** sebelum disimpan di D1.
- **Grafik**: SVG buatan sendiri (tanpa dependensi chart), sehingga bundle tetap ringan.

```
server/            API Hono: index, schema, seed, auth, scope, routes/*
src/               SPA React
  components/      UI kit, layout, chart, kanban, calendar, map, import wizard
  pages/           Landing, Login, Home, Projects, Workspace, Locations, Calendar, Admin, Profile
  pages/tabs/      Dashboard, Kanban, Peta, Data, Catatan, Logbook, Anggaran, Pengaturan
  lib/             api client, app context, format WIB/IDR, tipe, parser geo
scripts/api-test.sh  71 pemeriksaan backend (end-to-end lewat HTTP)
```

### Model peran

- **MA (Master Admin)** — akses ke kedua entitas, mengelola pengguna, branding global dan branding tiap entitas.
- **SA (Super Admin entitas)** — hanya entitasnya sendiri; mengelola anggota dan branding entitas.
- **PA (Pengguna/Anggota)** — hanya proyek tempat ia ditugaskan.

**PIC** dan **anggota tim** adalah posisi di dalam proyek, bukan peran aplikasi. Setiap proyek punya tepat satu PIC utama; menggantinya membutuhkan konfirmasi.

---

## 3. Menjalankan secara lokal

Prasyarat: Node.js 20+ (atau Bun), `npm`/`bun`.

```bash
bun install          # atau: npm install

# Terminal 1 — API + D1 + R2 lokal (port 8787)
npm run dev:api

# Terminal 2 — antarmuka (port 3000, proxy /api ke 8787)
npm run dev
```

Buka <http://localhost:3000>.

Skema D1 dan **data demo** dibuat otomatis saat permintaan pertama ke API (`server/schema.ts` + `server/seed.ts`, dijaga penanda `app_config.seed:v1`). Tidak perlu menjalankan SQL manual.

Ingin mulai dari nol? Hentikan `dev:api`, hapus `.wrangler/state`, lalu jalankan lagi.

Perintah lain:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # bundel SPA + Worker (dist/, dist-server/)
bash scripts/api-test.sh http://127.0.0.1:8787   # 71 pemeriksaan backend
```

---

## 4. Akun demo

Kata sandi mengikuti pola di bawah; semuanya fiktif.

| Peran | Email | Kata sandi | Cakupan |
| --- | --- | --- | --- |
| MA | `master@xyz.co.id` | `Master#2026` | Kedua entitas |
| SA Yayasan | `sari.admin@xyz.co.id` | `Yayasan#2026` | Yayasan XYZ |
| SA Store | `budi.admin@xyz.co.id` | `Store#2026` | XYZ Store |
| PA / PIC | `rina.pic@xyz.co.id` | `Proyek#2026` | PIC Sekolah Binaan Ceria, anggota beberapa proyek |
| PA / PIC | `dimas.pic@xyz.co.id` | `Proyek#2026` | PIC proyek air bersih |
| PA / PIC | `dewi.pic@xyz.co.id` | `Proyek#2026` | PIC proyek UMKM & mangrove |
| PA / Tim | `siti.tim@xyz.co.id` | `Proyek#2026` | Anggota tim |
| PA / Tim | `agus.tim@xyz.co.id` | `Proyek#2026` | Anggota tim |

Data demo mencakup 7 proyek (4 Yayasan, 3 Store), 22 lokasi GIS, 14 agenda November 2026, hari libur, logbook, anggaran (termasuk satu yang belum pasti), catatan, tabel data, notifikasi, dan riwayat audit.

---

## 5. Keamanan & privasi

- Otorisasi ditegakkan di server untuk **setiap** endpoint: `requireRole`, `requireEntityAccess`, `requireProjectAccess`, dan filter `scope` pada query.
- Visibilitas `Khusus Tim` difilter di SQL, bukan di klien, sehingga tidak bisa dibocorkan lewat API, ekspor, grafik, atau notifikasi.
- Mutasi mewajibkan `Origin`/`Referer` sama dengan host (proteksi CSRF) dan cookie `SameSite=Lax` + `HttpOnly`.
- Berkas R2 hanya disajikan lewat `/api/files/:id` yang memeriksa hak akses; tidak ada URL publik permanen.
- Semua aksi penting dicatat di audit log (aktor, aksi, objek, waktu, detail perubahan).

---

## 6. Hasil pengujian

**Backend — 71/71 lulus** (`bash scripts/api-test.sh`, dijalankan pada database yang baru di-seed):

- Login/peran: MA dua entitas, SA terkurung entitasnya, PA tanpa penugasan tidak melihat proyek.
- Isolasi entitas pada proyek, peta, agenda, dan tabel data.
- CRUD proyek + unggah sampul, konfirmasi penggantian PIC (409 → 200 setelah konfirmasi).
- Kanban: pindah kartu persisten, checklist berubah 1/2 → 2/2 **tanpa** memindahkan kolom kartu induk.
- Kalender: buat agenda, tanggal benar, agenda khusus tim tidak terlihat oleh non-anggota.
- Anggaran: perubahan nominal pasti menuntut konfirmasi ulang (409), total resmi mengecualikan nominal belum pasti (Rp 1.440.000.000).
- Notifikasi terdeduplikasi dan bisa ditandai dibaca.
- Impor data: Append lalu Update, nilai tersimpan, riwayat impor tercatat.
- GIS: impor titik + poligon, visibilitas, penolakan akses peta proyek lain (403).
- Logbook dengan foto.
- Pencabutan akses anggota: akses hilang, logbook historis tetap ada.

**Antarmuka — diperiksa di peramban sungguhan** (Chromium, preview cloud):

- Landing menampilkan foto Unsplash dan dua kartu organisasi; login MA berhasil.
- Home: KPI, grafik, Agenda Terdekat dari data nyata.
- Katalog proyek: 4 kartu Yayasan dengan sampul termuat (10/10 gambar).
- Kanban: kartu ditarik dengan mouse ke kolom lain, status berubah, dan **tetap** setelah halaman dimuat ulang.
- Peta: 9 tile OpenStreetMap termuat, 4 cluster marker, atribusi tampil.
- Kalender: sel tanggal menampilkan `08.00 Monitoring Lapangan SDN 03`, beberapa agenda per hari, `+4 lagi`.
- Semua 8 tab ruang kerja merender tanpa error.
- Ponsel 390×844: navigasi bawah aktif, tanpa overflow horizontal.

Tangkapan layar: `artifacts/home-desktop.png`, `home-mobile.png`, `projects.png`, `kanban.png`, `map.png`, `calendar-grid.png`.

**Belum diuji otomatis**: unggah kamera di perangkat asli, drag sentuh di perangkat fisik, ekspor CSV ke Excel, dan semua alur yang membutuhkan akun Google (lihat bagian 8).

---

## 7. Menerbitkan ke Cloudflare

Aplikasi sudah siap sebagai Worker + aset statis (Sites/Workers):

1. `npm run build`
2. Buat resource: `wrangler d1 create xyz-hub` dan `wrangler r2 bucket create xyz-hub-files`.
3. Isi `database_id` hasil langkah 2 ke `wrangler.jsonc` (menggantikan `local-dev`).
4. `wrangler deploy`.
5. Buka aplikasi sekali — skema dan data demo dibuat otomatis pada permintaan pertama.
6. Ganti `APP_ENV` menjadi `production` dan **ganti kata sandi akun demo** sebelum dipakai sungguhan.

---

## 8. Integrasi yang belum selesai

1. **Google Sheets untuk spreadsheet privat** — pratinjau dan "Sync Now" sudah berfungsi untuk sheet yang dipublikasikan/dapat dibaca publik. Sheet privat memerlukan OAuth service account milik organisasi; kredensialnya belum ada, jadi belum diaktifkan.
2. **Pengingat terjadwal** — belum ada cron/queue eksternal. Pengingat agenda saat ini dibuat saat pengguna membuka aplikasi (deduplikasi + preferensi sudah siap), bukan oleh penjadwal latar belakang.
3. **Notifikasi email/WhatsApp** — hanya notifikasi dalam aplikasi; belum ada penyedia email yang terpasang.
4. **Penerbitan produksi** — belum dideploy ke domain publik; langkahnya tersedia di bagian 7.
5. **Pemindaian berkas** — unggahan divalidasi tipe dan ukuran, tetapi belum ada antivirus/AV scanning.
6. **Reset kata sandi mandiri** — saat ini hanya lewat undangan/administrator.
