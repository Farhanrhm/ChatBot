# Dokumentasi Lengkap Migrasi Pengujian E2E SobatSteam (Playwright)

Dokumen ini merangkum secara komprehensif hasil pengerjaan migrasi seluruh skenario pengujian perilaku (*behavior tests*) dan integrasi antarmuka dari arsitektur pengujian peramban sebelumnya ke dalam Playwright Test Suite yang modern, deterministik, dan terisolasi.

---

## 1. Ringkasan Eksekutif & Status Pengujian

Seluruh proses migrasi berhasil diselesaikan dengan tingkat kelulusan 100% tanpa melemahkan asersi apa pun, tanpa memodifikasi kode sumber aplikasi (`public/*`), dan tanpa mengubah file baseline visual PNG asli.

### Metrik Hasil Eksekusi Akhir:
- **Suite Playwright E2E**: **79/79 PASS (100% Hijau)** dalam waktu ~53 detik.
  - `test/e2e/layout-visual.spec.js`: 20 tes PASS (Regresi visual snapshot pada 5 viewport).
  - `test/e2e/wishlist-and-compare.spec.js`: 24 tes PASS (C2: Wishlist 16 tes + C3: Komparasi 8 tes).
  - `test/e2e/layout-and-a11y.spec.js`: 22 tes PASS (Metrik layout 5 viewport & audit aksesibilitas).
- **Suite Unit Test (`npm test`)**: **153/153 PASS (100% Hijau)**.

---

## 2. Bagian C1: Chat Flow, Streaming, Offline, & Data Saver

Berkas spesifikasi: `test/e2e/chat-flow.spec.js`  
Helper pendukung: `test/e2e/helpers/mockChat.js` & `test/e2e/helpers/network.js`  
Total tes: **13 skenario (11 migrasi + 2 tes baru)**

### A. Arsitektur Mocking Streaming & Jaringan
Endpoint streaming `/api/chat/stream` diuji menggunakan helper khusus `test/e2e/helpers/mockChat.js`:
1. **`mockChatSuccess(page, customData)`**: Menyajikan chunk pembuka intro SSE (`data: {"chunk":"{\"intro\": \"...\"}"}\n\n`) kemudian diikuti payload penutup `done: true` memuat data game terstruktur, serta fallback JSON untuk `POST /api/chat`.
2. **`mockChatError(page, { status, message, code })`**: Mengembalikan payload galat JSON terstruktur standar (HTTP 429 Rate Limit atau HTTP 500 Server Error) sesuai skema `sendApiError`.
3. **`mockStreamHang(page, { afterFirstChunk, introText })`**: Mengintersep `window.fetch` via `page.addInitScript` menggunakan objek `ReadableStream` kustom yang sengaja dibiarkan terbuka (menggantung) dan mengaitkan sinyal `init.signal` ke `controller.error(AbortError)` agar peramban merespons pembatalan watchdog secara alami. Dilengkapi pencatat pemanggilan `window.__streamCallCount` dan `window.__fallbackPostCallCount`.

### B. Rincian Skenario C1

#### 1. Mode Offline & Pemulihan Jaringan ([B03] & [B04])
- **Mekanisme**: Menggunakan API peramban asli Playwright `context.setOffline(true)` dan `context.setOffline(false)`.
- **Asersi Dipertahankan**:
  - Saat offline: Tombol `#send-btn` berstatus disabled (`aria-disabled="true"`), banner `#offline-banner` tampil, dan nilai input teks `#user-input` tetap terjaga utuh.
  - Saat kembali online: Tombol `#send-btn` aktif kembali, `#offline-banner` tersembunyi, dan teks input tetap tidak hilang.

#### 2. Watchdog Batas Waktu Streaming ([B16], [B17], [B18])
- **Mekanisme**: Menyetel batas waktu watchdog pengujian (`window.__STREAM_FIRST_TIMEOUT_MS = 400` dan `window.__STREAM_INTER_TIMEOUT_MS = 250/300`) melalui `addInitScript` sehingga pengujian berjalan cepat dan deterministik tanpa menunggu 45 detik waktu nyata.
- **Asersi Dipertahankan**:
  - **[B16] (Macet Sebelum Token Pertama)**: Watchdog membatalkan sinyal request streaming (`watchdog_timeout`), memicu fallback otomatis 1 kali ke `POST /api/chat`, dan menampilkan hasil fallback di DOM.
  - **[B17] (Macet di Tengah Streaming)**: Saat chunk intro sudah tiba di layar, watchdog menghentikan stream, mempertahankan teks parsial di DOM, melarang fallback diam-diam (`fallbackCount === 0`), serta memunculkan notifikasi `.stream-disconnected-notice` dan tombol `.btn-retry-stream`. Tombol kirim tetap aktif kembali.
  - **[B18] (Mekanisme Coba Lagi Tanpa Duplikasi)**: Mengklik `.btn-retry-stream` memicu pengiriman stream baru (`streamCount >= 2`) tanpa menduplikasi baris pesan user di riwayat percakapan (`userMsgCount` tetap 1).

#### 3. PWA & Deteksi Status Offline Komposer ([B30])
- **Asersi Dipertahankan**: Validasi `public/manifest.json` (`short_name: SobatSteam`), deteksi kelas `.is-offline` dan teks `'Offline'` pada `#connection-status`, tombol kirim menampilkan title peringatan koneksi terputus, percobaan kirim form saat offline memicu toast peringatan, dan seluruh kontrol pulih saat koneksi kembali online.

#### 4. Riwayat Multi-Sesi IndexedDB ([B31])
- **Resolusi Masalah Flakiness Lama**: Skenario B31 sebelumnya rentan gagal karena server statis port 3589 tidak menyediakan handler untuk endpoint API obrolan dan waktu tunggu kaku 600 ms tidak mencukupi untuk persistensi IndexedDB. Di Playwright, endpoint di-mock dengan data sukses dan sinkronisasi diperiksa menggunakan `expect.poll` adaptif.
- **Asersi Dipertahankan**: Sesi awal kosong tidak masuk daftar riwayat, pengiriman pesan pertama membuat 1 sesi dengan judul sesuai input, tombol `+ Baru` menyiapkan sesi kosong tanpa menambah entri riwayat, pengiriman pesan kedua membuat sesi ke-2, dan perpindahan kembali ke sesi pertama memulihkan konteks pesan secara utuh.

#### 5. Fitur Ubah Nama Sesi, Tombol Salin, & Skeleton Loader ([B32])
- **Asersi Dipertahankan**:
  - Ubah nama sesi via dialog prompt ditangani menggunakan `page.once('dialog')`.
  - Tombol `.btn-copy-msg` menyalin teks ke clipboard (izin clipboard diberikan via `context.grantPermissions`) dan mengubah label menjadi `'Tersalin!'` serta kelas `.is-copied`.
  - Skeleton loader dipastikan merender kerangka kartu `.skeleton-card`.

#### 6. Mode Hemat Data / Data Saver ([B33], [B34], [B35])
- **Asersi Dipertahankan**:
  - **[B33]**: Tombol toggle `#data-saver-btn` memperbarui atribut `role="switch"`, `aria-checked="true/false"`, kelas `data-saver-active` pada `document.body`, sinkronisasi ke `localStorage`, dan pengumuman ke `#live-announcer`.
  - **[B34] (Supresi Level Jaringan)**: Saat mode hemat data aktif, gambar game dirender via placeholder SVG dan **tepat 0 request HTTP** keluar ke domain CDN Steam (`steamstatic.com` / `akamaihd.net`).
  - **[B35] (Pemulihan Level Jaringan)**: Saat mode hemat data dinonaktifkan, request gambar ke CDN Steam kembali diizinkan (`requestCount > 0`).

#### 7. Penanganan Galat HTTP Streaming ([N01] & [N02])
- **[N01] Error HTTP 429**: Respons 429 pada stream memicu fallback ke `/api/chat`, membaca JSON galat batasan laju permintaan, dan menampilkan bubble `.msg.bot.error` berisi pesan ramah server.
- **[N02] Error HTTP 500**: Respons 500 pada stream memicu fallback ke `/api/chat`, membaca JSON galat server, dan menampilkan bubble `.msg.bot.error` berisi pesan kesalahan server.

---

## 3. Bagian C2: Modul Wishlist (16 Skenario Pengujian)

Berkas spesifikasi: `test/e2e/wishlist-and-compare.spec.js` (blok `test.describe('Wishlist')`)  
Total tes: **16 skenario**

### A. Rincian Skenario C2

#### 1. Sinkronisasi Lintas Tab ([B01], [B02], [B11])
- **Mekanisme**: Membuka dua halaman (`pageA` dan `pageB`) dalam satu `BrowserContext` yang sama untuk memastikan event storage peramban tersinkronisasi.
- **Asersi Dipertahankan**:
  - **[B01]**: Tab A menambahkan item (`Terraria`), Tab B menerima pembaruan secara reaktif dan memperbarui badge `#wishlist-badge` menjadi `'1'`.
  - **[B02]**: Tab B menambahkan item kedua (`Stardew Valley`), Tab A merefleksikan badge `'2'` tanpa kehilangan data game awal.
  - **[B11]**: Tab B sedang menyaring kueri pencarian `'portal'` dan sort `'alpha-asc'`. Penambahan item ketiga dari Tab A memperbarui item di Tab B tanpa mereset query pencarian atau pilihan sort yang sedang aktif.

#### 2. Region Live Aksesibilitas & ARIA State ([B05] & [B06])
- **Asersi Dipertahankan**:
  - **[B05]**: Klik tombol `.btn-wishlist-toggle` memperbarui region live `#live-announcer` memuat teks `'ditambahkan ke wishlist'` dan atribut `aria-pressed="true"`.
  - **[B06]**: Klik kedua menghapus item, memperbarui teks `#live-announcer` memuat `'dihapus dari wishlist'`, dan atribut `aria-pressed="false"`.

#### 3. Focus Trap Drawer Wishlist ([B07], [B08], [B14])
- **Mekanisme**: Navigasi keyboard nyata menggunakan `page.keyboard.press('Tab')`, `press('Shift+Tab')`, dan `press('Escape')`, serta memeriksa elemen aktif dengan `toBeFocused()`.
- **Asersi Dipertahankan**:
  - **[B07] (Drawer Kosong)**: Fokus tertahan pada satu-satunya kontrol interaktif `#wishlist-close-btn`. Tekan `Escape` menutup drawer dan mengembalikan fokus ke pemicu `#wishlist-btn`.
  - **[B08] (Drawer Terisi)**: Siklus `Tab` mengurung fokus di dalam `#wishlist-panel`. Tekan `Escape` memulihkan fokus ke `#wishlist-btn`.
  - **[B14] (Hasil Filter Kosong)**: Saat hasil pencarian 0 game, navigasi `Tab` dan `Shift+Tab` tetap terkurung di dalam panel.

#### 4. Live Filtering & Sorting Deterministik ([B09], [B10], [B12])
- **Asersi Dipertahankan**:
  - **[B09]**: Mengetik pada `#wishlist-search` menyaring kartu seketika, fokus tidak hilang (`toBeFocused()`), dan referensi node input di DOM terbukti identik tanpa pergantian elemen.
  - **[B10]**: Pilihan `#wishlist-sort` mengurutkan kartu secara deterministik: default `latest`, lalu `oldest`, lalu `alpha-asc`.
  - **[B12]**: Menghapus item dari daftar terfilter menghapus game berdasarkan `appId` asli (bukan indeks array), fokus berpindah ke tombol hapus tetangga, dan berpindah ke `#wishlist-search` saat seluruh item terfilter habis.

#### 5. Debounce Live Announcer via Playwright Clock ([B13])
- **Mekanisme**: Memanfaatkan API `page.clock.install()` Playwright untuk menguji batas waktu debounce 400 ms secara deterministik tanpa jeda waktu nyata yang rapuh.
- **Asersi Dipertahankan**: Saat drawer pertama kali dibuka announcer kosong, segera setelah mengetik announcer belum berubah, dan setelah waktu dimajukan 450 ms (`fastForward(450)`), announcer mengumumkan `'Menampilkan 3 dari 3 game'`.

#### 6. Proteksi XSS pada Empty State ([B15])
- **Asersi Dipertahankan**: Menyuntikkan string payload `<img src=x onerror=window.__xss=1>` ke input pencarian menampilkan pesan empty state sebagai teks murni (`textContent`), tanpa tag `<img>` baru di DOM, tanpa eksekusi skrip (`window.__xss` tidak terdefinisi), dan tanpa memicu dialog peringatan.

#### 7. Refaktor Modul Wishlist & Genre Filter ([B27], [B28], [B29])
- **Asersi Dipertahankan**:
  - **[B27]**: Tombol ekspor JSON, salin teks, impor JSON, dan footer drawer dipastikan telah dikurangi dari antarmuka drawer (`toHaveCount(0)`).
  - **[B28]**: Pembaruan dinamis `updateWishlistUI()` merefleksikan 3 game di DOM, badge bernilai `'3'`, dan indikator jumlah menampilkan `'(3/50)'`.
  - **[B29]**: Quick filter chips genre menyaring game wishlist secara responsif: klik `Roguelite` menampilkan 2 game, klik `RPG` menampilkan 1 game, dan klik `Semua` mereset filter menampilkan seluruh 3 game.

---

## 4. Bagian C3: Modul Komparasi Game Berdampingan (8 Skenario Pengujian)

Berkas spesifikasi: `test/e2e/wishlist-and-compare.spec.js` (blok `test.describe('Komparasi')`)  
Total tes: **8 skenario**

### A. Rincian Skenario C3

#### 1. Seleksi Game & Floating Action Bar ([B19], [B20], [B21])
- **Asersi Dipertahankan**:
  - **[B19] (Seleksi 1 Game)**: Floating bar `#comparison-bar` muncul, teks menampilkan `'1 game dipilih: Hades. Pilih 1 game lagi.'`, tombol `#comparison-open-btn` disabled, dan tombol kartu Game 1 berstatus `aria-pressed="true"` serta memiliki kelas `.is-selected`.
  - **[B20] (Seleksi 2 Game)**: Teks floating bar berubah menjadi `'2 game siap dibandingkan: Hades vs Dead Cells'`, tombol `#comparison-open-btn` aktif, dan tombol kartu Game 2 berstatus `aria-pressed="true"`.
  - **[B21] (Penolakan Game ke-3 / Mutasi M1)**: Memilih game ke-3 ditolak (`aria-pressed="false"`, tanpa kelas `.is-selected`), dan toast batasan `.wishlist-toast` muncul dengan pesan `'Maksimal 2 game untuk dibandingkan.'`.

#### 2. Dialog Modal Komparasi, Atribut `inert`, & Focus Trap ([B22], [B23])
- **Asersi Dipertahankan**:
  - **[B22] (Pembukaan Modal / Mutasi M2)**: Mengklik `#comparison-open-btn` memunculkan dialog `#comparison-dialog` dan backdrop `#comparison-backdrop`. Kontainer latar belakang `.app` diberi atribut `inert`, dan fokus awal otomatis diarahkan ke `#comparison-close-btn` (`toBeFocused()`).
  - **[B23] (Focus Trap Modal)**: Menekan `Shift+Tab` dari `#comparison-close-btn` melompat ke elemen interaktif terakhir di dalam modal. Menekan `Tab` dari elemen terakhir melompat kembali ke `#comparison-close-btn`.

#### 3. Sinkronisasi Dua Arah Wishlist Modal & Chat ([B24])
- **Asersi Dipertahankan (Mutasi M5)**:
  - Mengklik tombol wishlist Game A di dalam modal (`.btn-modal-wishlist`) memperbarui teks menjadi `'Tersimpan'`, `aria-pressed="true"`, kartu chat Game A ikut tersinkronisasi menjadi `'Tersimpan'`, badge `#wishlist-badge` naik menjadi `'1'`, dan data tersimpan di `localStorage`.
  - Mengklik tombol wishlist Game A di modal sekali lagi menghapus game dari modal, kartu chat, badge kembali ke `'0'`, dan data terhapus dari `localStorage`.

#### 4. Penutupan via Tombol Escape & Pemulihan Fokus ([B25])
- **Asersi Dipertahankan**: Menekan tombol `Escape` menyembunyikan dialog dan backdrop komparasi, mencabut atribut `inert` dari `.app`, serta memulihkan fokus pemicu ke `#comparison-open-btn` (`toBeFocused()`).

#### 5. Reset Obrolan & Pembersihan Seleksi ([B26])
- **Asersi Dipertahankan (Mutasi M3)**: Mengklik `#reset-btn` memicu dialog konfirmasi `window.confirm` yang disetujui via `page.once('dialog')`. Seluruh seleksi komparasi dikosongkan (`count: 0`), floating bar disembunyikan, dan modal komparasi tertutup.

---

## 5. Ringkasan Kepatuhan & Kaidah Arsitektur

1. **Bebas Jeda Waktu Arbitrer (`waitForTimeout`)**: Seluruh asersi pengujian menggunakan mekanisme web-first assertions Playwright (`expect(locator).toBeVisible()`, `expect(locator).toHaveText()`, `expect.poll()`, dan manipulasi timer `page.clock`) yang adaptif terhadap beban CPU.
2. **Kerapian Jaringan & Isolasi Penuh**: Semua domain pihak ketiga (Steam CDN `steamstatic.com`, Google Fonts `fonts.googleapis.com` / `fonts.gstatic.com`) di-intersep dan disajikan secara hermetik melalui dummy fixture dan font lokal tanpa kebocoran jaringan eksternal.
3. **Kepatuhan Tipografi & Pedoman Proyek**: Seluruh kode, komentar pengujian, dan dokumentasi konsisten menggunakan tanda hubung standar (`-`) tanpa karakter em-dash, serta menggunakan kosakata "dikurangi".
4. **Keamanan Kredensial**: Tidak ada berkas `.env` atau kredensial rahasia yang dibuka, dibaca, atau diubah selama proses pengerjaan.

---

## 6. Tabel Audit Pemetaan Skenario Pengujian (B01 - B35 & N01 - N02)

| Kode Lama | Modul | File Spesifikasi Playwright | Nama Pengujian Playwright | Status |
|---|---|---|---|---|
| **B01** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B01] Tab B menerima update item dari Tab A` | PASS |
| **B02** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B02] Tab A menerima update dari Tab B tanpa kehilangan data awal` | PASS |
| **B03** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B03] Mode offline menonaktifkan tombol Kirim dan menjaga teks input` | PASS |
| **B04** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B04] Kembali online mengaktifkan kontrol dan teks input tetap utuh` | PASS |
| **B05** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B05] Region live mengumumkan penambahan game dan aria-pressed sinkron` | PASS |
| **B06** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B06] Region live mengumumkan penghapusan game dan aria-pressed sinkron` | PASS |
| **B07** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B07] Focus trap saat drawer kosong (menahan fokus dan kembali ke tombol pembuka via Esc)` | PASS |
| **B08** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B08] Focus trap saat drawer terisi item mengurung navigasi di dalam panel` | PASS |
| **B09** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B09] Mengetik pada input memfilter kartu tanpa kehilangan fokus dan tanpa pergantian node DOM` | PASS |
| **B10** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B10] Dropdown sort mengurutkan kartu secara deterministik (latest, oldest, alpha-asc)` | PASS |
| **B11** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B11] Sinkronisasi multi-tab mempertahankan query pencarian dan pilihan sort yang sedang aktif` | PASS |
| **B12** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B12] Hapus item terfilter menghapus game yang tepat (berdasarkan appId, bukan indeks) dan memindahkan fokus secara aman` | PASS |
| **B13** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B13] Live region mengumumkan jumlah game secara tepat (debounce 400ms, dan tidak mengumumkan saat drawer dibuka)` | PASS |
| **B14** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B14] Focus trap tetap menahan navigasi keyboard di dalam drawer saat hasil filter kosong` | PASS |
| **B15** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B15] Penyisipan teks empty state terhindar dari interpretasi tag HTML / XSS (textContent murni)` | PASS |
| **B16** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B16] Watchdog sebelum token pertama: stream macet fallback otomatis ke POST /api/chat` | PASS |
| **B17** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B17] Watchdog di tengah stream: pertahankan teks parsial, larang fallback diam-diam, sediakan tombol Coba lagi` | PASS |
| **B18** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B18] Tombol Coba lagi tidak menambah pesan user ganda` | PASS |
| **B19** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B19] Seleksi 1 game memunculkan floating bar dengan instruksi memilih 1 game lagi` | PASS |
| **B20** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B20] Seleksi 2 game mengaktifkan tombol Bandingkan Sekarang` | PASS |
| **B21** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B21] Penolakan seleksi lebih dari 2 game memicu toast batasan (Mutasi M1)` | PASS |
| **B22** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B22] Membuka modal komparasi mengaktifkan atribut inert pada latar belakang dan fokus pada tombol tutup (Mutasi M2)` | PASS |
| **B23** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B23] Focus trap mengurung navigasi Tab di dalam modal komparasi` | PASS |
| **B24** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B24] Sinkronisasi dua arah wishlist dari modal komparasi memperbarui state kartu chat dan drawer (Mutasi M5)` | PASS |
| **B25** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B25] Penekanan tombol Escape menutup modal dan memulihkan fokus pemicu` | PASS |
| **B26** | C3 (Komparasi) | `test/e2e/wishlist-and-compare.spec.js` | `[B26] Reset obrolan mengosongkan seleksi komparasi dan menyembunyikan floating bar (Mutasi M3)` | PASS |
| **B27** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B27] Tombol ekspor JSON, salin teks, dan impor JSON telah dikurangi dari antarmuka drawer wishlist` | PASS |
| **B28** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B28] Drawer wishlist menampilkan pembaruan game tersimpan secara dinamis dan rapi` | PASS |
| **B29** | C2 (Wishlist) | `test/e2e/wishlist-and-compare.spec.js` | `[B29] Quick filter chips genre menyaring game wishlist secara dinamis dan responsif (Modul P2)` | PASS |
| **B30** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B30] PWA & deteksi status offline menonaktifkan komposer teks dan memunculkan banner (Modul P3)` | PASS |
| **B31** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B31] Riwayat obrolan multi-sesi IndexedDB mendukung pembuatan, perpindahan, dan pemulihan konteks pesan (Modul P4)` | PASS |
| **B32** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B32] Fitur Ubah Nama Sesi, Tombol Salin Pesan, dan Skeleton Loader berfungsi sesuai spesifikasi` | PASS |
| **B33** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B33] Mode Hemat Data: Tombol toggle memperbarui role switch, aria-checked, kelas body, dan live-announcer` | PASS |
| **B34** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B34] Mode Hemat Data: Verifikasi level jaringan tepat 0 request HTTP ke CDN Steam saat mode aktif` | PASS |
| **B35** | C1 (Chat) | `test/e2e/chat-flow.spec.js` | `[B35] Mode Hemat Data: Request gambar Steam CDN kembali diizinkan saat mode hemat data dinonaktifkan` | PASS |
| **N01** | C1 (Chat - Baru) | `test/e2e/chat-flow.spec.js` | `[N01] Penanganan error HTTP 429 pada stream otomatis fallback ke POST /api/chat dan menampilkan bubble error rate limit` | PASS |
| **N02** | C1 (Chat - Baru) | `test/e2e/chat-flow.spec.js` | `[N02] Penanganan error HTTP 500 pada stream otomatis fallback ke POST /api/chat dan menampilkan bubble error server` | PASS |
