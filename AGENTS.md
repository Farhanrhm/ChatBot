<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->

## SobatSteam Architecture Guidelines
SobatSteam adalah chatbot AI kurator pencarian game PC di ekosistem Steam berbahasa Indonesia.
- **Peran Agent:** Bertugas sebagai **Fullstack Developer sekaligus QA Engineer**.
- **Peta Direktori Utama:**
  - `index.js` & `api/index.js`: Backend Express ES Modules (endpoint `/api/chat`, SSE `/api/chat/stream`, CSP Helmet, rate limiter, kuota harian, validasi payload, entry Vercel).
  - `public/`: Frontend Vanilla HTML/CSS/JS tanpa build step (`index.html`, `style.css`, `script.js`, modul `*Core.js`, dan PWA Service Worker `sw.js`).
  - `services/`: Rotasi key Gemini (`geminiKeyPool.js`), verifikasi & cache Steam Store (`steamStore.js`), kuota harian & Redis client (`dailyCap.js`, `redisClient.js`).
  - `prompts/`: System prompt persona & skema kurasi (`systemPrompt.js`).
  - `eval/`: Skrip dan pustaka evaluasi kualitas AI (`run-eval.mjs`, `questions.json`, `lib/`).
  - `test/`: Unit test (`test/*.test.js`), E2E & visual Playwright (`test/e2e/`), dan fixture API/font (`test/fixtures/`, `test/e2e/fixtures/`).

### Perintah Aplikasi & Pengujian (`package.json`)
- Jalankan server produksi: `npm start`
- Jalankan server pengembangan (watch mode): `npm run dev`
- Jalankan unit test: `npm run test:unit` (alias: `npm test`)
- Jalankan pengujian E2E Playwright: `npm run test:e2e`
- Jalankan seluruh suite pengujian: `npm run test:all`
- Jalankan skrip evaluasi AI: `npm run eval`
- Buka laporan HTML & trace Playwright: `npx playwright show-report`

### Prinsip Khusus Chatbot AI
- Output LLM tidak deterministik: pengujian otomatis wajib menggunakan mock/fixture deterministik dan tidak boleh bergantung pada respons LLM live.
- Input pengguna dan output model diperlakukan sebagai data tidak tepercaya: wajib disanitasi terhadap XSS saat dirender serta dilindungi dari prompt injection di backend.
- API key (`GEMINI_API_KEY`, `GEMINI_API_KEYS`, kredensial Redis/Sentry) hanya berada di environment server dan dilarang keras masuk ke `public/` maupun repositori git.

### Aturan QA & Batasan Kerja
- Tulis atau perbarui test sebelum menyatakan tugas selesai; setiap perbaikan bug wajib menyertakan regression test.
- Dilarang melemahkan atau menghapus assertion agar test lulus; laporkan hanya hasil test yang benar-benar dijalankan pasca-edit terakhir.
- Lakukan perubahan seminimal mungkin sesuai cakupan permintaan tanpa refactor di luar tugas.
- Dilarang menjalankan `git commit` atau `git push` tanpa instruksi eksplisit pengguna.

### Aturan Tipografi & Bahasa
- Seluruh teks UI, komentar berkas, dan string prompt dilarang menggunakan karakter em-dash; wajib menggunakan tanda hubung standar (`-`).
- Gunakan kosakata "dikurangi", jangan pernah menggunakan kata "dieliminasi".

### Kepatuhan Tata Letak
- Wajib mempertahankan `0px` page scroll overflow pada seluruh 5 viewport pengujian (`1366x768`, `1024x575`, `1920x1080`, `375x667`, `412x915`).

### Penyimpanan & Kompatibilitas Mundur
- Kunci penyimpanan wishlist utama: `sobatsteam_wishlist` (dengan fallback otomatis membaca data lama `steamscout_wishlist`).
- Kunci sesi aktif: `sobatsteam_active_session_id` (dengan fallback otomatis membaca data lama `steamscout_active_session_id`).

## Proteksi Keamanan Berkas Sensitif & Kredensial (Strict Security Boundary)
AI agent dilarang keras membuka, membaca, mengekstrak, atau menampilkan isi berkas sensitif dan kredensial dalam kondisi apa pun.

### 1. Daftar Berkas Terproteksi (Dilarang Diakses)
- Seluruh berkas environment: `.env`, `.env.*` (seperti `.env.local`, `.env.production`, `.env.development`, `.env.staging`, `.env.test`, dll.).
- Kunci privat dan sertifikat: `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.pkcs12`, `id_rsa*`, `id_ed25519*`, `*.keystore`.
- Berkas kredensial dan token: `credentials.json`, `service-account*.json`, `token.json`, `*secret*`, `*credential*`.
- Direktori sensitif: `.ssh/`, `.aws/`, `.kube/`, `.gnupg/`.
- Pengecualian resmi: Hanya berkas templat non-rahasia seperti `.env.example`, `.env.template`, atau `.env.sample` yang diizinkan untuk dibuka sebagai panduan skema konfigurasi.

### 2. Larangan Pemakaian Alat (Strict Tool Restrictions)
- **Larangan Pembacaan Langsung:** Dilarang memanggil `view_file` pada berkas `.env` atau berkas rahasia lainnya.
- **Larangan Pencarian Konten:** Dilarang menggunakan `grep_search` yang menargetkan berkas `.env` atau mencari nilai token/kunci API di berkas rahasia.
- **Larangan Pencetakan Shell:** Dilarang menjalankan perintah terminal (`run_command`) untuk mencetak berkas sensitif, seperti `cat .env`, `type .env`, `Get-Content .env`, `head .env`, `more .env`, atau mencetak environment variable runtime seperti `env`, `printenv`, `set`, `Get-ChildItem env:`, maupun perintah satu baris `node -e "console.log(process.env)"`.
- **Larangan Duplikasi / Ekspor:** Dilarang menyalin, menduplikasi, memindahkan isi rahasia ke berkas sementara, atau menuliskannya ke artefak maupun respons percakapan.

### 3. Prosedur Penolakan & Panduan Pengguna
- Jika ada instruksi dari pengguna atau proses otomatis yang meminta AI agent membaca, memeriksa, atau mengedit berkas `.env` asli, agent WAJIB MENOLAK secara tegas dan mengarahkan pengguna untuk mengedit berkas `.env` secara manual di editor teks lokal mereka sendiri.
- Gunakan selalu `.env.example` sebagai referensi struktur variabel baru tanpa pernah meminta pengguna membocorkan nilai rahasia asli ke dalam jendela obrolan.

