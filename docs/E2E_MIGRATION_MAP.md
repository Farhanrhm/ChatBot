# Peta Migrasi E2E SobatSteam: Inventarisasi Skrip Pengujian Lama

Dokumen ini memetakan seluruh skenario pengujian E2E lawas (skrip pengujian layout dan behavior lama), baseline eksekusi saat ini, kontrak streaming API, integrasi jaringan eksternal, penanganan server lokal, serta analisis risiko untuk persiapan migrasi ke Playwright Test.

---

## 1. Hasil Baseline Pengujian Saat Ini

Pengujian baseline dijalankan pada lingkungan lokal sebelum proses migrasi:

1. **`npm test` (Unit Test Suite)**
   - Perintah: `node --test`
   - Total tes: 153 subtes
   - Hasil: **PASS (153 lolos, 0 gagal)**
   - Durasi: ~5.35 detik

2. **Verifikasi Perilaku DOM & Aksesibilitas Lama**
   - Lingkup: Pengujian fungsionalitas DOM dan aksesibilitas
   - Total skenario: 35 skenario
   - Hasil: **FAIL (34 lolos, 1 gagal)**
   - Skenario gagal: Skenario 31 (`Riwayat obrolan multi-sesi IndexedDB mendukung pembuatan, perpindahan, dan pemulihan konteks pesan (Modul P4)`)
   - Penyebab kegagalan: Halaman pengujian `pageHistory` memicu event submit form yang melakukan pemanggilan `fetch("/api/chat/stream")` dan fallback `fetch("/api/chat")`. Karena runner pengujian hanya menjalankan server HTTP statis di port 3589 tanpa intersep request `/api/*`, request menghasilkan HTTP 404 Not Found dan jeda waktu 600ms tidak cukup untuk sinkronisasi IndexedDB, sehingga sesi tidak tersimpan di riwayat.

3. **Verifikasi Layout & Regresi Visual Lama**
   - Lingkup: Pengujian tata letak dan regresi visual
   - Total viewport: 5 viewport (`1366x768`, `1024x575`, `1920x1080`, `375x667`, `412x915`)
   - Total perbandingan visual snapshot: 20 skenario visual (4 kondisi per viewport)
   - Hasil: **PASS (5/5 viewport lolos metrik layout, 20/20 skenario visual dengan mismatch <= 1.5%)**

---

## 2. Inventarisasi Skenario Pengujian

### A. Tabel Skenario Pengujian Layout Lama

Skrip ini memverifikasi aturan layout presisi (termasuk kepatuhan 0px page scroll overflow) dan regresi visual piksel (toleransi mismatch <= 1.5%) di 5 viewport pengujian.

| Nomor | Nama Skenario Lama | Apa yang Di-assert | Request Jaringan yang Dipakai |
|---|---|---|---|
| L01 | Layout Awal & Metrik Viewport Desktop `1366x768` | - 0px page scroll overflow (`docScrollH <= winH + 1`, `bodyScrollH <= winH + 1`)<br>- 0px horizontal overflow (`docScrollW <= winW + 1`)<br>- Composer menempel di dasar layar (`composer.bottom == winH`)<br>- Rail sidebar membentang penuh ke dasar layar | Request statis lokal (port 3588) |
| L02 | Chat Height Ratio & Toolbar Kolaps `1366x768` | - Rasio tinggi area chat >= 60% terhadap viewport<br>- 0px page scroll overflow saat toolbar filter dikolaps<br>- Composer tetap menempel di dasar layar | Intersep `/api/chat/stream` & `/api/chat` (stub: `visualFixtures.chatRecommendation`), intersep Steam CDN (stub: dummy 1x1 PNG) |
| L03 | Wishlist Drawer Layout `1366x768` | - 0px vertical dan horizontal page scroll overflow saat drawer terbuka<br>- Toolbar wishlist, kotak search, dan dropdown sort terlihat<br>- Area daftar item memadai (tinggi >= 200px) | Data fixture lokal 12 item (`visualFixtures.wishlistItems`) disuntikkan ke `localStorage` |
| L04 | Modal Komparasi Game `1366x768` | - 0px page scroll overflow saat modal terbuka<br>- Kontainer `.app` mendapatkan atribut `inert`<br>- Dialog `#comparison-dialog` terlihat dan memiliki internal scroll | Data kartu disuntikkan ke DOM via fixture, stub intersep API dan gambar Steam |
| L05 | Regresi Visual Default Chat `1366x768` | Pixel mismatch <= 1.5% terhadap baseline `layout_default_1366x768.png` | Intersep API chat & Steam CDN |
| L06 | Regresi Visual Wishlist Drawer `1366x768` | Pixel mismatch <= 1.5% terhadap baseline `layout_drawer_open_1366x768.png` | Fixture lokal 12 item wishlist |
| L07 | Regresi Visual Komparasi Normal `1366x768` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_1366x768.png` | Intersep API chat & Steam CDN |
| L08 | Regresi Visual Komparasi Data Saver `1366x768` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_datasaver_1366x768.png` saat mode hemat data aktif | Mode hemat data aktif via `setDataSaverMode(true)`, intersep CDN |
| L09 | Layout Awal & Metrik Viewport Desktop `1024x575` | 0px page scroll overflow, 0px horizontal overflow, composer menempel dasar, sidebar membentang penuh | Request statis lokal (port 3588) |
| L10 | Chat Ratio & Toolbar Kolaps `1024x575` | Rasio tinggi chat >= 60%, 0px vertical overflow | Intersep API chat & Steam CDN |
| L11 | Wishlist Drawer Layout `1024x575` | 0px page overflow, kontrol toolbar terlihat, tinggi daftar item >= 200px | Fixture lokal 12 item wishlist |
| L12 | Modal Komparasi Game `1024x575` | 0px page overflow, atribut `inert` aktif pada `.app`, dialog terlihat | Stub intersep API dan gambar Steam |
| L13 | Regresi Visual Default Chat `1024x575` | Pixel mismatch <= 1.5% terhadap baseline `layout_default_1024x575.png` | Intersep API chat & Steam CDN |
| L14 | Regresi Visual Wishlist Drawer `1024x575` | Pixel mismatch <= 1.5% terhadap baseline `layout_drawer_open_1024x575.png` | Fixture lokal 12 item wishlist |
| L15 | Regresi Visual Komparasi Normal `1024x575` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_1024x575.png` | Intersep API chat & Steam CDN |
| L16 | Regresi Visual Komparasi Data Saver `1024x575` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_datasaver_1024x575.png` | Mode hemat data aktif, intersep CDN |
| L17 | Layout Awal & Metrik Viewport Desktop `1920x1080` | 0px page scroll overflow, 0px horizontal overflow, composer menempel dasar, sidebar membentang penuh | Request statis lokal (port 3588) |
| L18 | Chat Ratio & Toolbar Kolaps `1920x1080` | Rasio tinggi chat >= 60%, 0px vertical overflow | Intersep API chat & Steam CDN |
| L19 | Wishlist Drawer Layout `1920x1080` | 0px page overflow, kontrol toolbar terlihat, tinggi daftar item >= 200px | Fixture lokal 12 item wishlist |
| L20 | Modal Komparasi Game `1920x1080` | 0px page overflow, atribut `inert` aktif pada `.app`, dialog terlihat | Stub intersep API dan gambar Steam |
| L21 | Regresi Visual Default Chat `1920x1080` | Pixel mismatch <= 1.5% terhadap baseline `layout_default_1920x1080.png` | Intersep API chat & Steam CDN |
| L22 | Regresi Visual Wishlist Drawer `1920x1080` | Pixel mismatch <= 1.5% terhadap baseline `layout_drawer_open_1920x1080.png` | Fixture lokal 12 item wishlist |
| L23 | Regresi Visual Komparasi Normal `1920x1080` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_1920x1080.png` | Intersep API chat & Steam CDN |
| L24 | Regresi Visual Komparasi Data Saver `1920x1080` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_datasaver_1920x1080.png` | Mode hemat data aktif, intersep CDN |
| L25 | Layout Awal & Metrik Viewport Mobile `375x667` | 0px page scroll overflow, 0px horizontal overflow, composer menempel dasar (tanpa sidebar rail desktop) | Request statis lokal (port 3588) |
| L26 | Chat Ratio & Toolbar Kolaps `375x667` | Rasio tinggi chat >= 60%, 0px vertical overflow | Intersep API chat & Steam CDN |
| L27 | Wishlist Drawer Layout `375x667` | 0px page overflow, kontrol toolbar terlihat, tinggi daftar item >= 150px (mobile) | Fixture lokal 12 item wishlist |
| L28 | Modal Komparasi Mobile & Tab Switch `375x667` | 0px page overflow, atribut `inert` aktif, tab switching responsif (klik Tab B menyembunyikan Col A dan menampilkan Col B; klik Tab A mengembalikan Col A) | Stub intersep API dan gambar Steam |
| L29 | Regresi Visual Default Chat `375x667` | Pixel mismatch <= 1.5% terhadap baseline `layout_default_375x667.png` | Intersep API chat & Steam CDN |
| L30 | Regresi Visual Wishlist Drawer `375x667` | Pixel mismatch <= 1.5% terhadap baseline `layout_drawer_open_375x667.png` | Fixture lokal 12 item wishlist |
| L31 | Regresi Visual Komparasi Normal `375x667` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_375x667.png` | Intersep API chat & Steam CDN |
| L32 | Regresi Visual Komparasi Data Saver `375x667` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_datasaver_375x667.png` | Mode hemat data aktif, intersep CDN |
| L33 | Layout Awal & Metrik Viewport Mobile `412x915` | 0px page scroll overflow, 0px horizontal overflow, composer menempel dasar | Request statis lokal (port 3588) |
| L34 | Chat Ratio & Toolbar Kolaps `412x915` | Rasio tinggi chat >= 60%, 0px vertical overflow | Intersep API chat & Steam CDN |
| L35 | Wishlist Drawer Layout `412x915` | 0px page overflow, kontrol toolbar terlihat, tinggi daftar item >= 150px | Fixture lokal 12 item wishlist |
| L36 | Modal Komparasi Mobile & Tab Switch `412x915` | 0px page overflow, atribut `inert` aktif, tab switching responsif | Stub intersep API dan gambar Steam |
| L37 | Regresi Visual Default Chat `412x915` | Pixel mismatch <= 1.5% terhadap baseline `layout_default_412x915.png` | Intersep API chat & Steam CDN |
| L38 | Regresi Visual Wishlist Drawer `412x915` | Pixel mismatch <= 1.5% terhadap baseline `layout_drawer_open_412x915.png` | Fixture lokal 12 item wishlist |
| L39 | Regresi Visual Komparasi Normal `412x915` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_412x915.png` | Intersep API chat & Steam CDN |
| L40 | Regresi Visual Komparasi Data Saver `412x915` | Pixel mismatch <= 1.5% terhadap baseline `layout_comparison_datasaver_412x915.png` | Mode hemat data aktif, intersep CDN |

---

### B. Tabel Skenario Pengujian Behavior Lama

Skrip ini memverifikasi fungsionalitas interaktif, aksesibilitas keyboard dan pembaca layar, ketahanan jaringan, serta integritas state antarmuka.

| Nomor | Nama Skenario Lama | Apa yang Di-assert | Request Jaringan yang Dipakai |
|---|---|---|---|
| B01 | Tab B menerima update item dari Tab A | Tab B secara reaktif memperbarui `#wishlist-badge` menjadi '1' via event storage lintas tab tanpa reload | Request file statis lokal (port 3589) |
| B02 | Tab A menerima update dari Tab B tanpa kehilangan data awal | Tab A menerima update item kedua (badge = '2'), item lama (Terraria) tidak terhapus | Request file statis lokal (port 3589) |
| B03 | Mode offline menonaktifkan tombol Kirim dan menjaga teks input | Tombol `#send-btn` disabled dan memiliki `aria-disabled="true"`, `#offline-banner` tampil, nilai teks input terjaga utuh | Request file statis lokal (port 3589), event browser `offline` |
| B04 | Kembali online mengaktifkan kontrol dan teks input tetap utuh | Tombol `#send-btn` kembali aktif, `#offline-banner` tersembunyi, nilai teks input tetap utuh | Request file statis lokal (port 3589), event browser `online` |
| B05 | Region live mengumumkan penambahan game dan aria-pressed sinkron | `#live-announcer` memuat teks 'ditambahkan ke wishlist', atribut `aria-pressed` tombol beralih menjadi 'true' | Request file statis lokal (port 3589), injeksi kartu DOM |
| B06 | Region live mengumumkan penghapusan game dan aria-pressed sinkron | `#live-announcer` memuat teks 'dihapus dari wishlist', atribut `aria-pressed` tombol beralih menjadi 'false' | Request file statis lokal (port 3589) |
| B07 | Focus trap saat drawer kosong (menahan fokus dan kembali ke tombol pembuka via Esc) | Fokus awal pada `#wishlist-close-btn`, siklus navigasi Tab berputar di tombol tutup, menekan Escape menutup drawer dan mengembalikan fokus ke `#wishlist-btn` | Request file statis lokal (port 3589) |
| B08 | Focus trap saat drawer terisi item mengurung navigasi di dalam panel | Navigasi Tab berputar di elemen interaktif dalam panel drawer, Escape menutup drawer dan memulihkan fokus ke tombol pemicu | Request file statis lokal (port 3589) |
| B09 | Mengetik pada input memfilter kartu tanpa kehilangan fokus dan tanpa pergantian node DOM | Fokus tetap berada di `#wishlist-search`, referensi node input identik (tidak di-re-render ulang), daftar item terfilter tepat menyisakan 'Hollow Knight' | Request file statis lokal (port 3589) |
| B10 | Dropdown sort mengurutkan kartu secara deterministik (latest, oldest, alpha-asc) | Pengurutan kartu wishlist menghasilkan urutan judul yang tepat sesuai kriteria sort yang dipilih | Request file statis lokal (port 3589) |
| B11 | Sinkronisasi multi-tab mempertahankan query pencarian dan pilihan sort yang sedang aktif | Saat tab lain menambah game, tab aktif tetap mempertahankan nilai filter pencarian dan opsi sort yang sedang berjalan | Request file statis lokal (port 3589) |
| B12 | Hapus item terfilter menghapus game yang tepat (berdasarkan appId, bukan indeks) dan memindahkan fokus secara aman | Menghapus game pada daftar terfilter menghapus game yang benar di `localStorage` berdasarkan `appId`, memindahkan fokus ke item berikutnya/sebelumnya, atau ke input pencarian jika kosong | Request file statis lokal (port 3589) |
| B13 | Live region mengumumkan jumlah game secara tepat (debounce 400ms, dan tidak mengumumkan saat drawer dibuka) | Region live tidak mengumumkan apa pun saat drawer dibuka; ter-debounce 400ms saat mengetik hingga menghasilkan pengumuman 'Menampilkan 3 dari 3 game' | Request file statis lokal (port 3589) |
| B14 | Focus trap tetap menahan navigasi keyboard di dalam drawer saat hasil filter kosong | Tab dan Shift+Tab tetap mengurung fokus di dalam kontainer drawer meskipun daftar kartu hasil pencarian kosong | Request file statis lokal (port 3589) |
| B15 | Penyisipan teks empty state terhindar dari interpretasi tag HTML / XSS (textContent murni) | Payload HTML/XSS `<img src=x onerror=...>` tidak dieksekusi, tidak ada tag image baru, dan teks ditampilkan sebagai teks polos | Request file statis lokal (port 3589) |
| B16 | Watchdog sebelum token pertama: stream macet fallback otomatis ke POST /api/chat | Saat koneksi `/api/chat/stream` menggantung sebelum chunk pertama tiba, watchdog membatalkan stream dan otomatis fallback ke `POST /api/chat` (1 kali) | Intersep request: `/api/chat/stream` (hung tanpa respons), `/api/chat` (stub JSON 200) |
| B17 | Watchdog di tengah stream: pertahankan teks parsial, larang fallback diam-diam, sediakan tombol Coba lagi | Saat stream macet setelah intro tampil, teks parsial dipertahankan di DOM, fallback otomatis diam-diam dicegah, dan notifikasi koneksi terputus dengan tombol '.btn-retry-stream' ditampilkan | Intersep request: `/api/chat/stream` (chunk 1 dikirim, lalu hung), `/api/chat` (diverifikasi tidak terpanggil) |
| B18 | Tombol Coba lagi tidak menambah pesan user ganda | Mengklik tombol '.btn-retry-stream' memicu pengiriman stream baru tanpa menduplikasi baris pesan pengguna di riwayat | Intersep request: `/api/chat/stream` (menangani retry) |
| B19 | Seleksi 1 game memunculkan floating bar dengan instruksi memilih 1 game lagi | Floating bar `#comparison-bar` tampil, tombol '#comparison-open-btn' dinonaktifkan, tombol komparasi kartu aktif | Request file statis lokal (port 3589), injeksi kartu DOM |
| B20 | Seleksi 2 game mengaktifkan tombol Bandingkan Sekarang | Floating bar menampilkan teks '2 game siap dibandingkan', tombol '#comparison-open-btn' aktif | Request file statis lokal (port 3589) |
| B21 | Penolakan seleksi lebih dari 2 game memicu toast batasan (Mutasi M1) | Menyeleksi game ke-3 ditolak (`aria-pressed="false"`), toast batasan '.wishlist-toast' tampil dengan pesan batas kuota | Request file statis lokal (port 3589) |
| B22 | Membuka modal komparasi mengaktifkan atribut inert pada latar belakang dan fokus pada tombol tutup (Mutasi M2) | Elemen kontainer latar `.app` mendapatkan atribut `inert`, dialog `#comparison-dialog` tampil, fokus mendarat pada `#comparison-close-btn` | Request file statis lokal (port 3589) |
| B23 | Focus trap mengurung navigasi Tab di dalam modal komparasi | Navigasi Tab dan Shift+Tab tertahan di dalam elemen interaktif dialog komparasi (wrap-around) | Request file statis lokal (port 3589) |
| B24 | Sinkronisasi dua arah wishlist dari modal komparasi memperbarui state kartu chat dan drawer (Mutasi M5) | Toggle wishlist dari dalam modal komparasi memperbarui kartu chat di luar modal, badge header, dan data di `localStorage` | Request file statis lokal (port 3589) |
| B25 | Penekanan tombol Escape menutup modal dan memulihkan fokus pemicu | Escape menutup modal, menghapus atribut `inert` dari `.app`, dan mengembalikan fokus ke `#comparison-open-btn` | Request file statis lokal (port 3589) |
| B26 | Reset obrolan mengosongkan seleksi komparasi dan menyembunyikan floating bar (Mutasi M3) | Menekan tombol reset obrolan mengosongkan state komparasi, menyembunyikan floating bar, dan menutup dialog | Request file statis lokal (port 3589), mock dialog konfirmasi |
| B27 | Tombol ekspor JSON, salin teks, dan impor JSON telah dikurangi dari antarmuka drawer wishlist | Elemen `#wishlist-export-btn`, `#wishlist-copy-btn`, `#wishlist-import-btn`, dan `.wishlist-footer` tidak ada dalam DOM antarmuka | Request file statis lokal (port 3589) |
| B28 | Drawer wishlist menampilkan pembaruan game tersimpan secara dinamis dan rapi | Item baru di `localStorage` langsung ter-render (3 game), badge wishlist = '3', indikator drawer = '(3/50)' | Request file statis lokal (port 3589) |
| B29 | Quick filter chips genre menyaring game wishlist secara dinamis dan responsif (Modul P2) | Filter chip genre menyaring kartu game yang sesuai genre aktif dan opsi 'Semua' mereset kembali seluruh kartu | Request file statis lokal (port 3589) |
| B30 | PWA & deteksi status offline menonaktifkan komposer teks dan memunculkan banner (Modul P3) | `manifest.json` terverifikasi valid, banner offline muncul saat koneksi terputus, komposer dinonaktifkan dan pulih saat online | Request file statis lokal (port 3589) + baca berkas `manifest.json` |
| B31 | Riwayat obrolan multi-sesi IndexedDB mendukung pembuatan, perpindahan, dan pemulihan konteks pesan (Modul P4) | Pembuatan sesi obrolan baru bersih, penulisan pesan memperbarui judul sesi di sidebar, pergantian sesi memulihkan riwayat pesan | Request asli `POST /api/chat/stream` dan `/api/chat` ke port 3589 (**Gagal di baseline karena 404 pada static server**) |
| B32 | Fitur Ubah Nama Sesi, Tombol Salin Pesan, dan Skeleton Loader berfungsi sesuai spesifikasi | Pengubahan nama sesi via prompt berhasil, tombol salin pesan bot memicu clipboard dan label feedback, skeleton loader memiliki elemen kerangka | Request file statis lokal (port 3589), mock clipboard API |
| B33 | Mode Hemat Data: Tombol toggle memperbarui role switch, aria-checked, kelas body, dan live-announcer | Tombol beralih status role `switch`, atribut `aria-checked`, kelas `data-saver-active` di body, dan status di `localStorage` | Request file statis lokal (port 3589) |
| B34 | Mode Hemat Data: Verifikasi level jaringan tepat 0 request HTTP ke CDN Steam saat mode aktif | Saat Data Saver aktif, cover game dirender via SVG placeholder dan tepat 0 request HTTP keluar ke CDN Steam | Intersep request ke domain `steamstatic.com|akamaihd.net` |
| B35 | Mode Hemat Data: Request gambar Steam CDN kembali diizinkan saat mode hemat data dinonaktifkan | Saat Data Saver dinonaktifkan, tag image asli dirender dan request ke CDN Steam kembali diizinkan (> 0 request) | Intersep request ke domain `steamstatic.com|akamaihd.net` |

---

## 3. Spesifikasi Kontrak Streaming `/api/chat` & `/api/chat/stream`

### A. Format Respons Server-Sent Events (SSE)

Endpoint streaming utama berada di `POST /api/chat/stream` dengan header respons:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

Struktur chunk yang dikirimkan oleh server:
1. **Incremental Text Chunk (selama inferensi berlangsung):**
   ```text
   data: {"chunk":"{\"intro\": \"Game santai yang cocok untukmu:\"}"}\n\n
   ```
2. **Done Chunk (saat inferensi dan pengayaan Steam selesai):**
   ```text
   data: {"done":true,"data":{"intro":"...","games":[...],"followUp":"..."},"result":"..."}\n\n
   ```
3. **Error Chunk (jika terjadi kesalahan setelah header SSE terkirim):**
   - Format Bad Request (HTTP 400):
     ```text
     data: {"success":false,"error":{"code":"BAD_REQUEST","message":"...","details":null},"meta":{"timestamp":"..."}}\n\n
     ```
   - Format Server Error (HTTP 500):
     ```text
     data: {"success":false,"error":{"code":"INTERNAL_SERVER_ERROR","message":"Terjadi kesalahan saat memproses streaming rekomendasi.","details":null},"meta":{"timestamp":"..."}}\n\n
     ```
4. **Error HTTP Reguler (jika error terjadi SEBELUM header SSE terkirim):**
   - Mengembalikan respons JSON standar melalui utilitas `sendApiError`:
     ```json
     {
       "success": false,
       "error": {
         "code": "RATE_LIMIT_EXCEEDED",
         "message": "Terlalu banyak permintaan dalam waktu singkat. Mohon tunggu sebentar sebelum mengirim pesan lagi.",
         "details": null
       },
       "meta": {
         "timestamp": "2026-11-18T12:00:00.000Z"
       }
     }
     ```

### B. Mekanisme Parsing di `public/script.js`

1. Klien membaca stream respons menggunakan `fetch("/api/chat/stream")` dengan pembacaan stream `res.body.getReader()` dan `TextDecoder("utf-8")`.
2. Potongan buffer dipecah berdasarkan delimiter ganda `\n\n`.
3. Baris diawali `data: ` dipotong 6 karakter pertama lalu di-parse via `JSON.parse`.
4. Jika payload memuat properti `chunk`:
   - Teks diakumulasikan ke `streamAccumulatedText`.
   - Fungsi `extractPartialText` mengekstrak teks pembuka intro menggunakan regex:
     ```javascript
     const match = trimmed.match(/"intro"\s*:\s*"((?:\\.|[^"\\])*)/);
     ```
   - Jika intro berhasil diekstrak, indikator pengetikan dihapus, kontainer pesan bot parsial dibuat, dan teks pembuka dirender bertahap ke dalam `<p class="bot-intro">`.
5. Jika payload memuat `done: true` dan `data`:
   - Data akhir disimpan ke variabel `finalData`.
   - Menandai flag `streamSuccess = true`.
   - Konten kartu game lengkap dirender ke antarmuka pengguna.

### C. Penanganan Error & Gangguan Jaringan oleh Klien

1. **Penanganan Error HTTP 429 (Rate Limit / Daily Cap):**
   - Jika status HTTP respons streaming tidak `ok` (misalnya 429), blok pembacaan stream dilewati (`streamSuccess` tetap `false`).
   - Karena belum ada teks parsial yang tampil, klien otomatis mencoba fallback satu kali ke `POST /api/chat`.
   - Respons `POST /api/chat` menerima status 429 dari middleware Express, membaca pesan error ramah dari server, melempar exception, dan fungsi `addError` menampilkan bubble pesan error di dalam obrolan.
2. **Penanganan Error Server (500, 502, 503, 504):**
   - Jika error terjadi sebelum stream berjalan: fallback ke `POST /api/chat`. Jika fallback juga mengembalikan status error, pesan kesalahan server ditampilkan via `addError`.
   - Jika error terjadi di tengah stream (setelah intro parsial muncul di DOM): klien tidak melakukan fallback diam-diam (untuk mencegah penimpaan konten), melainkan mempertahankan intro parsial dan menambahkan banner `.stream-disconnected-notice` beserta tombol Coba lagi (`.btn-retry-stream`).
3. **Penanganan Stream Terputus (Watchdog Timeout):**
   - Dilengkapi dua batas waktu watchdog pengawas:
     - `STREAM_FIRST_CHUNK_TIMEOUT_MS`: 45.000 ms (batas waktu menunggu chunk pertama).
     - `STREAM_INTER_CHUNK_TIMEOUT_MS`: 20.000 ms (batas waktu jeda antar-chunk).
   - **Kasus 1: Macet SEBELUM token pertama tiba:**
     Watchdog membatalkan sinyal request streaming (`streamController.abort("watchdog_timeout")`), lalu secara otomatis mengeksekusi fallback 1 kali ke endpoint `POST /api/chat`.
   - **Kasus 2: Macet DI TENGAH streaming (setelah token intro tampil):**
     Watchdog membatalkan stream, mempertahankan teks intro parsial yang sudah ada di layar, melarang pemanggilan fallback diam-diam, menampilkan notifikasi `.stream-disconnected-notice`, serta menyediakan tombol `.btn-retry-stream` ("Coba lagi").
   - **Kasus 3: Pengguna menekan tombol "Coba lagi":**
     Klien menghapus baris pesan bot yang terputus dan memanggil ulang fungsi `requestReply(true)` tanpa menduplikasi baris pesan pengguna yang sudah ada di riwayat percakapan.

---

## 4. Inventarisasi Permintaan Jaringan Keluar (External Requests)

Berikut daftar seluruh request jaringan keluar dari origin aplikasi (`localhost`) yang dilakukan frontend dan penanganannya pada skrip pengujian lawas:

| Domain / URL Tujuan | Konteks Penggunaan di Frontend | Penanganan pada Skrip Layout Lama | Penanganan pada Skrip Behavior Lama | Rekomendasi di Playwright |
|---|---|---|---|---|
| `https://store.steampowered.com/app/{appId}/` | Link navigasi tab baru pada tombol kartu game ("Buka di Steam Store") dan link item wishlist | Hanya diperiksa atribut `href`-nya; link tidak pernah diklik sehingga tidak ada request HTTP asli | Hanya diperiksa atribut `href`-nya; link tidak pernah diklik sehingga tidak ada request HTTP asli | Cukup assert atribut `href` dan `target="_blank"`, jangan lakukan navigasi langsung |
| `https://store.steampowered.com/search/?term={query}` | Link fallback jika `appId` tidak ditemukan pada pencarian game Steam | Hanya diperiksa atribut `href`-nya | Hanya diperiksa atribut `href`-nya | Cukup assert pola URL |
| `https://shared.fastly.steamstatic.com/*`<br>`https://cdn.akamai.steamstatic.com/*`<br>`https://*.steamstatic.com/*`<br>`https://*.akamaihd.net/*` | Tag `<img>` banner cover art game pada kartu chat, perbandingan, dan drawer wishlist | Di-intercept pada pengujian lama via request interception dengan regex, di-stub dengan buffer dummy 1x1 piksel PNG | Di-intercept pada uji Data Saver untuk menghitung jumlah request (mode aktif = 0 request, nonaktif > 0 request) | Gunakan `page.route()` bawaan Playwright untuk me-mock seluruh respons gambar Steam dengan buffer PNG lokal kecil |
| `https://fonts.googleapis.com`<br>`https://fonts.gstatic.com` | Google Web Fonts (Barlow: 400, 500, 600 & Barlow Semi Condensed: 500, 600, 700) pada `<link>` di `index.html` | Tidak di-intercept; browser memuat langsung dari internet jika jaringan tersedia | Tidak di-intercept; browser memuat langsung dari internet jika jaringan tersedia | Disarankan di-intercept via `page.route()` agar pengujian CI 100% kedap jaringan dan deterministik |

---

## 5. Cara Skrip Lama Menjalankan Server & Menangani Service Worker

### A. Konfigurasi Server Pengujian Lawas

1. **Skrip Layout Lama:**
   - Server: Menjalankan instance `http.createServer` Node.js mandiri (bukan aplikasi Express `index.js`).
   - Host & Port: `127.0.0.1:3588`.
   - Direktori Sajian: `public/` dengan pemetaan tipe MIME dasar (`.html`, `.js`, `.css`, `.json`, `.svg`, `.png`).
   - Penanganan Endpoint `/api/*`: Tidak didukung oleh server statis ini; seluruh panggilan API harus di-intercept di tingkat peramban via request interception.
   - Variabel Lingkungan:
     - `process.env.CI`: Mengaktifkan argumen peluncuran Chromium `--no-sandbox` dan `--disable-setuid-sandbox`, serta mewajibkan ketersediaan file baseline visual (tidak membuat baseline otomatis saat di CI).
     - Variabel lingkungan path peramban: Jalur binary Chrome.
     - Parameter CLI `--update-baseline`: Memperbarui file referensi visual lokal.

2. **Skrip Behavior Lama:**
   - Server: Menjalankan instance `http.createServer` Node.js mandiri terpisah.
   - Host & Port: `127.0.0.1:3589`.
   - Direktori Sajian: `public/` dengan tipe MIME statis.
   - Variabel Lingkungan: Menggunakan konfigurasi deteksi binary peramban yang sama dengan skrip layout.

### B. Penanganan Service Worker di Skrip Lawas

1. Berkas Service Worker `public/sw.js` diregistrasikan di `public/script.js` pada event `window.load`:
   ```javascript
   if ("serviceWorker" in navigator) {
     window.addEventListener("load", () => {
       navigator.serviceWorker.register("./sw.js");
     });
   }
   ```
2. Skrip pengujian lawas **tidak menonaktifkan atau mem-bypass Service Worker secara eksplisit**.
3. Pada pengujian PWA skenario B30, skrip hanya memeriksa tag `<link rel="manifest">` dan membaca berkas `public/manifest.json` secara sinkron melalui modul `fs` Node.js, lalu mensimulasikan mode offline dengan manipulasi properti `navigator.onLine` dan dispatch event `offline`.
4. Service Worker yang dibiarkan aktif berpotensi memicu cache stale shell atau intervensi fetch yang tidak terkendali saat proses pengujian berulang.

---

## 6. Ringkasan Kuantitatif & Identifikasi Hal Berisiko

### A. Ringkasan Jumlah Skenario

- **Pengujian Layout Lama:**
  - 5 Viewport pengujian (`1366x768`, `1024x575`, `1920x1080`, `375x667`, `412x915`).
  - Metrik Layout: 5 kelompok asersi metrik (Overflow vertikal 0px, overflow horizontal 0px, composer menempel dasar, sidebar rail, drawer items, modal inert & mobile tab switch).
  - Regresi Visual: 20 skenario perbandingan visual piksel deterministik (4 kondisi per viewport).
- **Pengujian Behavior Lama:**
  - Total: 35 skenario pengujian fungsional dan perilaku DOM.

### B. Daftar Hal Berisiko (Risk Identification)

1. **Risiko 1: Kegagalan Baseline pada Pengujian Multi-Sesi (Skenario B31 / Indeks 30)**
   - Deskripsi: Skenario B31 pada pengujian sebelumnya gagal pada baseline karena halaman `pageHistory` memicu pengiriman pesan nyata yang melakukan panggilan `fetch` ke endpoint `/api/chat/stream` dan `/api/chat`. Server statis pengujian di port 3589 tidak menyediakan handler API sehingga merespons dengan HTTP 404 Not Found. Hal ini menyebabkan penyimpanan sesi ke basis data IndexedDB tidak selesai dalam jeda timeout 600 ms.
   - Mitigasi di Playwright: Gunakan `page.route('**/api/chat**', ...)` untuk menyediakan respons mock API terstruktur yang deterministik.

2. **Risiko 2: Tabrakan Port Statis (Port Collision)**
   - Deskripsi: Port `3588` dan `3589` di-hardcode pada masing-masing skrip. Jika proses pengujian terhenti tidak sempurna (orphaned process) atau dijalankan bersamaan secara paralel, runner akan crash akibat galat `EADDRINUSE`.
   - Mitigasi di Playwright: Gunakan konfigurasi `webServer` bawaan Playwright dengan deteksi port dinamis atau port terisolasi.

3. **Risiko 3: Ketergantungan Arbitrary Timeout (Flakiness pada Runner CI)**
   - Deskripsi: Pengujian lawas banyak mengandalkan `setTimeout(r, 60)`, `setTimeout(r, 200)`, dan `setTimeout(r, 600)` untuk menunggu animasi DOM dan pembaruan storage. Pola ini rentan menyebabkan tes gagal secara acak (flaky) pada runner CI dengan beban CPU tinggi.
   - Mitigasi di Playwright: Manfaatkan mekanisme web-first assertions bawaan Playwright seperti `await expect(locator).toBeVisible()` atau `toBeAttached()` yang melakukan auto-retrying secara adaptif.

4. **Risiko 4: Kebocoran Request ke Jaringan Luar (Google Fonts & Steam CDN)**
   - Deskripsi: Font Google (`fonts.googleapis.com`) dan gambar Steam pada pengujian yang tidak di-intercept memicu request HTTP asli ke internet. Jika lingkungan CI berjalan di balik firewall ketat atau tanpa koneksi internet, pengujian dapat melambat atau gagal.
   - Mitigasi di Playwright: Pasang intercept global pada konfigurasi pengujian Playwright untuk memblokir atau me-mock seluruh domain pihak ketiga.

5. **Risiko 5: Interferensi Service Worker (Caching State Liar)**
   - Deskripsi: Registrasi Service Worker `sw.js` dibiarkan aktif tanpa isolasi cache per skenario, berpotensi menyajikan aset usang antar-eksekusi tes.
   - Mitigasi di Playwright: Gunakan context terisolasi (`browser.newContext({ serviceWorkers: 'block' })`) pada skenario yang tidak menguji Service Worker, dan uji Service Worker secara khusus di file tes terpisah.

6. **Risiko 6: Perbedaan Anti-Aliasing & Rendering Font Antar-Sistem Operasi**
   - Deskripsi: Engine rendering font berbeda antara Windows (DirectWrite) dan Linux CI (FreeType), yang dapat menghasilkan perbedaan piksel pada teks meskipun layout structurally identik.
   - Mitigasi di Playwright: Pastikan stylesheet stabilisasi (`animation: none !important; caret-color: transparent !important;`) tetap diinjeksi, dan atur toleransi perbandingan visual Playwright snapshot secara presisi.
