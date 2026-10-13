import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

// Jalankan HTTP server lokal khusus pengujian perilaku di port 3589
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(publicDir, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

const PORT = 3589;
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

function resolveChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  console.error('\n[ERROR] Peramban Google Chrome / Chromium tidak ditemukan di sistem.');
  console.error('Silakan pasang Google Chrome atau tentukan path binary secara manual via variabel lingkungan CHROME_PATH.');
  console.error('Contoh di Windows (PowerShell): $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  console.error('Contoh di Linux / macOS: export CHROME_PATH="/usr/bin/google-chrome"\n');
  process.exit(1);
}

const chromePath = resolveChromePath();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const results = [];

function recordResult(testName, passed, detail = '') {
  results.push({ testName, passed, detail });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${testName} ${detail ? ': ' + detail : ''}`);
}

try {
  const baseUrl = `http://127.0.0.1:${PORT}`;

  // =========================================================================
  // 1. SINKRONISASI WISHLIST ANTAR-TAB (REVISI 2)
  // =========================================================================
  console.log('\n--- Menguji Sinkronisasi Wishlist Antar-Tab ---');
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageB.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Bersihkan storage sebelum mulai
  await pageA.evaluate(() => localStorage.clear());
  await pageA.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  await pageB.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));

  // Tambahkan item dari tab A
  await pageA.evaluate(() => {
    const item = { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' };
    localStorage.setItem('steamscout_wishlist', JSON.stringify([item]));
  });

  // Picu storage event ke Tab B (di browser multi-tab, event ini terkirim otomatis oleh OS/engine)
  await pageB.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'steamscout_wishlist',
      newValue: localStorage.getItem('steamscout_wishlist'),
    }));
  });

  const badgeB1 = await pageB.$eval('#wishlist-badge', (el) => el.textContent.trim());
  const passSync1 = badgeB1 === '1';
  recordResult('Tab B menerima update item dari Tab A', passSync1, `Badge Tab B = ${badgeB1}`);

  // Tab B menambahkan item kedua tanpa menghapus item dari Tab A
  await pageB.evaluate(() => {
    const raw = localStorage.getItem('steamscout_wishlist');
    const list = raw ? JSON.parse(raw) : [];
    list.push({ appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' });
    localStorage.setItem('steamscout_wishlist', JSON.stringify(list));
  });

  // Picu storage event ke Tab A
  await pageA.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'steamscout_wishlist',
      newValue: localStorage.getItem('steamscout_wishlist'),
    }));
  });

  const badgeA2 = await pageA.$eval('#wishlist-badge', (el) => el.textContent.trim());
  const listA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]'));
  const passSync2 = badgeA2 === '2' && listA.length === 2 && listA.some((g) => g.title === 'Terraria');
  recordResult('Tab A menerima update dari Tab B tanpa kehilangan data awal', passSync2, `Badge Tab A = ${badgeA2}, Total = ${listA.length}`);

  await pageA.close();
  await pageB.close();

  // =========================================================================
  // 2. DETEKSI STATUS OFFLINE & KONTROL (REVISI 4)
  // =========================================================================
  console.log('\n--- Menguji Deteksi Offline ---');
  const pageOffline = await browser.newPage();
  await pageOffline.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Ketik teks ke kotak input
  await pageOffline.type('#user-input', 'Game rekomendasi laptop kentang');
  const textBeforeOffline = await pageOffline.$eval('#user-input', (el) => el.value);

  // Simulasikan event offline
  await pageOffline.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });

  const sendBtnDisabled = await pageOffline.$eval('#send-btn', (el) => el.disabled && el.getAttribute('aria-disabled') === 'true');
  const bannerVisible = await pageOffline.$eval('#offline-banner', (el) => !el.hidden);
  const textDuringOffline = await pageOffline.$eval('#user-input', (el) => el.value);
  const passOffline = sendBtnDisabled && bannerVisible && textDuringOffline === textBeforeOffline;

  recordResult('Mode offline menonaktifkan tombol Kirim dan menjaga teks input', passOffline, `Send disabled: ${sendBtnDisabled}, Banner visible: ${bannerVisible}`);

  // Simulasikan kembali online
  await pageOffline.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });

  const sendBtnEnabled = await pageOffline.$eval('#send-btn', (el) => !el.disabled && !el.getAttribute('aria-disabled'));
  const bannerHidden = await pageOffline.$eval('#offline-banner', (el) => el.hidden);
  const textAfterOnline = await pageOffline.$eval('#user-input', (el) => el.value);
  const passOnline = sendBtnEnabled && bannerHidden && textAfterOnline === textBeforeOffline;

  recordResult('Kembali online mengaktifkan kontrol dan teks input tetap utuh', passOnline, `Send enabled: ${sendBtnEnabled}, Banner hidden: ${bannerHidden}`);

  await pageOffline.close();

  // =========================================================================
  // 3. REGION LIVE SCREEN READER (REVISI 3)
  // =========================================================================
  console.log('\n--- Menguji Region Live Screen Reader ---');
  const pageA11y = await browser.newPage();
  await pageA11y.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Tambahkan item via klik tombol kartu chat yang dirender
  await pageA11y.evaluate(() => {
    const cardHtml = `
      <div class="game-card">
        <h4 class="game-card-title">Hollow Knight</h4>
        <button type="button" class="btn-wishlist-toggle" data-appid="367520" data-title="Hollow Knight" data-store-url="https://store.steampowered.com/app/367520/" aria-pressed="false">
          <span class="wishlist-btn-text">Wishlist</span>
        </button>
      </div>`;
    const bubble = document.createElement('div');
    bubble.className = 'msg bot';
    bubble.innerHTML = cardHtml;
    document.getElementById('messages').appendChild(bubble);
  });

  // Klik tombol simpan
  await pageA11y.$eval('.btn-wishlist-toggle', (btn) => btn.click());
  await new Promise((r) => setTimeout(r, 120));

  const announceAdd = await pageA11y.$eval('#live-announcer', (el) => el.textContent.trim());
  const btnPressedAfterAdd = await pageA11y.$eval('.btn-wishlist-toggle', (el) => el.getAttribute('aria-pressed'));
  const passAnnounceAdd = announceAdd.includes('ditambahkan ke wishlist') && btnPressedAfterAdd === 'true';

  recordResult('Region live mengumumkan penambahan game dan aria-pressed sinkron', passAnnounceAdd, `Pesan: "${announceAdd}"`);

  // Klik lagi untuk menghapus
  await pageA11y.$eval('.btn-wishlist-toggle', (btn) => btn.click());
  await new Promise((r) => setTimeout(r, 120));

  const announceRemove = await pageA11y.$eval('#live-announcer', (el) => el.textContent.trim());
  const btnPressedAfterRemove = await pageA11y.$eval('.btn-wishlist-toggle', (el) => el.getAttribute('aria-pressed'));
  const passAnnounceRemove = announceRemove.includes('dihapus dari wishlist') && btnPressedAfterRemove === 'false';

  recordResult('Region live mengumumkan penghapusan game dan aria-pressed sinkron', passAnnounceRemove, `Pesan: "${announceRemove}"`);

  await pageA11y.close();

  // =========================================================================
  // 4. FOCUS TRAP DRAWER WISHLIST (REVISI 5)
  // =========================================================================
  console.log('\n--- Menguji Focus Trap Drawer Wishlist ---');
  const pageFocus = await browser.newPage();
  await pageFocus.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // A. Drawer saat daftar kosong
  await pageFocus.evaluate(() => localStorage.clear());
  await pageFocus.focus('#wishlist-btn');
  await pageFocus.click('#wishlist-btn');
  await new Promise((r) => setTimeout(r, 60));

  const focusEmptyStart = await pageFocus.evaluate(() => document.activeElement.id);
  await pageFocus.keyboard.press('Tab');
  const focusEmptyTab = await pageFocus.evaluate(() => document.activeElement.id);
  await pageFocus.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 60));
  const focusAfterEsc = await pageFocus.evaluate(() => document.activeElement.id);
  const drawerHiddenEmpty = await pageFocus.$eval('#wishlist-panel', (el) => el.hidden);

  const passFocusEmpty = focusEmptyStart === 'wishlist-close-btn' &&
                         focusEmptyTab === 'wishlist-close-btn' &&
                         drawerHiddenEmpty &&
                         focusAfterEsc === 'wishlist-btn';

  recordResult('Focus trap saat drawer kosong (menahan fokus dan kembali ke tombol pembuka via Esc)', passFocusEmpty, `Awal: ${focusEmptyStart}, Tab: ${focusEmptyTab}, Pulih: ${focusAfterEsc}`);

  // B. Drawer saat daftar terisi item
  await pageFocus.evaluate(() => {
    localStorage.setItem('steamscout_wishlist', JSON.stringify([
      { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' },
      { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' },
    ]));
  });
  await pageFocus.focus('#wishlist-btn');
  await pageFocus.click('#wishlist-btn');
  await new Promise((r) => setTimeout(r, 60));

  // Tab berputar di elemen fokus drawer (tombol tutup, link steam, tombol hapus)
  await pageFocus.keyboard.press('Tab');
  const focusInDrawer1 = await pageFocus.evaluate(() => document.getElementById('wishlist-panel').contains(document.activeElement));
  await pageFocus.keyboard.press('Tab');
  const focusInDrawer2 = await pageFocus.evaluate(() => document.getElementById('wishlist-panel').contains(document.activeElement));

  await pageFocus.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 60));
  const focusAfterEscPopulated = await pageFocus.evaluate(() => document.activeElement.id);
  const drawerHiddenPopulated = await pageFocus.$eval('#wishlist-panel', (el) => el.hidden);

  const passFocusPopulated = focusInDrawer1 && focusInDrawer2 && drawerHiddenPopulated && focusAfterEscPopulated === 'wishlist-btn';
  recordResult('Focus trap saat drawer terisi item mengurung navigasi di dalam panel', passFocusPopulated, `Terkurung: ${focusInDrawer1 && focusInDrawer2}, Pulih: ${focusAfterEscPopulated}`);

  await pageFocus.close();

  // =========================================================================
  // 5. WATCHDOG STREAMING (REVISI 1)
  // =========================================================================
  console.log('\n--- Menguji Watchdog Streaming ---');

  // A. Macet SEBELUM token pertama: fallback otomatis ke POST /api/chat
  const pageWatchdogA = await browser.newPage();
  await pageWatchdogA.evaluateOnNewDocument(() => {
    window.__STREAM_FIRST_TIMEOUT_MS = 400;
    window.__STREAM_INTER_TIMEOUT_MS = 250;
  });

  await pageWatchdogA.setRequestInterception(true);
  let streamCalledA = false;
  let fallbackPostCalledA = false;

  pageWatchdogA.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/chat/stream')) {
      streamCalledA = true;
      // Jangan balas atau biarkan menggantung agar watchdog timeout terpicu
    } else if (url.includes('/api/chat')) {
      fallbackPostCalledA = true;
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            intro: 'Rekomendasi hasil fallback POST berhasil.',
            games: [],
            followUp: 'Ada pertanyaan lain?',
          },
        }),
      });
    } else {
      req.continue();
    }
  });

  await pageWatchdogA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageWatchdogA.type('#user-input', 'Cari game santai');
  await pageWatchdogA.keyboard.press('Enter');

  // Tunggu fallback POST selesai dieksekusi
  await pageWatchdogA.waitForFunction(() => {
    return document.querySelectorAll('.msg.bot').length > 0 &&
           document.body.innerText.includes('Rekomendasi hasil fallback POST berhasil.');
  }, { timeout: 3500 });

  const passWatchdogA = streamCalledA && fallbackPostCalledA;
  recordResult('Watchdog sebelum token pertama: stream macet fallback otomatis ke POST /api/chat', passWatchdogA, `Stream dipanggil: ${streamCalledA}, Fallback POST: ${fallbackPostCalledA}`);

  await pageWatchdogA.close();

  // B. Macet DI TENGAH stream (setelah token intro tampil): pertahankan teks parsial, tampilkan notifikasi ramah & tombol Coba lagi
  const pageWatchdogB = await browser.newPage();
  await pageWatchdogB.evaluateOnNewDocument(() => {
    window.__STREAM_FIRST_TIMEOUT_MS = 800;
    window.__STREAM_INTER_TIMEOUT_MS = 300;
  });

  await pageWatchdogB.setRequestInterception(true);
  let fallbackPostCalledB = false;

  pageWatchdogB.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/chat/stream')) {
      // Kirim chunk intro pertama, lalu sengaja jangan kirim chunk selanjutnya (macet)
      req.respond({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: 'data: {"chunk":"{\\"intro\\": \\"Game santai yang cocok untukmu:\\"}"}\n\n',
      });
    } else if (url.includes('/api/chat')) {
      fallbackPostCalledB = true;
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { intro: 'Fallback diam-diam', games: [] } }),
      });
    } else {
      req.continue();
    }
  });

  await pageWatchdogB.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageWatchdogB.type('#user-input', 'Game santai');
  await pageWatchdogB.keyboard.press('Enter');

  // Tunggu notifikasi koneksi terputus muncul di layar
  await pageWatchdogB.waitForSelector('.stream-disconnected-notice', { timeout: 3500 });

  const hasPartialText = await pageWatchdogB.evaluate(() => document.body.innerText.includes('Game santai yang cocok untukmu:'));
  const hasRetryBtn = await pageWatchdogB.evaluate(() => Boolean(document.querySelector('.btn-retry-stream')));
  const passWatchdogB = hasPartialText && hasRetryBtn && !fallbackPostCalledB;

  recordResult('Watchdog di tengah stream: pertahankan teks parsial, larang fallback diam-diam, sediakan tombol Coba lagi', passWatchdogB, `Teks parsial ada: ${hasPartialText}, Tombol coba lagi: ${hasRetryBtn}, Fallback dicegah: ${!fallbackPostCalledB}`);

  // C. Klik Coba lagi tidak menduplikasi pesan user
  const userMsgCountBefore = await pageWatchdogB.$$eval('.msg.user', (els) => els.length);
  await pageWatchdogB.$eval('.btn-retry-stream', (btn) => btn.click());
  await new Promise((r) => setTimeout(r, 200));
  const userMsgCountAfter = await pageWatchdogB.$$eval('.msg.user', (els) => els.length);
  const passNoDuplicate = userMsgCountBefore === 1 && userMsgCountAfter === 1;

  recordResult('Tombol Coba lagi tidak menambah pesan user ganda', passNoDuplicate, `Jumlah pesan user: sebelum = ${userMsgCountBefore}, sesudah = ${userMsgCountAfter}`);

  await pageWatchdogB.close();

} catch (err) {
  console.error('\n[ERROR Verifikasi Perilaku]', err);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log('\n====================================================');
console.log('RINGKASAN VERIFIKASI PERILAKU & AKSESIBILITAS:');
console.log('====================================================');
console.table(results);

const allPassed = results.length > 0 && results.every((r) => r.passed);
if (allPassed) {
  console.log('\nSEMUA UJI PERILAKU DOM LULUS 100%! Sistem stabil dan terbukti tangguh.\n');
  process.exit(0);
} else {
  console.error('\nTerdapat pengujian perilaku yang gagal atau belum lengkap.\n');
  process.exit(1);
}
