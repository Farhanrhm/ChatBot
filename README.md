# SteamScout: Your Personal Game Curator

[![CI Test Suite](https://github.com/Farhanrhm/ChatBot/actions/workflows/ci.yml/badge.svg)](https://github.com/Farhanrhm/ChatBot/actions/workflows/ci.yml)
[![Demo](https://img.shields.io/badge/demo-online-blue)](https://chat-bot-three-gold.vercel.app/)

SteamScout adalah aplikasi web chatbot rekomendasi game PC di ekosistem Steam. Menggunakan persona kurator game berbahasa Indonesia santai khas gamer, SteamScout membantu pemain menemukan 2-3 game yang relevan berdasarkan genre, spesifikasi perangkat (laptop kentang atau PC gaming), mode bermain (single-player atau co-op), budget, dan suasana hati.

---

## Cara Kerja Singkat

Pengguna menyampaikan kriteria atau preferensi game yang dicari melalui kolom percakapan atau tombol filter cepat. Asisten kurator berbasis Google Gemini kemudian menganalisis kebutuhan tersebut dan memilihkan rekomendasi game yang paling cocok. Sebelum ditampilkan, judul game diverifikasi secara otomatis ke katalog toko Steam untuk memastikan keaslian judul, menampilkan cover art resmi, serta menyajikan informasi harga dan status diskon terkini dalam bentuk kartu rekomendasi interaktif.

---

## Antarmuka Aplikasi

### 1. Tampilan Utama Desktop
![Tampilan Utama Desktop SteamScout](./docs/screenshots/image.png)
*Navigasi sidebar, status koneksi, percakapan rekomendasi game terstruktur, dan toolbar filter preferensi.*

### 2. Drawer Modal Wishlist
![Tampilan Drawer Modal Wishlist SteamScout](./docs/screenshots/wishlist_drawer.png)
*Panel drawer wishlist tersimpan dengan focus trap keyboard, navigasi tautan toko Steam, dan tombol hapus.*

### 3. Tampilan Responsif Ponsel (Mobile)
![Tampilan Responsif Mobile SteamScout](./docs/screenshots/mobile_preview.png)
*Tata letak responsif pada viewport layar ponsel dengan target sentuh optimal dan navigasi anti-scroll.*

---

## Fitur Utama

1. **Persona Kurator Game Khusus**: Memberikan rekomendasi terstruktur (Judul, Genre/Tag, Alasan Cocok, Spek & Budget) dengan batas maksimal 2-3 game per balasan agar tidak membebani pemain. Tombol aksi mengarahkan langsung: "Buka di Steam Store" untuk game terverifikasi di katalog Steam, dan "Cari di Steam" untuk judul yang belum terverifikasi.
2. **Filter Preferensi Cepat**: Toolbar interaktif di atas kolom pesan untuk memilih spesifikasi perangkat (laptop kentang atau PC gaming), budget (gratis atau di bawah Rp100 ribu), dan mode bermain (single-player atau co-op) secara praktis.
3. **Memori Percakapan Bertingkat (Multi-turn)**: Mengingat konteks dan preferensi selama sesi obrolan berlangsung sehingga pemain dapat memperdalam atau mengubah kriteria rekomendasi secara bertahap.
4. **Saran Pencarian Cepat**: Tombol pilihan cepat untuk memulai penelusuran instan seperti Laptop kentang, Co-op santai, Menantang (Souls-like), dan Cozy.
5. **Tema Steam Dark & Tata Letak Presisi**: Palet warna autentik ekosistem Steam dengan tipografi Barlow. Tata letak terkunci rapi pada layar peramban (tanpa page scroll overflow) dan kartu game tersusun rapi secara horizontal pada layar komputer.
6. **Aksesibilitas Terpadu**: Navigasi keyboard menyeluruh dengan indikator fokus visual jelas, ukuran target sentuh ramah perangkat sentuh, kontras warna yang nyaman, serta dukungan pembaca layar (screen reader).
7. **Penyimpanan Wishlist Lokal**: Menyimpan game favorit langsung dari kartu obrolan ke penyimpanan peramban lokal tanpa akun, dilengkapi pencegahan duplikasi, sinkronisasi antar-tab, dan panel drawer interaktif dengan pengurung fokus keyboard.
8. **Ketahanan Streaming Percakapan**: Respon kurator disajikan secara mengalir (streaming) dengan perlindungan otomatis jika terjadi gangguan jaringan, menjaga teks yang telah diterima tetap terbaca di layar serta menyediakan opsi coba lagi.
9. **Deteksi Mode Offline**: Mengetahui kondisi koneksi internet secara otomatis. Saat luring, tombol pengiriman dinonaktifkan sementara dan teks pesan pengguna tetap tersimpan aman di kolom input.
10. **Storefront Grounding**: Pengecekan otomatis ke toko Steam untuk menyajikan sampul resmi game, status ketersediaan (berbayar, Free to Play, atau segera hadir), serta informasi diskon dan harga terkini.

---

## Teknologi yang Digunakan

- **Backend**: Node.js, Express.js (ES Modules)
- **Kecerdasan Buatan**: Google Gemini API via `@google/genai` SDK
- **Frontend**: Vanilla HTML5, Vanilla CSS3, dan Vanilla JavaScript modern (tanpa framework, tanpa build step)
- **Keamanan & Utilitas**: Helmet, Express Rate Limit, Dotenv
- **Pengujian**: Node.js Test Runner bawaan (`node:test`, `node:assert`), Puppeteer Core (`puppeteer-core`)
- **CI/CD**: GitHub Actions

---

## Keputusan Desain

1. **Pemisahan Preferensi dari Riwayat Percakapan**: Filter cepat dikirimkan secara terpisah di luar teks percakapan dan dirakit di sisi server, menjaga riwayat obrolan tetap bersih dari polusi teks sistem.
2. **Prioritas Utama pada Instruksi Teks Pengguna**: Jika terjadi pertentangan antara toggle filter aktif dengan instruksi spesifik yang diketik pengguna di kolom pesan, sistem memprioritaskan permintaan eksplisit pengguna.
3. **Arsitektur Frontend Tanpa Build Step**: Dibangun sepenuhnya menggunakan Vanilla HTML, CSS, dan JavaScript modern tanpa bundler atau framework, memastikan waktu muat instan, kemudahan pemeliharaan, dan transparansi kode.
4. **Isolasi Kegagalan Layanan Pihak Ketiga**: Pengayaan data toko Steam berjalan terpisah dan dibatasi anggaran waktu mandiri, sehingga gangguan pada server toko eksternal tidak menggagalkan kurasi rekomendasi utama.
5. **Ketahanan Streaming di Sisi Klien**: Pemantauan aliran data streaming diterapkan di sisi peramban untuk mendeteksi koneksi terhenti secara dini, menjaga teks yang telah diterima tetap aman, dan memberi opsi coba lagi tanpa duplikasi pesan.
6. **Pembatasan Konteks dan Sanitasi Input**: Riwayat percakapan dibatasi hingga 20 turn terakhir dan pesan pengguna dibatasi maksimal 1000 karakter guna menjaga efisiensi token, kestabilan memori, serta mencegah manipulasi payload berlebih.
7. **Perlindungan Laju Permintaan dan Keamanan Aplikasi**: Penerapan pembatasan laju permintaan (rate limiting) per alamat IP, pembatasan ukuran payload JSON, Content Security Policy (CSP) ketat via Helmet, serta pengisolasian kredensial sensitif di sisi server.

---

## Keterbatasan Sistem

- **Akurasi Rekomendasi AI**: Rekomendasi dihasilkan oleh LLM dan sewaktu-waktu dapat memuat ketidakakuratan data mengenai detail tahun rilis atau pengembang game indie tertentu.
- **Dinamika Informasi Toko Steam**: Informasi harga, diskon, dan status rilis dapat berubah sewaktu-waktu sesuai kebijakan penerbit di platform Steam. Data yang disajikan merupakan hasil pengecekan saat permintaan diproses.
- **Penyimpanan Wishlist Lokal**: Data wishlist tersimpan secara lokal di peramban (`localStorage`) perangkat pengguna dan tidak tersinkronisasi ke cloud. Data dapat terhapus jika riwayat situs dibersihkan atau saat menggunakan mode penjelajahan pribadi (Incognito).
- **Deteksi Status Jaringan**: Pemantauan status luring mengandalkan antarmuka peramban lokal, sehingga mendeteksi keterhubungan sambungan perangkat namun tidak menjamin ketersediaan akses internet penuh di tingkat penyedia layanan.
- **Pembatasan Laju pada Lingkungan Serverless**: Pengaturan rate limit dan kuota harian disimpan dalam memori proses (*in-memory*). Pada platform hosting serverless multi-instance, batasan ini bersifat per instance (*best-effort*) dan dapat ter-reset saat proses mengalami *cold start*.

---

## Rencana Pengembangan Selanjutnya

- [ ] **Pengurutan dan Pencarian Wishlist**: Menambahkan opsi pencarian instan dan pengurutan (berdasarkan tanggal ditambahkan atau abjad) di dalam drawer wishlist.
- [ ] **Perbandingan Game Berdampingan**: Fitur komparasi visual spesifikasi dan kecocokan antara dua rekomendasi game secara berdampingan di layar obrolan.
- [ ] **Riset Kelayakan Integrasi Profil Steam**: Riset kelayakan autentikasi Steam OpenID (bergantung pada ketersediaan API resmi Valve untuk memodifikasi wishlist akun pribadi).
- [ ] **Progressive Web App (PWA) Terbatas**: Penambahan web app manifest dan service worker untuk instalasi aplikasi serta caching aset statis antarmuka.

---

## Disclaimer

Proyek ini dibuat untuk tujuan edukasi dan portofolio. Aplikasi ini **tidak berafiliasi, disponsori, atau didukung secara resmi oleh Valve Corporation maupun platform Steam**. Semua nama game, merek dampaknya, dan materi berhak cipta merupakan milik pemiliknya masing-masing.

---

## Atribusi & Lisensi

- **Ikon UI**: Menggunakan ikon SVG dari [Lucide Icons](https://lucide.dev) yang dilisensikan di bawah [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE).
- **Font**: **Barlow** dan **Barlow Semi Condensed** dari [Google Fonts](https://fonts.google.com) karya Jeremy Tribby yang dilisensikan di bawah [SIL Open Font License](https://openfontlicense.org/).
- **Lisensi Proyek**: Proyek ini dilisensikan di bawah lisensi MIT.
