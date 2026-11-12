import { one, q, run, uid, nowIso, type Env } from './db'
import { hashPassword } from './auth'
import { setConfig } from './lib'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function jakartaDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function localDateTime(offsetDays: number, time: string): string {
  return `${jakartaDate(offsetDays)}T${time}`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch] as string))
}

function coverSvg(code: string, title: string, from: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <rect width="60" height="60" fill="none"/>
      <circle cx="12" cy="12" r="1.6" fill="rgba(255,255,255,.22)"/>
    </pattern>
  </defs>
  <rect width="1200" height="700" fill="url(#g)"/>
  <rect width="1200" height="700" fill="url(#p)"/>
  <circle cx="1010" cy="140" r="230" fill="rgba(255,255,255,.07)"/>
  <circle cx="1060" cy="560" r="160" fill="rgba(255,255,255,.05)"/>
  <text x="80" y="470" font-family="Inter, Helvetica, Arial, sans-serif" font-size="150" font-weight="700" fill="rgba(255,255,255,.16)">${escapeXml(code.split('-')[0])}</text>
  <text x="80" y="560" font-family="Inter, Helvetica, Arial, sans-serif" font-size="54" font-weight="600" fill="#FFFFFF">${escapeXml(title.slice(0, 34))}</text>
  <text x="80" y="612" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" font-weight="500" fill="rgba(255,255,255,.72)">${escapeXml(code)}</text>
</svg>`
}

function avatarSvg(name: string, color: string): string {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#1F2933"/></linearGradient></defs>
  <rect width="256" height="256" rx="128" fill="url(#a)"/>
  <text x="128" y="160" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="96" font-weight="600" fill="#FFFFFF">${escapeXml(initials)}</text>
</svg>`
}

async function putSvg(env: Env, entityId: string, name: string, svg: string, uploadedBy: string | null): Promise<string> {
  const id = uid('fil_')
  const objectKey = `${entityId}/seed-${id}.svg`
  await env.FILES.put(objectKey, new TextEncoder().encode(svg), {
    httpMetadata: { contentType: 'image/svg+xml' },
  })
  await run(
    env.DB,
    `INSERT INTO files (id, object_key, name, mime, size, entity_id, project_id, uploaded_by, visibility, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, objectKey, name, 'image/svg+xml', svg.length, entityId, null, uploadedBy, 'entity', nowIso(),
  )
  return id
}

type SeedUser = { key: string; email: string; name: string; role: 'MA' | 'SA' | 'PA'; entity: 'yayasan' | 'store' | null; job: string; password: string; color: string }

const USERS: SeedUser[] = [
  { key: 'master', email: 'master@xyz.co.id', name: 'Ayu Prakoso', role: 'MA', entity: null, job: 'Master Admin', password: 'Master#2026', color: '#245A46' },
  { key: 'sari', email: 'sari.admin@xyz.co.id', name: 'Sari Wulandari', role: 'SA', entity: 'yayasan', job: 'Direktur Program', password: 'Yayasan#2026', color: '#2E6B53' },
  { key: 'budi', email: 'budi.admin@xyz.co.id', name: 'Budi Santoso', role: 'SA', entity: 'store', job: 'Head of Retail', password: 'Store#2026', color: '#1F4E5F' },
  { key: 'rina', email: 'rina.pic@xyz.co.id', name: 'Rina Kartika', role: 'PA', entity: 'yayasan', job: 'Project Admin / PIC', password: 'Proyek#2026', color: '#3A7D5D' },
  { key: 'dimas', email: 'dimas.pic@xyz.co.id', name: 'Dimas Nugraha', role: 'PA', entity: 'yayasan', job: 'Project Admin / PIC', password: 'Proyek#2026', color: '#5B7C4B' },
  { key: 'siti', email: 'siti.tim@xyz.co.id', name: 'Siti Rahmawati', role: 'PA', entity: 'yayasan', job: 'Field Officer', password: 'Proyek#2026', color: '#7C6A48' },
  { key: 'dewi', email: 'dewi.pic@xyz.co.id', name: 'Dewi Lestari', role: 'PA', entity: 'store', job: 'Project Admin / PIC', password: 'Proyek#2026', color: '#2F6472' },
  { key: 'agus', email: 'agus.tim@xyz.co.id', name: 'Agus Prasetyo', role: 'PA', entity: 'store', job: 'Area Coordinator', password: 'Proyek#2026', color: '#4A6474' },
]

type SeedProject = {
  key: string
  entity: 'yayasan' | 'store'
  code: string
  title: string
  category: string
  description: string
  location: string
  status: string
  visibility: 'team' | 'entity'
  progress: number
  budget: number
  confirmed: boolean
  budgetVisibility: 'team' | 'entity'
  colors: [string, string]
  members: { user: string; access: 'admin' | 'member'; pic?: boolean }[]
  kpis: { label: string; unit: string; target: number; current: number }[]
  locations: { name: string; description: string; type: 'point' | 'line' | 'polygon'; coordinates: any; visibility?: 'team' | 'entity' }[]
  tasks: { title: string; column: number; priority: 'tinggi' | 'normal' | 'rendah'; assignee: string; due?: number; description?: string; checklist: string[]; done?: number }[]
  events: { title: string; days: number; time: string; allDay?: boolean; category: string; visibility: 'team' | 'entity'; location?: string }[]
  logbooks: { locationIndex: number; daysAgo: number; activity: string; observations: string; followUp: string; staff: string; indicators: Record<string, string>; withGps?: boolean }[]
  notes: { title: string; body: string; visibility: 'team' | 'entity' }[]
  dataFields?: { key: string; label: string }[]
  dataRows?: Record<string, string>[]
}

const PROJECTS: SeedProject[] = [
  {
    key: 'p1',
    entity: 'yayasan', code: 'YYS-001', title: 'Sekolah Binaan Ceria', category: 'Pendidikan',
    description: 'Pendampingan 12 sekolah dasar binaan di Kabupaten Bogor: pelatihan guru, perpustakaan kelas, dan beasiswa siswa berprestasi.',
    location: 'Kabupaten Bogor, Jawa Barat', status: 'Berjalan', visibility: 'team', progress: 62,
    budget: 350_000_000, confirmed: true, budgetVisibility: 'team', colors: ['#245A46', '#3E8168'],
    members: [
      { user: 'rina', access: 'admin', pic: true },
      { user: 'dimas', access: 'member' },
      { user: 'siti', access: 'member' },
      { user: 'sari', access: 'admin' },
    ],
    kpis: [
      { label: 'Sekolah Terdampingi', unit: 'sekolah', target: 12, current: 9 },
      { label: 'Guru Terlatih', unit: 'guru', target: 120, current: 84 },
      { label: 'Siswa Menerima Beasiswa', unit: 'siswa', target: 60, current: 41 },
    ],
    locations: [
      { name: 'SDN 01 Cibinong', description: 'Sekolah inti program literasi.', type: 'point', coordinates: [106.8166, -6.595] },
      { name: 'SDN 03 Leuwiliang', description: 'Perpustakaan kelas baru selesai renovasi.', type: 'point', coordinates: [106.6352, -6.5742] },
      { name: 'SDN 05 Cisarua', description: 'Lokasi pelatihan guru angkatan ketiga.', type: 'point', coordinates: [106.9336, -6.7003], visibility: 'team' },
      { name: 'SDN 02 Megamendung', description: 'Menunggu pengiriman buku paket.', type: 'point', coordinates: [106.9089, -6.6639] },
    ],
    tasks: [
      { title: 'Distribusi buku paket semester genap', column: 2, priority: 'tinggi', assignee: 'siti', due: 3, description: 'Kirim 480 buku ke 4 sekolah.', checklist: ['Konfirmasi jumlah', 'Sewa kendaraan', 'Serah terima dengan kepala sekolah'], done: 1 },
      { title: 'Pelatihan guru angkatan ketiga', column: 2, priority: 'normal', assignee: 'rina', due: 8, checklist: ['Susun modul', 'Undang 30 guru', 'Siapkan sertifikat'] },
      { title: 'Evaluasi capaian literasi siswa', column: 1, priority: 'normal', assignee: 'dimas', due: 14, checklist: ['Siapkan instrumen', 'Ambil sampel 120 siswa'] },
      { title: 'Perbaikan perpustakaan SDN 03', column: 3, priority: 'normal', assignee: 'siti', checklist: ['Rak buku terpasang', 'Karpet dipasang', 'Foto serah terima'], done: 3 },
      { title: 'Laporan triwulan program', column: 0, priority: 'rendah', assignee: 'rina', due: 21, checklist: ['Rekap logbook', 'Rekap anggaran'] },
      { title: 'Rekrut relawan mahasiswa', column: 0, priority: 'rendah', assignee: 'dimas', checklist: [] },
    ],
    events: [
      { title: 'Monitoring Lapangan SDN 03', days: 1, time: '08:00', category: 'Monitoring', visibility: 'team', location: 'Leuwiliang, Bogor' },
      { title: 'Rapat Koordinasi Guru Binaan', days: 2, time: '10:00', category: 'Rapat', visibility: 'entity', location: 'Aula Yayasan XYZ' },
      { title: 'Pelatihan Literasi Angkatan III', days: 5, time: '09:00', category: 'Pelatihan', visibility: 'team', location: 'SDN 01 Cibinong' },
    ],
    logbooks: [
      { locationIndex: 1, daysAgo: 2, activity: 'Monitoring perpustakaan', staff: 'siti', observations: 'Rak buku baru terpasang. Kunjungan siswa meningkat dari 18 menjadi 46 per hari.', followUp: 'Tambahkan 2 rak dan jadwal pustakawan relawan.', indicators: { 'Kunjungan siswa/hari': '46', 'Buku tersedia': '512' }, withGps: true },
      { locationIndex: 0, daysAgo: 9, activity: 'Pelatihan guru', staff: 'rina', observations: '28 guru hadir dari target 30. Materi asesmen diagnostik diterima baik.', followUp: 'Kirim rekaman sesi untuk guru yang berhalangan.', indicators: { 'Guru hadir': '28', 'Kepuasan': '4,6/5' } },
      { locationIndex: 3, daysAgo: 16, activity: 'Verifikasi pengiriman', staff: 'dimas', observations: 'Pengiriman 120 buku tertunda karena cuaca. Gudang sekolah kering.', followUp: 'Jadwalkan ulang pengiriman minggu depan.', indicators: { 'Buku diterima': '120' } },
    ],
    notes: [
      { title: 'Ringkasan rapat koordinasi November', body: 'Disepakati penambahan 2 sekolah binaan pada semester berikutnya. Fokus tetap literasi kelas 3–5. Anggaran perjalanan diminta direvisi setelah kenaikan tarif transportasi.', visibility: 'team' },
      { title: 'Panduan serah terima perpustakaan', body: 'Serah terima dilakukan bersama kepala sekolah dan komite. Dokumentasi minimal 6 foto: tampak depan, rak, koleksi, kegiatan siswa, papan nama, dan berita acara.', visibility: 'entity' },
    ],
    dataFields: [
      { key: 'sekolah', label: 'Sekolah' },
      { key: 'kecamatan', label: 'Kecamatan' },
      { key: 'jumlah_siswa', label: 'Jumlah Siswa' },
      { key: 'buku_tersedia', label: 'Buku Tersedia' },
      { key: 'status', label: 'Status' },
    ],
    dataRows: [
      { sekolah: 'SDN 01 Cibinong', kecamatan: 'Cibinong', jumlah_siswa: '312', buku_tersedia: '512', status: 'Aktif' },
      { sekolah: 'SDN 03 Leuwiliang', kecamatan: 'Leuwiliang', jumlah_siswa: '248', buku_tersedia: '410', status: 'Aktif' },
      { sekolah: 'SDN 05 Cisarua', kecamatan: 'Cisarua', jumlah_siswa: '196', buku_tersedia: '280', status: 'Pembinaan' },
      { sekolah: 'SDN 02 Megamendung', kecamatan: 'Megamendung', jumlah_siswa: '221', buku_tersedia: '120', status: 'Pembinaan' },
      { sekolah: 'SDN 04 Ciawi', kecamatan: 'Ciawi', jumlah_siswa: '287', buku_tersedia: '365', status: 'Aktif' },
      { sekolah: 'SDN 06 Sukaraja', kecamatan: 'Sukaraja', jumlah_siswa: '175', buku_tersedia: '198', status: 'Baru' },
    ],
  },
  {
    key: 'p2',
    entity: 'yayasan', code: 'YYS-002', title: 'Konservasi Mangrove Pesisir', category: 'Lingkungan',
    description: 'Rehabilitasi 45 hektar mangrove bersama kelompok nelayan di pesisir Demak, termasuk pembibitan dan monitoring tutupan vegetasi.',
    location: 'Demak, Jawa Tengah', status: 'Berjalan', visibility: 'entity', progress: 48,
    budget: 480_000_000, confirmed: true, budgetVisibility: 'entity', colors: ['#1E4F3E', '#2F7B62'],
    members: [
      { user: 'rina', access: 'admin', pic: true },
      { user: 'siti', access: 'member' },
      { user: 'dimas', access: 'member' },
      { user: 'sari', access: 'admin' },
    ],
    kpis: [
      { label: 'Bibit Ditanam', unit: 'bibit', target: 60000, current: 34200 },
      { label: 'Luas Ter rehabilitasi', unit: 'ha', target: 45, current: 21 },
      { label: 'Kelompok Nelayan Terlibat', unit: 'kelompok', target: 8, current: 6 },
    ],
    locations: [
      { name: 'Zona Pembibitan Bedono', description: 'Bedeng pembibitan 12.000 polybag.', type: 'point', coordinates: [110.6385, -6.8915] },
      { name: 'Blok Tanam A — Sayung', description: 'Area tanam 12 ha, monitoring bulanan.', type: 'point', coordinates: [110.5142, -6.9301] },
      { name: 'Blok Tanam B — Wedung', description: 'Area tanam 9 ha, abrasi tinggi.', type: 'point', coordinates: [110.7089, -6.8032], visibility: 'team' },
      { name: 'Area Rehabilitasi Inti', description: 'Batas area program 45 ha.', type: 'polygon', coordinates: [[[110.49, -6.95], [110.57, -6.95], [110.58, -6.90], [110.50, -6.90], [110.49, -6.95]]] },
    ],
    tasks: [
      { title: 'Penanaman 8.000 bibit gelombang III', column: 2, priority: 'tinggi', assignee: 'siti', due: 4, description: 'Libatkan 40 nelayan, mulai pukul 06.00.', checklist: ['Distribusi bibit', 'Briefing keselamatan', 'Dokumentasi drone'], done: 1 },
      { title: 'Survei tutupan mangrove', column: 1, priority: 'normal', assignee: 'dimas', due: 12, checklist: ['Siapkan transek', 'Analisis citra'] },
      { title: 'Pembayaran honor kelompok tani', column: 3, priority: 'normal', assignee: 'rina', checklist: ['Rekap absensi', 'Transfer'], done: 2 },
      { title: 'Pembersihan sampah pesisir', column: 3, priority: 'rendah', assignee: 'siti', checklist: ['Koordinasi desa'], done: 1 },
      { title: 'Laporan dampak semeter I', column: 0, priority: 'normal', assignee: 'rina', due: 25, checklist: ['Kumpulkan data', 'Draf narasi'] },
    ],
    events: [
      { title: 'Penanaman Mangrove Bersama', days: 3, time: '06:30', category: 'Monitoring', visibility: 'entity', location: 'Bedono, Demak' },
      { title: 'Rapat Evaluasi Kelompok Nelayan', days: 6, time: '13:00', category: 'Rapat', visibility: 'team', location: 'Balai Desa Bedono' },
      { title: 'Hari Konservasi Pesisir', days: 9, time: '07:00', allDay: true, category: 'Kunjungan', visibility: 'entity' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 1, activity: 'Monitoring pembibitan', staff: 'siti', observations: 'Tingkat hidup bibit 82%. Ditemukan serangan kepiting pada 3 bedeng.', followUp: 'Pasang pelindung bambu di 3 bedeng.', indicators: { 'Tingkat hidup': '82%', 'Bibit siap tanam': '4.200' }, withGps: true },
      { locationIndex: 1, daysAgo: 7, activity: 'Pengukuran tutupan', staff: 'dimas', observations: 'Tutupan naik 6,4% dibanding pengukuran sebelumnya pada blok A.', followUp: 'Lanjutkan pengukuran transek di blok B.', indicators: { 'Tutupan': '38%', 'Tinggi rata-rata': '64 cm' } },
      { locationIndex: 3, daysAgo: 20, activity: 'Survei batas area', staff: 'rina', observations: 'Batas area program sudah dipasang 14 patok. Dua patok hilang akibat abrasi.', followUp: 'Ganti patok dan koordinasi dengan desa.', indicators: { 'Patok terpasang': '14' } },
    ],
    notes: [
      { title: 'Catatan keselamatan penanaman', body: 'Seluruh peserta wajib memakai pelampung saat penanaman di zona pasang. Titik evakuasi di dermaga Bedono.', visibility: 'entity' },
      { title: 'Permintaan revisi anggaran', body: 'Kelompok nelayan meminta tambahan biaya perawatan bibit selama 3 bulan musim hujan.', visibility: 'team' },
    ],
  },
  {
    key: 'p3',
    entity: 'yayasan', code: 'YYS-003', title: 'Pemberdayaan UMKM Perempuan', category: 'Sosial Ekonomi',
    description: 'Pendampingan 40 pelaku UMKM perempuan di Sleman: pelatihan pembukuan, sertifikasi halal, dan pemasaran digital.',
    location: 'Sleman, DI Yogyakarta', status: 'Perencanaan', visibility: 'team', progress: 24,
    budget: 225_000_000, confirmed: false, budgetVisibility: 'team', colors: ['#7A5A2E', '#B08A4F'],
    members: [
      { user: 'dimas', access: 'admin', pic: true },
      { user: 'siti', access: 'member' },
      { user: 'sari', access: 'member' },
    ],
    kpis: [
      { label: 'UMKM Terdampingi', unit: 'usaha', target: 40, current: 18 },
      { label: 'Sertifikat Halal Terbit', unit: 'sertifikat', target: 15, current: 4 },
      { label: 'Omzet Rata-rata', unit: 'juta', target: 8, current: 5.4 },
    ],
    locations: [
      { name: 'Balai Latihan UMKM', description: 'Pusat pelatihan mingguan.', type: 'point', coordinates: [110.3556, -7.7167] },
      { name: 'Sentra Batik Godean', description: 'Kluster 14 perajin batik.', type: 'point', coordinates: [110.3031, -7.7831] },
      { name: 'Kios Pemasaran Bersama', description: 'Toko bersama hasil produksi.', type: 'point', coordinates: [110.3789, -7.7456] },
    ],
    tasks: [
      { title: 'Pelatihan pembukuan sederhana', column: 2, priority: 'normal', assignee: 'dimas', due: 6, checklist: ['Siapkan modul', 'Cetak buku kas'] },
      { title: 'Pendampingan sertifikasi halal', column: 1, priority: 'tinggi', assignee: 'siti', due: 10, checklist: ['Kumpulkan dokumen', 'Pendaftaran online'] },
      { title: 'Foto produk untuk katalog', column: 1, priority: 'rendah', assignee: 'dimas', checklist: ['Sewa alat'] },
      { title: 'Rapat koordinasi dinas setempat', column: 3, priority: 'normal', assignee: 'dimas', checklist: ['Siapkan bahan'], done: 1 },
      { title: 'Pembukaan kios pemasaran', column: 0, priority: 'normal', assignee: 'siti', due: 30, checklist: [] },
    ],
    events: [
      { title: 'Pelatihan Pembukuan Batch 2', days: 1, time: '09:00', category: 'Pelatihan', visibility: 'team', location: 'Balai Latihan UMKM' },
      { title: 'Pendampingan Sertifikasi Halal', days: 4, time: '13:30', category: 'Kunjungan', visibility: 'team' },
      { title: 'Pasar Rakyat Akhir Bulan', days: 12, time: '07:00', allDay: true, category: 'Kunjungan', visibility: 'entity', location: 'Alun-alun Sleman' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 3, activity: 'Pelatihan batch 1', staff: 'dimas', observations: '18 peserta hadir. Sebagian besar belum memisahkan keuangan usaha dan rumah tangga.', followUp: 'Buat template kas sederhana dan pendampingan individu.', indicators: { 'Peserta': '18', 'Pemahaman naik': '72%' } },
      { locationIndex: 1, daysAgo: 11, activity: 'Kunjungan kluster batik', staff: 'siti', observations: 'Produksi terhambat bahan baku pewarna. Kualitas motif baik.', followUp: 'Hubungkan dengan pemasok pewarna alami.', indicators: { 'Perajin aktif': '11' } },
    ],
    notes: [
      { title: 'Usulan anggaran kios', body: 'Kios pemasaran bersama membutuhkan tambahan peralatan sebesar Rp 18 juta. Anggaran belum masuk karena menunggu konfirmasi PIC.', visibility: 'team' },
    ],
  },
  {
    key: 'p4',
    entity: 'yayasan', code: 'YYS-004', title: 'Air Bersih Desa Nusa', category: 'Infrastruktur',
    description: 'Pembangunan sumur bor dan jaringan distribusi air bersih untuk 320 keluarga di Desa Nusa, Kupang.',
    location: 'Kupang, NTT', status: 'Berjalan', visibility: 'entity', progress: 71,
    budget: 610_000_000, confirmed: true, budgetVisibility: 'entity', colors: ['#1F4E5F', '#3D7E92'],
    members: [
      { user: 'dimas', access: 'admin', pic: true },
      { user: 'rina', access: 'member' },
      { user: 'sari', access: 'admin' },
    ],
    kpis: [
      { label: 'Keluarga Terlayani', unit: 'KK', target: 320, current: 214 },
      { label: 'Panjang Jaringan', unit: 'meter', target: 4800, current: 3600 },
      { label: 'Titik Kran Umum', unit: 'unit', target: 8, current: 6 },
    ],
    locations: [
      { name: 'Sumur Bor Utama', description: 'Kedalaman 86 m, debit 4,2 liter/detik.', type: 'point', coordinates: [123.607, -10.1772] },
      { name: 'Reservoir Desa', description: 'Kapasitas 20.000 liter.', type: 'point', coordinates: [123.6124, -10.1801] },
      { name: 'Jalur Pipa Utama', description: 'Jalur distribusi 3,6 km.', type: 'line', coordinates: [[123.607, -10.1772], [123.6098, -10.1795], [123.6119, -10.1812], [123.6124, -10.1801]] },
    ],
    tasks: [
      { title: 'Uji kualitas air laboratorium', column: 3, priority: 'tinggi', assignee: 'dimas', checklist: ['Ambil sampel', 'Kirim ke lab', 'Terima hasil'], done: 3 },
      { title: 'Pemasangan kran umum titik 7', column: 2, priority: 'normal', assignee: 'rina', due: 5, checklist: ['Gali jalur', 'Pasang pipa', 'Uji aliran'], done: 1 },
      { title: 'Pelatihan pengelola air desa', column: 1, priority: 'normal', assignee: 'dimas', due: 13, checklist: ['Siapkan materi'] },
      { title: 'Serah terima ke pemerintah desa', column: 0, priority: 'normal', assignee: 'rina', due: 28, checklist: ['Siapkan berita acara'] },
      { title: 'Perbaikan kebocoran jalur B', column: 2, priority: 'tinggi', assignee: 'rina', due: 2, checklist: ['Lokasi kebocoran', 'Ganti sambungan'] },
    ],
    events: [
      { title: 'Monitoring Sumur Bor', days: 2, time: '08:00', category: 'Monitoring', visibility: 'entity', location: 'Desa Nusa, Kupang' },
      { title: 'Rapat Serah Terima Tahap I', days: 7, time: '10:00', category: 'Rapat', visibility: 'entity' },
      { title: 'Pemeriksaan Kualitas Air', days: 4, time: '09:00', category: 'Monitoring', visibility: 'team' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 5, activity: 'Monitoring debit sumur', staff: 'dimas', observations: 'Debit stabil 4,2 liter/detik. Kandungan besi masih di bawah ambang batas.', followUp: 'Uji ulang pada musim kemarau.', indicators: { 'Debit': '4,2 l/s', 'TDS': '312 ppm' }, withGps: true },
      { locationIndex: 2, daysAgo: 13, activity: 'Inspeksi jalur pipa', staff: 'rina', observations: 'Dua titik kebocoran pada km 2,4 dan km 3,1. Tekanan di ujung jalur rendah.', followUp: 'Perbaikan sambungan dan tambah satu kran udara.', indicators: { 'Kebocoran': '2 titik' } },
    ],
    notes: [
      { title: 'Berita acara uji air', body: 'Hasil uji laboratorium menyatakan air layak konsumsi setelah perebusan. Salinan dokumen disimpan pada arsip proyek.', visibility: 'entity' },
    ],
  },
  {
    key: 's1',
    entity: 'store', code: 'STR-001', title: 'Renovasi Cabang Bandung', category: 'Operasional',
    description: 'Renovasi menyeluruh cabang Bandung: tata ulang layout, pendingin ruangan, dan area pelanggan.',
    location: 'Bandung, Jawa Barat', status: 'Berjalan', visibility: 'team', progress: 55,
    budget: 890_000_000, confirmed: true, budgetVisibility: 'team', colors: ['#1F4E5F', '#2F7387'],
    members: [
      { user: 'dewi', access: 'admin', pic: true },
      { user: 'agus', access: 'member' },
      { user: 'budi', access: 'admin' },
    ],
    kpis: [
      { label: 'Progres Fisik', unit: '%', target: 100, current: 55 },
      { label: 'Hari Keterlambatan', unit: 'hari', target: 0, current: 3 },
    ],
    locations: [
      { name: 'Cabang Bandung — Dago', description: 'Lokasi renovasi utama, 420 m².', type: 'point', coordinates: [107.6191, -6.9175] },
      { name: 'Gudang Sementara', description: 'Penyimpanan stok selama renovasi.', type: 'point', coordinates: [107.6305, -6.9335], visibility: 'team' },
    ],
    tasks: [
      { title: 'Pemasangan AC 4 unit', column: 2, priority: 'tinggi', assignee: 'agus', due: 3, checklist: ['Pengiriman unit', 'Instalasi', 'Uji suhu'], done: 1 },
      { title: 'Finishing lantai area pelanggan', column: 2, priority: 'normal', assignee: 'agus', due: 7, checklist: ['Perapihan', 'Pembersihan'] },
      { title: 'Audit stok gudang sementara', column: 1, priority: 'normal', assignee: 'dewi', due: 6, checklist: ['Stock opname', 'Rekonsiliasi sistem'] },
      { title: 'Kontrak vendor interior', column: 3, priority: 'normal', assignee: 'dewi', checklist: ['Negosiasi', 'Tanda tangan'], done: 2 },
      { title: 'Grand opening plan', column: 0, priority: 'rendah', assignee: 'dewi', due: 24, checklist: [] },
    ],
    events: [
      { title: 'Inspeksi Progres Renovasi', days: 1, time: '09:00', category: 'Monitoring', visibility: 'team', location: 'Cabang Dago, Bandung' },
      { title: 'Rapat Vendor Interior', days: 3, time: '14:00', category: 'Rapat', visibility: 'team' },
      { title: 'Target Uji Coba Operasional', days: 10, time: '08:00', allDay: true, category: 'Kunjungan', visibility: 'entity' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 2, activity: 'Inspeksi progres', staff: 'dewi', observations: 'Pekerjaan plafon selesai 90%, lantai belum difinishing. Ada keterlambatan pengiriman AC 2 hari.', followUp: 'Eskalasi ke vendor AC dan minta jadwal ulang.', indicators: { 'Progres': '55%', 'Keterlambatan': '3 hari' }, withGps: true },
      { locationIndex: 1, daysAgo: 8, activity: 'Audit stok sementara', staff: 'agus', observations: 'Selisih stok 6 unit pada kategori aksesori, sudah direkonsiliasi.', followUp: 'Perketat pencatatan keluar-masuk gudang.', indicators: { 'Selisih': '6 unit' } },
    ],
    notes: [
      { title: 'Catatan keselamatan kerja vendor', body: 'Vendor wajib menyertakan JSA dan APD lengkap. Pekerjaan berisik hanya boleh setelah jam tutup toko.', visibility: 'team' },
    ],
    dataFields: [
      { key: 'item', label: 'Item Pekerjaan' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'nilai', label: 'Nilai (Rp)' },
      { key: 'status', label: 'Status' },
    ],
    dataRows: [
      { item: 'Plafon dan pencahayaan', vendor: 'CV Cahaya Interior', nilai: '185000000', status: 'Selesai' },
      { item: 'Lantai area pelanggan', vendor: 'PT Lantai Nusantara', nilai: '142000000', status: 'Berjalan' },
      { item: 'Instalasi AC', vendor: 'CV Sejuk Abadi', nilai: '168000000', status: 'Berjalan' },
      { item: 'Rak display', vendor: 'CV Cahaya Interior', nilai: '96000000', status: 'Selesai' },
      { item: 'Signage eksterior', vendor: 'PT Reklame Jaya', nilai: '74000000', status: 'Menunggu' },
    ],
  },
  {
    key: 's2',
    entity: 'store', code: 'STR-002', title: 'Program Loyalitas Pelanggan', category: 'Pemasaran',
    description: 'Peluncuran program loyalitas berbasis poin di 18 cabang, terintegrasi dengan aplikasi kasir.',
    location: 'Nasional', status: 'Berjalan', visibility: 'entity', progress: 38,
    budget: 320_000_000, confirmed: false, budgetVisibility: 'entity', colors: ['#4A3A6B', '#6E5A96'],
    members: [
      { user: 'dewi', access: 'admin', pic: true },
      { user: 'agus', access: 'member' },
      { user: 'budi', access: 'admin' },
    ],
    kpis: [
      { label: 'Member Terdaftar', unit: 'member', target: 12000, current: 4300 },
      { label: 'Cabang Aktif', unit: 'cabang', target: 18, current: 9 },
      { label: 'Transaksi Ulang', unit: '%', target: 35, current: 22 },
    ],
    locations: [
      { name: 'Cabang Jakarta Pusat', description: 'Pilot project program loyalitas.', type: 'point', coordinates: [106.8456, -6.2088] },
      { name: 'Cabang Surabaya Timur', description: 'Gelombang kedua.', type: 'point', coordinates: [112.7521, -7.2575] },
      { name: 'Cabang Medan', description: 'Gelombang kedua.', type: 'point', coordinates: [98.6722, 3.5952] },
    ],
    tasks: [
      { title: 'Integrasi poin ke aplikasi kasir', column: 2, priority: 'tinggi', assignee: 'agus', due: 9, checklist: ['Uji di 2 cabang', 'Perbaiki bug'] },
      { title: 'Kampanye media sosial', column: 2, priority: 'normal', assignee: 'dewi', due: 5, checklist: ['Desain materi', 'Jadwal posting'], done: 1 },
      { title: 'Pelatihan kasir gelombang 2', column: 1, priority: 'normal', assignee: 'agus', due: 15, checklist: ['Modul', 'Jadwal 9 cabang'] },
      { title: 'Evaluasi pilot Jakarta', column: 3, priority: 'normal', assignee: 'dewi', checklist: ['Analisis data 4 minggu'], done: 1 },
      { title: 'Pengadaan hadiah loyalitas', column: 0, priority: 'rendah', assignee: 'dewi', checklist: [] },
    ],
    events: [
      { title: 'Kick-off Kampanye Loyalitas', days: 2, time: '11:00', category: 'Rapat', visibility: 'entity' },
      { title: 'Pelatihan Kasir Gelombang 2', days: 6, time: '09:00', category: 'Pelatihan', visibility: 'team' },
      { title: 'Evaluasi Pilot Program', days: 8, time: '15:00', category: 'Rapat', visibility: 'team' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 4, activity: 'Evaluasi pilot', staff: 'dewi', observations: 'Pendaftaran member 1.240 dalam 4 minggu. Kendala utama antrean di kasir saat jam sibuk.', followUp: 'Tambah mode pendaftaran cepat di kasir.', indicators: { 'Member baru': '1.240', 'Waktu transaksi': '68 detik' } },
      { locationIndex: 1, daysAgo: 10, activity: 'Sosialisasi kasir', staff: 'agus', observations: '9 kasir terlatih. Pemahaman sistem poin baik.', followUp: 'Buat kartu panduan singkat di meja kasir.', indicators: { 'Kasir terlatih': '9' } },
    ],
    notes: [
      { title: 'Rencana komunikasi pelanggan', body: 'Kampanye menggunakan kombinasi email, WhatsApp broadcast, dan poster cabang. Hindari diskon besar pada bulan pertama untuk menjaga margin.', visibility: 'entity' },
    ],
  },
  {
    key: 's3',
    entity: 'store', code: 'STR-003', title: 'Gudang Distribusi Surabaya', category: 'Logistik',
    description: 'Pembangunan gudang distribusi regional timur seluas 1.800 m² dengan sistem inventori terpusat.',
    location: 'Surabaya, Jawa Timur', status: 'Berjalan', visibility: 'team', progress: 64,
    budget: 1_250_000_000, confirmed: true, budgetVisibility: 'team', colors: ['#3C4E45', '#5D766A'],
    members: [
      { user: 'agus', access: 'admin', pic: true },
      { user: 'dewi', access: 'member' },
      { user: 'budi', access: 'admin' },
    ],
    kpis: [
      { label: 'Progres Konstruksi', unit: '%', target: 100, current: 64 },
      { label: 'Kapasitas Palet', unit: 'palet', target: 900, current: 0 },
    ],
    locations: [
      { name: 'Lahan Gudang Rungkut', description: 'Lahan 1.800 m², akses tol langsung.', type: 'point', coordinates: [112.7521, -7.2575] },
      { name: 'Rute Distribusi Utama', description: 'Rute gudang ke 12 cabang regional timur.', type: 'line', coordinates: [[112.7521, -7.2575], [112.6, -7.35], [112.45, -7.45], [112.3, -7.55]] },
      { name: 'Area Bongkar Muat', description: '4 dok bongkar muat.', type: 'polygon', coordinates: [[[112.7505, -7.2575], [112.7537, -7.2575], [112.7537, -7.2592], [112.7505, -7.2592], [112.7505, -7.2575]]] },
    ],
    tasks: [
      { title: 'Instalasi rak gudang blok A', column: 2, priority: 'tinggi', assignee: 'agus', due: 4, checklist: ['Pengiriman rak', 'Perakitan', 'Uji beban'], done: 1 },
      { title: 'Uji sistem inventori WMS', column: 1, priority: 'tinggi', assignee: 'agus', due: 16, checklist: ['Konfigurasi', 'Uji transfer stok'] },
      { title: 'Rekrut 6 staf gudang', column: 2, priority: 'normal', assignee: 'dewi', due: 11, checklist: ['Iklan lowongan', 'Seleksi', 'Kontrak'], done: 1 },
      { title: 'Izin operasional gudang', column: 3, priority: 'tinggi', assignee: 'dewi', checklist: ['Dokumen', 'Verifikasi lapangan'], done: 1 },
      { title: 'Serah terima konstruksi', column: 0, priority: 'normal', assignee: 'agus', due: 30, checklist: [] },
    ],
    events: [
      { title: 'Monitoring Konstruksi Gudang', days: 2, time: '08:30', category: 'Monitoring', visibility: 'team', location: 'Rungkut, Surabaya' },
      { title: 'Rapat Integrasi WMS', days: 5, time: '10:00', category: 'Rapat', visibility: 'team' },
      { title: 'Soft Opening Gudang', days: 20, time: '09:00', allDay: true, category: 'Kunjungan', visibility: 'entity' },
    ],
    logbooks: [
      { locationIndex: 0, daysAgo: 3, activity: 'Inspeksi konstruksi', staff: 'agus', observations: 'Struktur baja selesai. Lantai beton menunggu curing 5 hari. Drainase perlu perbaikan kecil.', followUp: 'Perbaiki drainase sebelum musim hujan.', indicators: { 'Progres': '64%', 'Temuan': '2' }, withGps: true },
    ],
    notes: [
      { title: 'Rencana operasional gudang', body: 'Gudang akan melayani 12 cabang dengan 2 shift. Target awal 600 palet per bulan.', visibility: 'team' },
    ],
  },
]

export async function ensureSeed(env: Env) {
  const existing = await one<any>(env.DB, `SELECT value FROM app_config WHERE key = 'seed:v1'`)
  if (existing) return
  try {
    await run(env.DB, `INSERT INTO app_config (key, value, updated_at) VALUES ('seed:v1', 'running', ?)`, nowIso())
  } catch {
    return // another isolate is already seeding
  }
  try {
    await seedAll(env)
    await setConfig(env, 'seed:v1', { at: nowIso(), version: 1 })
  } catch (err) {
    await run(env.DB, `DELETE FROM app_config WHERE key = 'seed:v1'`)
    throw err
  }
}

async function seedAll(env: Env) {
  // Entities
  const entityIds: Record<string, string> = {}
  const entities = [
    { key: 'yayasan', name: 'Yayasan XYZ', tagline: 'Pendidikan, lingkungan, dan pemberdayaan masyarakat.', description: 'Portal program yayasan: pemantauan sekolah binaan, konservasi, dan pemberdayaan komunitas di seluruh wilayah kerja.', order: 0 },
    { key: 'store', name: 'XYZ Store', tagline: 'Produk lokal, operasional yang rapi.', description: 'Portal unit usaha: pemantauan cabang, gudang, dan program loyalitas pelanggan dengan data operasional yang akurat.', order: 1 },
  ]
  for (const e of entities) {
    const id = `ent_${e.key}`
    entityIds[e.key] = id
    await run(
      env.DB,
      `INSERT OR IGNORE INTO entities (id, key, name, tagline, description, sort_order) VALUES (?,?,?,?,?,?)`,
      id, e.key, e.name, e.tagline, e.description, e.order,
    )
  }

  // Users (hashed in parallel)
  const userIds: Record<string, string> = {}
  const hashes = await Promise.all(USERS.map((u) => hashPassword(u.password)))
  for (const [index, u] of USERS.entries()) {
    const id = `usr_${u.key}`
    userIds[u.key] = id
    const { hash, salt } = hashes[index]
    await run(
      env.DB,
      `INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, name, role, entity_id, job_title, phone, is_active, must_change_password, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,0,?)`,
      id, u.email, hash, salt, u.name, u.role, u.entity ? entityIds[u.entity] : null, u.job,
      '0812' + String(10000000 + index * 1111), nowIso(),
    )
  }

  // Avatars
  const avatarIds: Record<string, string> = {}
  for (const u of USERS) {
    const entityKey = u.entity ?? 'yayasan'
    avatarIds[u.key] = await putSvg(env, entityIds[entityKey], `avatar-${u.key}.svg`, avatarSvg(u.name, u.color), userIds[u.key])
    await run(env.DB, `UPDATE users SET avatar_id = ? WHERE id = ?`, avatarIds[u.key], userIds[u.key])
  }

  // Event categories per entity
  const categoryIds: Record<string, Record<string, string>> = { yayasan: {}, store: {} }
  const categories = [
    { name: 'Monitoring', color: '#245A46' },
    { name: 'Rapat', color: '#2F6F8F' },
    { name: 'Pelatihan', color: '#B7791F' },
    { name: 'Kunjungan', color: '#7C5CBF' },
    { name: 'Libur Nasional', color: '#B4453C' },
  ]
  for (const entityKey of ['yayasan', 'store']) {
    for (const cat of categories) {
      const id = uid('cat_')
      categoryIds[entityKey][cat.name] = id
      await run(env.DB, `INSERT INTO event_categories (id, entity_id, name, color) VALUES (?,?,?,?)`, id, entityIds[entityKey], cat.name, cat.color)
    }
  }

  // Projects
  for (const p of PROJECTS) {
    const projectId = `prj_${p.key}`
    const entityId = entityIds[p.entity]
    const createdBy = userIds[p.entity === 'yayasan' ? 'sari' : 'budi']
    const createdAt = new Date(Date.now() - 60 * 86400_000).toISOString()
    await run(
      env.DB,
      `INSERT INTO projects (id, entity_id, code, title, category, description, location_text, cover_id, progress, status,
        start_date, end_date, visibility, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      projectId, entityId, p.code, p.title, p.category, p.description, p.location, null, p.progress, p.status,
      jakartaDate(-120), jakartaDate(120), p.visibility, createdBy, createdAt, nowIso(),
    )
    const coverId = await putSvg(env, entityId, `cover-${p.key}.svg`, coverSvg(p.code, p.title, p.colors[0], p.colors[1]), createdBy)
    await run(env.DB, `UPDATE projects SET cover_id = ? WHERE id = ?`, coverId, projectId)
    await run(env.DB, `UPDATE files SET project_id = ? WHERE id = ?`, projectId, coverId)

    for (const m of p.members) {
      await run(
        env.DB,
        `INSERT INTO project_members (id, project_id, user_id, access, is_primary_pic, added_by, created_at) VALUES (?,?,?,?,?,?,?)`,
        uid('pmm_'), projectId, userIds[m.user], m.access, m.pic ? 1 : 0, createdBy, createdAt,
      )
    }
    for (const [i, kpi] of p.kpis.entries()) {
      await run(
        env.DB,
        `INSERT INTO project_kpis (id, project_id, label, unit, target_value, current_value, position) VALUES (?,?,?,?,?,?,?)`,
        uid('kpi_'), projectId, kpi.label, kpi.unit, kpi.target, kpi.current, i,
      )
    }
    await run(
      env.DB,
      `INSERT INTO budgets (project_id, amount, is_confirmed, visibility, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
      projectId, p.budget, p.confirmed ? 1 : 0, p.budgetVisibility, createdBy, nowIso(),
    )
    await run(
      env.DB,
      `INSERT INTO budget_history (id, project_id, amount, is_confirmed, visibility, note, changed_by, changed_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      uid('bhx_'), projectId, p.budget, p.confirmed ? 1 : 0, p.budgetVisibility,
      p.confirmed ? 'Penetapan anggaran awal (terkonfirmasi)' : 'Usulan anggaran, menunggu konfirmasi', createdBy,
      new Date(Date.now() - 30 * 86400_000).toISOString(),
    )

    // Boards & tasks
    const columnNames = ['Backlog', 'Rencana', 'Sedang Berjalan', 'Selesai']
    const boardIds: string[] = []
    for (const [i, name] of columnNames.entries()) {
      const boardId = uid('brd_')
      boardIds.push(boardId)
      await run(
        env.DB,
        `INSERT INTO boards (id, project_id, name, position, is_done) VALUES (?,?,?,?,?)`,
        boardId, projectId, name, i, i === columnNames.length - 1 ? 1 : 0,
      )
    }
    for (const [i, t] of p.tasks.entries()) {
      const taskId = uid('tsk_')
      await run(
        env.DB,
        `INSERT INTO tasks (id, project_id, board_id, title, description, priority, due_date, assignee_id, position,
          created_by, created_at, updated_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        taskId, projectId, boardIds[t.column], t.title, t.description ?? null, t.priority,
        t.due !== undefined ? jakartaDate(t.due) : null, userIds[t.assignee], i * 1000,
        userIds[p.members[0].user], createdAt, nowIso(), t.column === 3 ? nowIso() : null,
      )
      for (const [ci, text] of t.checklist.entries()) {
        await run(
          env.DB,
          `INSERT INTO task_checklist (id, task_id, text, is_done, position) VALUES (?,?,?,?,?)`,
          uid('chk_'), taskId, text, ci < (t.done ?? 0) ? 1 : 0, ci,
        )
      }
    }

    // Locations
    const locationIds: string[] = []
    for (const loc of p.locations) {
      const id = uid('loc_')
      locationIds.push(id)
      const coords = loc.type === 'point' ? loc.coordinates : null
      await run(
        env.DB,
        `INSERT INTO locations (id, entity_id, project_id, name, description, type, geojson, lon, lat, visibility, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, entityId, projectId, loc.name, loc.description, loc.type,
        JSON.stringify({ type: loc.type === 'point' ? 'Point' : loc.type === 'line' ? 'LineString' : 'Polygon', coordinates: loc.coordinates }),
        coords ? coords[0] : null, coords ? coords[1] : null,
        loc.visibility ?? p.visibility, createdBy, createdAt,
      )
    }

    // Logbooks
    for (const [i, lb] of p.logbooks.entries()) {
      const logbookId = uid('lgb_')
      const locId = locationIds[lb.locationIndex]
      const locCoords = p.locations[lb.locationIndex]?.coordinates
      const gps = lb.withGps && Array.isArray(locCoords) ? locCoords : null
      await run(
        env.DB,
        `INSERT INTO logbooks (id, project_id, location_id, visit_date, visit_time, staff_id, activity_type,
          observations, indicators, follow_up, gps_lat, gps_lng, visibility, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        logbookId, projectId, locId, jakartaDate(-lb.daysAgo), ['08:00', '10:30', '13:00', '15:30'][i % 4],
        userIds[lb.staff], lb.activity, lb.observations, JSON.stringify(lb.indicators), lb.followUp,
        gps ? gps[1] : null, gps ? gps[0] : null,
        p.visibility === 'entity' ? 'entity' : 'team', userIds[lb.staff],
        new Date(Date.now() - lb.daysAgo * 86400_000).toISOString(),
      )
    }

    // Notes
    for (const n of p.notes) {
      await run(
        env.DB,
        `INSERT INTO notes (id, project_id, title, body, visibility, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        uid('not_'), projectId, n.title, n.body, n.visibility, createdBy,
        new Date(Date.now() - 12 * 86400_000).toISOString(), new Date(Date.now() - 4 * 86400_000).toISOString(),
      )
    }

    // Data fields & records
    if (p.dataFields?.length) {
      for (const [i, f] of p.dataFields.entries()) {
        await run(
          env.DB,
          `INSERT INTO data_fields (id, project_id, key, label, type, position, sensitive) VALUES (?,?,?,?,?,?,0)`,
          uid('fld_'), projectId, f.key, f.label, 'text', i,
        )
      }
      for (const row of p.dataRows ?? []) {
        await run(
          env.DB,
          `INSERT INTO data_records (id, project_id, data, visibility, row_source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
          uid('rec_'), projectId, JSON.stringify(row), p.visibility, 'seed', createdBy, createdAt, nowIso(),
        )
      }
    }

    // Events
    for (const ev of p.events) {
      await run(
        env.DB,
        `INSERT INTO events (id, entity_id, project_id, title, description, start_local, end_local, all_day,
          category_id, visibility, location, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid('evt_'), entityId, projectId, ev.title, null,
        localDateTime(ev.days, ev.time),
        localDateTime(ev.days, ev.allDay ? '23:59' : ev.time),
        ev.allDay ? 1 : 0,
        categoryIds[p.entity][ev.category] ?? null, ev.visibility, ev.location ?? p.location,
        createdBy, nowIso(),
      )
    }
  }

  // Entity-level events (no project)
  const entityEvents = [
    { entity: 'yayasan', title: 'Rapat Pleno Pengurus Yayasan', days: 4, time: '09:00', cat: 'Rapat', visibility: 'entity', location: 'Ruang Rapat Yayasan XYZ', desc: 'Agenda: laporan program triwulan dan rencana anggaran tahun berikutnya.' },
    { entity: 'yayasan', title: 'Buka Puasa Bersama Relawan', days: 14, time: '17:00', cat: 'Kunjungan', visibility: 'entity', location: 'Aula Yayasan XYZ', desc: 'Undangan terbuka untuk seluruh relawan program.' },
    { entity: 'store', title: 'Rapat Regional Manajer', days: 3, time: '10:00', cat: 'Rapat', visibility: 'entity', location: 'Kantor Pusat XYZ Store', desc: 'Review performa cabang bulanan.' },
    { entity: 'store', title: 'Pelatihan Service Excellence', days: 9, time: '09:00', cat: 'Pelatihan', visibility: 'entity', location: 'Training Center XYZ Store', desc: 'Untuk supervisor cabang regional barat.' },
  ]
  for (const ev of entityEvents) {
    await run(
      env.DB,
      `INSERT INTO events (id, entity_id, project_id, title, description, start_local, end_local, all_day,
        category_id, visibility, location, created_by, created_at)
       VALUES (?,?,NULL,?,?,?,?,0,?,?,?,?,?)`,
      uid('evt_'), entityIds[ev.entity], ev.title, ev.desc,
      localDateTime(ev.days, ev.time), localDateTime(ev.days, ev.time),
      categoryIds[ev.entity][ev.cat] ?? null, ev.visibility, ev.location,
      userIds[ev.entity === 'yayasan' ? 'sari' : 'budi'], nowIso(),
    )
  }

  // Indonesian national holidays (2026, editable reference data)
  const holidays2026 = [
    ['2026-01-01', 'Tahun Baru 2026 Masehi'],
    ['2026-01-16', 'Isra Mikraj Nabi Muhammad SAW'],
    ['2026-02-17', 'Tahun Baru Imlek 2577'],
    ['2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka 1948)'],
    ['2026-03-20', 'Hari Raya Idul Fitri 1447 H'],
    ['2026-03-21', 'Hari Raya Idul Fitri 1447 H (Hari Kedua)'],
    ['2026-04-03', 'Wafat Isa Al Masih'],
    ['2026-05-01', 'Hari Buruh Internasional'],
    ['2026-05-14', 'Kenaikan Isa Al Masih'],
    ['2026-05-27', 'Hari Raya Idul Adha 1447 H'],
    ['2026-06-01', 'Hari Lahir Pancasila'],
    ['2026-06-16', 'Tahun Baru Islam 1448 H'],
    ['2026-08-17', 'Hari Kemerdekaan Republik Indonesia'],
    ['2026-08-25', 'Maulid Nabi Muhammad SAW'],
    ['2026-12-25', 'Hari Raya Natal'],
  ]
  for (const [date, name] of holidays2026) {
    await run(env.DB, `INSERT OR IGNORE INTO holidays (date, name, source) VALUES (?,?,?)`, date, name, 'verified')
  }

  // Notifications for demo accounts
  const notificationSeeds = [
    { user: 'rina', type: 'project.assigned', title: 'Anda ditunjuk sebagai PIC utama', body: 'Sekolah Binaan Ceria (YYS-001)', link: '/app/projects/prj_p1', project: 'prj_p1', entity: 'yayasan' },
    { user: 'rina', type: 'task.assigned', title: 'Tugas baru untuk Anda', body: 'Pelatihan guru angkatan ketiga — Sekolah Binaan Ceria', link: '/app/projects/prj_p1?tab=kanban', project: 'prj_p1', entity: 'yayasan' },
    { user: 'dimas', type: 'project.pic', title: 'Anda ditunjuk sebagai PIC utama', body: 'Air Bersih Desa Nusa (YYS-004)', link: '/app/projects/prj_p4', project: 'prj_p4', entity: 'yayasan' },
    { user: 'siti', type: 'task.assigned', title: 'Tugas baru untuk Anda', body: 'Distribusi buku paket semester genap — Sekolah Binaan Ceria', link: '/app/projects/prj_p1?tab=kanban', project: 'prj_p1', entity: 'yayasan' },
    { user: 'dewi', type: 'budget.updated', title: 'Anggaran proyek diperbarui', body: 'Renovasi Cabang Bandung', link: '/app/projects/prj_s1?tab=budget', project: 'prj_s1', entity: 'store' },
    { user: 'agus', type: 'calendar.created', title: 'Agenda baru ditambahkan', body: 'Monitoring Konstruksi Gudang', link: '/app/calendar', project: 'prj_s3', entity: 'store' },
    { user: 'sari', type: 'calendar.created', title: 'Agenda baru ditambahkan', body: 'Rapat Pleno Pengurus Yayasan', link: '/app/calendar', project: null, entity: 'yayasan' },
    { user: 'budi', type: 'project.assigned', title: 'Anda ditambahkan ke proyek', body: 'Gudang Distribusi Surabaya (STR-003)', link: '/app/projects/prj_s3', project: 'prj_s3', entity: 'store' },
  ]
  for (const n of notificationSeeds) {
    await run(
      env.DB,
      `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, project_id, dedupe_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('ntf_'), userIds[n.user], n.type, n.title, n.body, n.link,
      entityIds[n.entity], n.project, `seed:${n.user}:${n.type}:${n.project ?? 'entity'}`, nowIso(),
    )
  }

  // Audit log demo entries
  const auditSeeds = [
    { actor: 'sari', entity: 'yayasan', action: 'project.created', summary: 'Membuat proyek Sekolah Binaan Ceria (YYS-001)' },
    { actor: 'budi', entity: 'store', action: 'project.created', summary: 'Membuat proyek Gudang Distribusi Surabaya (STR-003)' },
    { actor: 'rina', entity: 'yayasan', action: 'logbook.created', summary: 'Mencatat logbook monitoring pembibitan pada Konservasi Mangrove Pesisir' },
    { actor: 'dewi', entity: 'store', action: 'budget.updated', summary: 'Memperbarui anggaran Renovasi Cabang Bandung: Rp890.000.000 (pasti)' },
    { actor: 'master', entity: null, action: 'user.invited', summary: 'Mengundang Siti Rahmawati sebagai PA (Yayasan XYZ)' },
    { actor: 'agus', entity: 'store', action: 'task.moved', summary: 'Memindahkan tugas "Instalasi rak gudang blok A" ke kolom Sedang Berjalan' },
  ]
  for (const [i, a] of auditSeeds.entries()) {
    const u = USERS.find((x) => x.key === a.actor)!
    await run(
      env.DB,
      `INSERT INTO audit_log (id, actor_id, actor_name, entity_id, action, target_type, target_id, summary, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      uid('aud_'), userIds[a.actor], u.name, a.entity ? entityIds[a.entity] : null, a.action, 'demo', null, a.summary,
      new Date(Date.now() - (i + 1) * 3 * 3600_000).toISOString(),
    )
  }
}

export const DEMO_ACCOUNTS = USERS.map((u) => ({
  email: u.email,
  password: u.password,
  role: u.role,
  name: u.name,
  entity: u.entity,
}))
