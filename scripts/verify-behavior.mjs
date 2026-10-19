import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const screenshotDir = path.join(projectRoot, 'scripts', 'screenshots');

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

const logFile = path.join(screenshotDir, 'behavior.log');
fs.writeFileSync(logFile, `=== VERIFIKASI PERILAKU STEAMSCOUT (${new Date().toISOString()}) ===\n`);

function log(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(logFile, msg + '\n');
  } catch {}
}

function logError(msg) {
  console.error(msg);
  try {
    fs.appendFileSync(logFile, `[ERROR] ${msg}\n`);
  } catch {}
}

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
  const isCI = Boolean(process.env.CI);

  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
    if (isCI) {
      logError(`\n[ERROR CI] CHROME_PATH ditentukan sebagai "${process.env.CHROME_PATH}", namun berkas tidak ditemukan di runner CI.`);
      logError('CI mewajibkan jalur binary Chrome/Chromium yang valid tanpa fallback diam-diam.');
      server.close();
      process.exit(1);
    }
    logError(`[WARN] Path di CHROME_PATH tidak ditemukan: "${process.env.CHROME_PATH}". Mencari path standar lokal...`);
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

  logError('\n[ERROR] Peramban Google Chrome / Chromium tidak ditemukan di sistem.');
  logError('Silakan pasang Google Chrome atau tentukan path binary secara manual via variabel lingkungan CHROME_PATH.');
  logError('Contoh di Windows (PowerShell): $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  logError('Contoh di Linux / macOS: export CHROME_PATH="/usr/bin/google-chrome"\n');
  server.close();
  process.exit(1);
}

const chromePath = resolveChromePath();
const isCI = Boolean(process.env.CI);
const browserArgs = isCI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: browserArgs,
  });
} catch (err) {
  logError('\n[ERROR] Gagal menjalankan peramban Google Chrome / Chromium.');
  logError(`Path: ${chromePath}`);
  logError(`Pesan: ${err.message}`);
  server.close();
  process.exit(1);
}

const results = [];
let activePage = null;

async function recordResult(testName, passed, detail = '', page = null) {
  results.push({ testName, passed, detail });
  const status = passed ? 'PASS' : 'FAIL';
  log(`[${status}] ${testName} ${detail ? ': ' + detail : ''}`);

  if (!passed) {
    const target = page || activePage;
    if (target && !target.isClosed()) {
      const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 45);
      const failPath = path.join(screenshotDir, `behavior_fail_${slug}.png`);
      try {
        await target.screenshot({ path: failPath });
        logError(`Screenshot kegagalan disimpan di: ${path.relative(projectRoot, failPath)}`);
      } catch (e) {
        logError(`Gagal mengambil screenshot kegagalan: ${e.message}`);
      }
    }
  }
}

try {
  const baseUrl = `http://127.0.0.1:${PORT}`;

  // =========================================================================
  // 1. SINKRONISASI WISHLIST ANTAR-TAB (REVISI 2)
  // =========================================================================
  log('\n--- Menguji Sinkronisasi Wishlist Antar-Tab ---');
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  activePage = pageA;

  await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageB.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageA.evaluate(() => document.fonts?.ready);
  await pageB.evaluate(() => document.fonts?.ready);

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

  // Tunggu Tab B merefleksikan update item secara reaktif
  activePage = pageB;
  await pageB.waitForFunction(() => {
    const el = document.getElementById('wishlist-badge');
    return el && el.textContent.trim() === '1';
  }, { timeout: 3000 });

  const badgeB1 = await pageB.$eval('#wishlist-badge', (el) => el.textContent.trim());
  const passSync1 = badgeB1 === '1';
  await recordResult('Tab B menerima update item dari Tab A', passSync1, `Badge Tab B = ${badgeB1}`, pageB);

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

  // Tunggu Tab A merefleksikan update kedua item secara reaktif
  activePage = pageA;
  await pageA.waitForFunction(() => {
    const el = document.getElementById('wishlist-badge');
    const raw = localStorage.getItem('steamscout_wishlist') || '[]';
    return el && el.textContent.trim() === '2' && JSON.parse(raw).length === 2;
  }, { timeout: 3000 });

  const badgeA2 = await pageA.$eval('#wishlist-badge', (el) => el.textContent.trim());
  const listA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]'));
  const passSync2 = badgeA2 === '2' && listA.length === 2 && listA.some((g) => g.title === 'Terraria');
  await recordResult('Tab A menerima update dari Tab B tanpa kehilangan data awal', passSync2, `Badge Tab A = ${badgeA2}, Total = ${listA.length}`, pageA);

  await pageA.close();
  await pageB.close();

  // =========================================================================
  // 2. DETEKSI STATUS OFFLINE & KONTROL (REVISI 4)
  // =========================================================================
  log('\n--- Menguji Deteksi Offline ---');
  const pageOffline = await browser.newPage();
  activePage = pageOffline;
  await pageOffline.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageOffline.evaluate(() => document.fonts?.ready);

  // Ketik teks ke kotak input
  await pageOffline.type('#user-input', 'Game rekomendasi laptop kentang');
  const textBeforeOffline = await pageOffline.$eval('#user-input', (el) => el.value);

  // Simulasikan event offline
  await pageOffline.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });

  // Tunggu kondisi stabil bahwa status offline sudah diterapkan ke UI
  await pageOffline.waitForFunction(() => {
    const banner = document.getElementById('offline-banner');
    const send = document.getElementById('send-btn');
    return banner && !banner.hidden && send && send.disabled && send.getAttribute('aria-disabled') === 'true';
  }, { timeout: 3000 });

  const sendBtnDisabled = await pageOffline.$eval('#send-btn', (el) => el.disabled && el.getAttribute('aria-disabled') === 'true');
  const bannerVisible = await pageOffline.$eval('#offline-banner', (el) => !el.hidden);
  const textDuringOffline = await pageOffline.$eval('#user-input', (el) => el.value);
  const passOffline = sendBtnDisabled && bannerVisible && textDuringOffline === textBeforeOffline;

  await recordResult('Mode offline menonaktifkan tombol Kirim dan menjaga teks input', passOffline, `Send disabled: ${sendBtnDisabled}, Banner visible: ${bannerVisible}`, pageOffline);

  // Simulasikan kembali online
  await pageOffline.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });

  // Tunggu kondisi stabil bahwa status online sudah diterapkan ke UI
  await pageOffline.waitForFunction(() => {
    const banner = document.getElementById('offline-banner');
    const send = document.getElementById('send-btn');
    return banner && banner.hidden && send && !send.disabled && !send.getAttribute('aria-disabled');
  }, { timeout: 3000 });

  const sendBtnEnabled = await pageOffline.$eval('#send-btn', (el) => !el.disabled && !el.getAttribute('aria-disabled'));
  const bannerHidden = await pageOffline.$eval('#offline-banner', (el) => el.hidden);
  const textAfterOnline = await pageOffline.$eval('#user-input', (el) => el.value);
  const passOnline = sendBtnEnabled && bannerHidden && textAfterOnline === textBeforeOffline;

  await recordResult('Kembali online mengaktifkan kontrol dan teks input tetap utuh', passOnline, `Send enabled: ${sendBtnEnabled}, Banner hidden: ${bannerHidden}`, pageOffline);

  await pageOffline.close();

  // =========================================================================
  // 3. REGION LIVE SCREEN READER (REVISI 3)
  // =========================================================================
  log('\n--- Menguji Region Live Screen Reader ---');
  const pageA11y = await browser.newPage();
  activePage = pageA11y;
  await pageA11y.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageA11y.evaluate(() => document.fonts?.ready);

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

  // Tunggu live region dan atribut aria-pressed terupdate
  await pageA11y.waitForFunction(() => {
    const announcer = document.getElementById('live-announcer')?.textContent.trim() || '';
    const btn = document.querySelector('.btn-wishlist-toggle');
    return announcer.includes('ditambahkan ke wishlist') && btn?.getAttribute('aria-pressed') === 'true';
  }, { timeout: 3000 });

  const announceAdd = await pageA11y.$eval('#live-announcer', (el) => el.textContent.trim());
  const btnPressedAfterAdd = await pageA11y.$eval('.btn-wishlist-toggle', (el) => el.getAttribute('aria-pressed'));
  const passAnnounceAdd = announceAdd.includes('ditambahkan ke wishlist') && btnPressedAfterAdd === 'true';

  await recordResult('Region live mengumumkan penambahan game dan aria-pressed sinkron', passAnnounceAdd, `Pesan: "${announceAdd}"`, pageA11y);

  // Klik lagi untuk menghapus
  await pageA11y.$eval('.btn-wishlist-toggle', (btn) => btn.click());

  // Tunggu live region dan atribut aria-pressed terupdate
  await pageA11y.waitForFunction(() => {
    const announcer = document.getElementById('live-announcer')?.textContent.trim() || '';
    const btn = document.querySelector('.btn-wishlist-toggle');
    return announcer.includes('dihapus dari wishlist') && btn?.getAttribute('aria-pressed') === 'false';
  }, { timeout: 3000 });

  const announceRemove = await pageA11y.$eval('#live-announcer', (el) => el.textContent.trim());
  const btnPressedAfterRemove = await pageA11y.$eval('.btn-wishlist-toggle', (el) => el.getAttribute('aria-pressed'));
  const passAnnounceRemove = announceRemove.includes('dihapus dari wishlist') && btnPressedAfterRemove === 'false';

  await recordResult('Region live mengumumkan penghapusan game dan aria-pressed sinkron', passAnnounceRemove, `Pesan: "${announceRemove}"`, pageA11y);

  await pageA11y.close();

  // =========================================================================
  // 4. FOCUS TRAP DRAWER WISHLIST (REVISI 5)
  // =========================================================================
  log('\n--- Menguji Focus Trap Drawer Wishlist ---');
  const pageFocus = await browser.newPage();
  activePage = pageFocus;
  await pageFocus.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageFocus.evaluate(() => document.fonts?.ready);

  // A. Drawer saat daftar kosong
  await pageFocus.evaluate(() => localStorage.clear());
  await pageFocus.focus('#wishlist-btn');
  await pageFocus.click('#wishlist-btn');

  // Tunggu drawer terbuka
  await pageFocus.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    return panel && !panel.hidden;
  }, { timeout: 3000 });

  const focusEmptyStart = await pageFocus.evaluate(() => document.activeElement.id);
  await pageFocus.keyboard.press('Tab');
  const focusEmptyTab = await pageFocus.evaluate(() => document.activeElement.id);
  // Navigasi Tab berlanjut melewati tombol aksi hingga berputar kembali ke tombol tutup
  await pageFocus.keyboard.press('Tab'); // ke wishlist-copy-btn
  await pageFocus.keyboard.press('Tab'); // ke wishlist-import-btn
  await pageFocus.keyboard.press('Tab'); // wrap kembali ke wishlist-close-btn
  const focusWrapped = await pageFocus.evaluate(() => document.activeElement.id);
  await pageFocus.keyboard.press('Escape');

  // Tunggu drawer tertutup
  await pageFocus.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    return panel && panel.hidden;
  }, { timeout: 3000 });

  const focusAfterEsc = await pageFocus.evaluate(() => document.activeElement.id);
  const drawerHiddenEmpty = await pageFocus.$eval('#wishlist-panel', (el) => el.hidden);

  const passFocusEmpty = focusEmptyStart === 'wishlist-close-btn' &&
                         focusEmptyTab === 'wishlist-export-btn' &&
                         focusWrapped === 'wishlist-close-btn' &&
                         drawerHiddenEmpty &&
                         focusAfterEsc === 'wishlist-btn';

  await recordResult('Focus trap saat drawer kosong (menahan fokus dan kembali ke tombol pembuka via Esc)', passFocusEmpty, `Awal: ${focusEmptyStart}, Tab1: ${focusEmptyTab}, Wrap: ${focusWrapped}, Pulih: ${focusAfterEsc}`, pageFocus);


  // B. Drawer saat daftar terisi item
  await pageFocus.evaluate(() => {
    localStorage.setItem('steamscout_wishlist', JSON.stringify([
      { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' },
      { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' },
    ]));
  });
  await pageFocus.focus('#wishlist-btn');
  await pageFocus.click('#wishlist-btn');

  // Tunggu drawer terbuka
  await pageFocus.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    return panel && !panel.hidden;
  }, { timeout: 3000 });

  // Tab berputar di elemen fokus drawer (tombol tutup, link steam, tombol hapus)
  await pageFocus.keyboard.press('Tab');
  const focusInDrawer1 = await pageFocus.evaluate(() => document.getElementById('wishlist-panel').contains(document.activeElement));
  await pageFocus.keyboard.press('Tab');
  const focusInDrawer2 = await pageFocus.evaluate(() => document.getElementById('wishlist-panel').contains(document.activeElement));

  await pageFocus.keyboard.press('Escape');

  // Tunggu drawer tertutup
  await pageFocus.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    return panel && panel.hidden;
  }, { timeout: 3000 });

  const focusAfterEscPopulated = await pageFocus.evaluate(() => document.activeElement.id);
  const drawerHiddenPopulated = await pageFocus.$eval('#wishlist-panel', (el) => el.hidden);

  const passFocusPopulated = focusInDrawer1 && focusInDrawer2 && drawerHiddenPopulated && focusAfterEscPopulated === 'wishlist-btn';
  await recordResult('Focus trap saat drawer terisi item mengurung navigasi di dalam panel', passFocusPopulated, `Terkurung: ${focusInDrawer1 && focusInDrawer2}, Pulih: ${focusAfterEscPopulated}`, pageFocus);

  await pageFocus.close();

  // =========================================================================
  // 5. PENGURUTAN DAN PENCARIAN WISHLIST (FASE 2)
  // =========================================================================
  log('\n--- Menguji Pengurutan dan Pencarian Wishlist ---');

  // A. Live filtering tanpa kehilangan fokus dan tanpa pergantian node DOM
  const pageSearch = await browser.newPage();
  activePage = pageSearch;
  await pageSearch.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageSearch.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/', addedAt: '2026-01-01T10:00:00.000Z' },
      { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/', addedAt: '2026-01-02T10:00:00.000Z' },
      { appId: 367520, title: 'Hollow Knight', storeUrl: 'https://store.steampowered.com/app/367520/', addedAt: '2026-01-03T10:00:00.000Z' },
      { appId: 504230, title: 'Celeste', storeUrl: 'https://store.steampowered.com/app/504230/', addedAt: '2026-01-04T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });
  await pageSearch.click('#wishlist-btn');
  await pageSearch.waitForFunction(() => {
    const p = document.getElementById('wishlist-panel');
    const items = document.querySelectorAll('.wishlist-item');
    return p && !p.hidden && items.length === 4;
  }, { timeout: 3000 });

  await pageSearch.evaluate(() => {
    const input = document.getElementById('wishlist-search');
    window.__testInputNode = input;
    input.focus();
  });

  await pageSearch.type('#wishlist-search', 'hollow');

  await pageSearch.waitForFunction(() => {
    const items = document.querySelectorAll('.wishlist-item');
    return items.length === 1 && items[0].innerText.includes('Hollow Knight');
  }, { timeout: 3000 });

  const filterResult = await pageSearch.evaluate(() => {
    const input = document.getElementById('wishlist-search');
    const isFocusPreserved = document.activeElement === input;
    const isNodePreserved = window.__testInputNode === input;
    const items = Array.from(document.querySelectorAll('.wishlist-item')).map((el) => el.querySelector('.wishlist-item-title')?.textContent);
    return { isFocusPreserved, isNodePreserved, items };
  });

  const passFilter = filterResult.isFocusPreserved && filterResult.isNodePreserved && filterResult.items.length === 1 && filterResult.items[0] === 'Hollow Knight';
  await recordResult('Mengetik pada input memfilter kartu tanpa kehilangan fokus dan tanpa pergantian node DOM', passFilter, `Fokus terjaga: ${filterResult.isFocusPreserved}, Node identik: ${filterResult.isNodePreserved}, Item: ${JSON.stringify(filterResult.items)}`, pageSearch);

  // B. Dropdown sort mengurutkan kartu secara deterministik (latest, oldest, alpha-asc)
  await pageSearch.evaluate(() => {
    const input = document.getElementById('wishlist-search');
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
  await pageSearch.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 4, { timeout: 3000 });

  const orderLatest = await pageSearch.evaluate(() => {
    return Array.from(document.querySelectorAll('.wishlist-item .wishlist-item-title')).map((el) => el.textContent.trim());
  });

  await pageSearch.select('#wishlist-sort', 'oldest');
  await pageSearch.waitForFunction(() => {
    const first = document.querySelector('.wishlist-item .wishlist-item-title')?.textContent.trim();
    return first === 'Terraria';
  }, { timeout: 3000 });
  const orderOldest = await pageSearch.evaluate(() => {
    return Array.from(document.querySelectorAll('.wishlist-item .wishlist-item-title')).map((el) => el.textContent.trim());
  });

  await pageSearch.select('#wishlist-sort', 'alpha-asc');
  await pageSearch.waitForFunction(() => {
    const first = document.querySelector('.wishlist-item .wishlist-item-title')?.textContent.trim();
    return first === 'Celeste';
  }, { timeout: 3000 });
  const orderAlpha = await pageSearch.evaluate(() => {
    return Array.from(document.querySelectorAll('.wishlist-item .wishlist-item-title')).map((el) => el.textContent.trim());
  });

  const passLatest = JSON.stringify(orderLatest) === JSON.stringify(['Celeste', 'Hollow Knight', 'Stardew Valley', 'Terraria']);
  const passOldest = JSON.stringify(orderOldest) === JSON.stringify(['Terraria', 'Stardew Valley', 'Hollow Knight', 'Celeste']);
  const passAlpha = JSON.stringify(orderAlpha) === JSON.stringify(['Celeste', 'Hollow Knight', 'Stardew Valley', 'Terraria']);
  const passSort = passLatest && passOldest && passAlpha;
  await recordResult('Dropdown sort mengurutkan kartu secara deterministik (latest, oldest, alpha-asc)', passSort, `Latest: ${JSON.stringify(orderLatest)}, Oldest: ${JSON.stringify(orderOldest)}, Alpha: ${JSON.stringify(orderAlpha)}`, pageSearch);

  await pageSearch.close();

  // C. Sinkronisasi multi-tab mempertahankan query pencarian dan pilihan sort yang sedang aktif
  const pageSyncA = await browser.newPage();
  const pageSyncB = await browser.newPage();
  await pageSyncA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pageSyncB.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await pageSyncA.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 10, title: 'Counter-Strike 2', storeUrl: 'https://store.steampowered.com/app/10/', addedAt: '2026-01-01T10:00:00.000Z' },
      { appId: 20, title: 'Portal 2', storeUrl: 'https://store.steampowered.com/app/20/', addedAt: '2026-01-02T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });

  await pageSyncB.click('#wishlist-btn');
  await pageSyncB.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 2, { timeout: 3000 });
  await pageSyncB.type('#wishlist-search', 'portal');
  await pageSyncB.select('#wishlist-sort', 'alpha-asc');

  await pageSyncB.waitForFunction(() => {
    const items = document.querySelectorAll('.wishlist-item');
    return items.length === 1 && items[0].innerText.includes('Portal 2');
  }, { timeout: 3000 });

  await pageSyncA.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]');
    list.push({ appId: 30, title: 'Portal Revolution', storeUrl: 'https://store.steampowered.com/app/30/', addedAt: '2026-01-03T10:00:00.000Z' });
    localStorage.setItem('steamscout_wishlist', JSON.stringify(list));
  });

  await pageSyncB.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'steamscout_wishlist',
      newValue: localStorage.getItem('steamscout_wishlist'),
    }));
  });

  await pageSyncB.waitForFunction(() => {
    const items = document.querySelectorAll('.wishlist-item');
    return items.length === 2;
  }, { timeout: 3000 });

  const syncStateB = await pageSyncB.evaluate(() => {
    const qVal = document.getElementById('wishlist-search')?.value;
    const sVal = document.getElementById('wishlist-sort')?.value;
    const titles = Array.from(document.querySelectorAll('.wishlist-item .wishlist-item-title')).map((el) => el.textContent.trim());
    return { qVal, sVal, titles };
  });

  const passSyncPreserve = syncStateB.qVal === 'portal' && syncStateB.sVal === 'alpha-asc' && syncStateB.titles.length === 2 && syncStateB.titles[0] === 'Portal 2' && syncStateB.titles[1] === 'Portal Revolution';
  await recordResult('Sinkronisasi multi-tab mempertahankan query pencarian dan pilihan sort yang sedang aktif', passSyncPreserve, `Query: "${syncStateB.qVal}", Sort: "${syncStateB.sVal}", Items: ${JSON.stringify(syncStateB.titles)}`, pageSyncB);

  await pageSyncA.close();
  await pageSyncB.close();

  // D. Hapus item terfilter menghapus game yang tepat (berdasarkan appId, bukan indeks) dan memindahkan fokus
  const pageDel = await browser.newPage();
  activePage = pageDel;
  await pageDel.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await pageDel.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 101, title: 'Alpha Game', storeUrl: 'https://store.steampowered.com/app/101/', addedAt: '2026-01-01T10:00:00.000Z' },
      { appId: 102, title: 'Beta One', storeUrl: 'https://store.steampowered.com/app/102/', addedAt: '2026-01-02T10:00:00.000Z' },
      { appId: 103, title: 'Beta Two', storeUrl: 'https://store.steampowered.com/app/103/', addedAt: '2026-01-03T10:00:00.000Z' },
      { appId: 104, title: 'Beta Three', storeUrl: 'https://store.steampowered.com/app/104/', addedAt: '2026-01-04T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });

  await pageDel.click('#wishlist-btn');
  await pageDel.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 4, { timeout: 3000 });

  await pageDel.type('#wishlist-search', 'Beta');
  await pageDel.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 3, { timeout: 3000 });

  // Hapus item pertama pada daftar terfilter (Beta Three, appId 104)
  await pageDel.evaluate(() => {
    const delBtns = document.querySelectorAll('.btn-item-delete');
    if (delBtns.length > 0) delBtns[0].click();
  });

  await pageDel.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 2, { timeout: 3000 });

  const storageAfterDel1 = await pageDel.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]');
    const appIds = list.map((g) => g.appId);
    const focusedDatasetKey = document.activeElement ? document.activeElement.dataset?.key : null;
    return { appIds, focusedDatasetKey };
  });

  const alphaStillExists = storageAfterDel1.appIds.includes(101);
  const betaThreeRemoved = !storageAfterDel1.appIds.includes(104);
  const focusOnNext = storageAfterDel1.focusedDatasetKey === 'app_103';

  // Hapus item terakhir pada daftar terfilter (Beta One, appId 102)
  await pageDel.evaluate(() => {
    const delBtns = document.querySelectorAll('.btn-item-delete');
    if (delBtns.length > 1) delBtns[1].click();
  });

  await pageDel.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 1, { timeout: 3000 });

  const storageAfterDel2 = await pageDel.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]');
    const appIds = list.map((g) => g.appId);
    const focusedDatasetKey = document.activeElement ? document.activeElement.dataset?.key : null;
    return { appIds, focusedDatasetKey };
  });

  const focusOnPrev = storageAfterDel2.focusedDatasetKey === 'app_103';

  // Hapus satu-satunya item terfilter yang tersisa (Beta Two, appId 103)
  await pageDel.evaluate(() => {
    const delBtns = document.querySelectorAll('.btn-item-delete');
    if (delBtns.length > 0) delBtns[0].click();
  });

  await pageDel.waitForFunction(() => {
    const emptyNotice = document.getElementById('wishlist-filter-empty');
    return emptyNotice && !emptyNotice.hidden;
  }, { timeout: 3000 });

  const focusAfterEmpty = await pageDel.evaluate(() => document.activeElement.id);
  const passDelAndFocus = alphaStillExists && betaThreeRemoved && focusOnNext && focusOnPrev && focusAfterEmpty === 'wishlist-search';

  await recordResult('Hapus item terfilter menghapus game yang tepat (berdasarkan appId, bukan indeks) dan memindahkan fokus secara aman', passDelAndFocus, `Alpha aman: ${alphaStillExists}, Beta3 terhapus: ${betaThreeRemoved}, Fokus maju: ${focusOnNext}, Fokus mundur: ${focusOnPrev}, Fokus ke search: ${focusAfterEmpty}`, pageDel);

  await pageDel.close();

  // E. Live region mengumumkan jumlah game secara tepat (debounce 400ms, dan tidak mengumumkan saat drawer dibuka)
  const pageLive = await browser.newPage();
  activePage = pageLive;
  await pageLive.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await pageLive.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 1, title: 'Game A', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
      { appId: 2, title: 'Game B', storeUrl: 'https://store.steampowered.com/app/2/', addedAt: '2026-01-02T10:00:00.000Z' },
      { appId: 3, title: 'Game C', storeUrl: 'https://store.steampowered.com/app/3/', addedAt: '2026-01-03T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });

  await pageLive.click('#wishlist-btn');
  await pageLive.waitForFunction(() => {
    const p = document.getElementById('wishlist-panel');
    return p && !p.hidden;
  }, { timeout: 3000 });

  const initialAnnounce = await pageLive.evaluate(() => {
    const el = document.getElementById('wishlist-filter-announcer');
    return el ? el.textContent.trim() : '';
  });

  await pageLive.type('#wishlist-search', 'Game');

  const immediateAnnounce = await pageLive.evaluate(() => {
    const el = document.getElementById('wishlist-filter-announcer');
    return el ? el.textContent.trim() : '';
  });

  await pageLive.waitForFunction(() => {
    const el = document.getElementById('wishlist-filter-announcer');
    return el && el.textContent.trim() === 'Menampilkan 3 dari 3 game';
  }, { timeout: 3000 });

  const debouncedAnnounce = await pageLive.evaluate(() => {
    const el = document.getElementById('wishlist-filter-announcer');
    return el ? el.textContent.trim() : '';
  });

  const passLive = initialAnnounce === '' && immediateAnnounce === '' && debouncedAnnounce === 'Menampilkan 3 dari 3 game';
  await recordResult('Live region mengumumkan jumlah game secara tepat (debounce 400ms, dan tidak mengumumkan saat drawer dibuka)', passLive, `Awal: "${initialAnnounce}", Segera: "${immediateAnnounce}", Debounced: "${debouncedAnnounce}"`, pageLive);

  await pageLive.close();

  // F. Focus trap tetap menahan navigasi keyboard di dalam drawer saat hasil filter kosong
  const pageTrap = await browser.newPage();
  activePage = pageTrap;
  await pageTrap.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await pageTrap.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 1, title: 'Portal', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });

  await pageTrap.click('#wishlist-btn');
  await pageTrap.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 1, { timeout: 3000 });

  await pageTrap.type('#wishlist-search', 'nomatchgame');
  await pageTrap.waitForFunction(() => {
    const emptyNotice = document.getElementById('wishlist-filter-empty');
    return emptyNotice && !emptyNotice.hidden && document.querySelectorAll('.wishlist-item').length === 0;
  }, { timeout: 3000 });

  const panelId = 'wishlist-panel';
  const trapChecks = [];
  for (let i = 0; i < 4; i++) {
    await pageTrap.keyboard.press('Tab');
    const inPanel = await pageTrap.evaluate((pid) => {
      const active = document.activeElement;
      return active && document.getElementById(pid).contains(active);
    }, panelId);
    trapChecks.push(inPanel);
  }

  await pageTrap.keyboard.down('Shift');
  await pageTrap.keyboard.press('Tab');
  await pageTrap.keyboard.up('Shift');
  const inPanelShift = await pageTrap.evaluate((pid) => {
    const active = document.activeElement;
    return active && document.getElementById(pid).contains(active);
  }, panelId);
  trapChecks.push(inPanelShift);

  const passTrapEmpty = trapChecks.every(Boolean);
  await recordResult('Focus trap tetap menahan navigasi keyboard di dalam drawer saat hasil filter kosong', passTrapEmpty, `Siklus Tab terjaga: ${passTrapEmpty} (${trapChecks.length} langkah)`, pageTrap);

  await pageTrap.close();

  // G. Penyisipan teks empty state terhindar dari interpretasi tag HTML / XSS (textContent murni)
  const pageXss = await browser.newPage();
  activePage = pageXss;
  await pageXss.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await pageXss.evaluate(() => {
    localStorage.clear();
    const items = [
      { appId: 1, title: 'Cyberpunk 2077', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(items));
  });

  await pageXss.click('#wishlist-btn');
  await pageXss.waitForFunction(() => document.querySelectorAll('.wishlist-item').length === 1, { timeout: 3000 });

  const xssPayload = '<img src=x onerror=window.__xss=1>';
  await pageXss.type('#wishlist-search', xssPayload);

  await pageXss.waitForFunction(() => {
    const empty = document.getElementById('wishlist-filter-empty');
    return empty && !empty.hidden;
  }, { timeout: 3000 });

  await pageXss.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const xssResult = await pageXss.evaluate((payload) => {
    const empty = document.getElementById('wishlist-filter-empty');
    const isScriptExecuted = Boolean(window.__xss);
    const hasImgTag = Boolean(empty && empty.querySelector('img'));
    const textContentIncludes = Boolean(empty && empty.textContent.includes(payload));
    return { isScriptExecuted, hasImgTag, textContentIncludes };
  }, xssPayload);

  const passXss = !xssResult.isScriptExecuted && !xssResult.hasImgTag && xssResult.textContentIncludes;
  await recordResult('Penyisipan teks empty state terhindar dari interpretasi tag HTML / XSS (textContent murni)', passXss, `Script dieksekusi: ${xssResult.isScriptExecuted}, Ada tag img: ${xssResult.hasImgTag}, Teks persis: ${xssResult.textContentIncludes}`, pageXss);

  await pageXss.close();

  // =========================================================================
  // 6. WATCHDOG STREAMING (REVISI 1)
  // =========================================================================
  log('\n--- Menguji Watchdog Streaming ---');

  // A. Macet SEBELUM token pertama: fallback otomatis ke POST /api/chat
  const pageWatchdogA = await browser.newPage();
  activePage = pageWatchdogA;
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
  }, { timeout: 5000 });

  const passWatchdogA = streamCalledA && fallbackPostCalledA;
  await recordResult('Watchdog sebelum token pertama: stream macet fallback otomatis ke POST /api/chat', passWatchdogA, `Stream dipanggil: ${streamCalledA}, Fallback POST: ${fallbackPostCalledA}`, pageWatchdogA);

  await pageWatchdogA.close();

  // B. Macet DI TENGAH stream (setelah token intro tampil): pertahankan teks parsial, tampilkan notifikasi ramah & tombol Coba lagi
  const pageWatchdogB = await browser.newPage();
  activePage = pageWatchdogB;
  await pageWatchdogB.evaluateOnNewDocument(() => {
    window.__STREAM_FIRST_TIMEOUT_MS = 800;
    window.__STREAM_INTER_TIMEOUT_MS = 300;
  });

  await pageWatchdogB.setRequestInterception(true);
  let streamCallCountB = 0;
  let fallbackPostCalledB = false;

  pageWatchdogB.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/chat/stream')) {
      streamCallCountB++;
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
  await pageWatchdogB.waitForSelector('.stream-disconnected-notice', { timeout: 5000 });

  // Kondisi penahan: pastikan tombol coba lagi dan status input sudah stabil
  await pageWatchdogB.waitForFunction(() => {
    const btn = document.querySelector('.btn-retry-stream');
    const send = document.getElementById('send-btn');
    return btn !== null && send && !send.disabled;
  }, { timeout: 3000 });

  const hasPartialText = await pageWatchdogB.evaluate(() => document.body.innerText.includes('Game santai yang cocok untukmu:'));
  const hasRetryBtn = await pageWatchdogB.evaluate(() => Boolean(document.querySelector('.btn-retry-stream')));
  const passWatchdogB = hasPartialText && hasRetryBtn && !fallbackPostCalledB;

  await recordResult('Watchdog di tengah stream: pertahankan teks parsial, larang fallback diam-diam, sediakan tombol Coba lagi', passWatchdogB, `Teks parsial ada: ${hasPartialText}, Tombol coba lagi: ${hasRetryBtn}, Fallback dicegah: ${!fallbackPostCalledB}`, pageWatchdogB);

  // C. Klik Coba lagi tidak menduplikasi pesan user
  const userMsgCountBefore = await pageWatchdogB.$$eval('.msg.user', (els) => els.length);
  await pageWatchdogB.$eval('.btn-retry-stream', (btn) => btn.click());

  // Kondisi penahan: tunggu aksi coba lagi memicu pemanggilan stream baru (streamCallCountB >= 2)
  let retryRequestSent = false;
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (streamCallCountB >= 2) {
        retryRequestSent = true;
        clearInterval(interval);
        resolve();
      }
    }, 25);
    setTimeout(() => {
      retryRequestSent = streamCallCountB >= 2;
      clearInterval(interval);
      resolve();
    }, 3000);
  });

  // Tunggu dua frame rendering berturut-turut untuk memastikan siklus mutasi DOM stabil
  await pageWatchdogB.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const userMsgCountAfter = await pageWatchdogB.$$eval('.msg.user', (els) => els.length);
  const passNoDuplicate = retryRequestSent && userMsgCountBefore === 1 && userMsgCountAfter === 1;

  await recordResult('Tombol Coba lagi tidak menambah pesan user ganda', passNoDuplicate, `Request terkirim: ${retryRequestSent}, Jumlah pesan user: sebelum = ${userMsgCountBefore}, sesudah = ${userMsgCountAfter}`, pageWatchdogB);

  await pageWatchdogB.close();
  activePage = null;

  // UJI PERILAKU & AKSESIBILITAS: KOMPARASI GAME BERDAMPINGAN (FASE 3)
  const pageComp = await browser.newPage();
  activePage = pageComp;
  await pageComp.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // 1. Suntikkan 3 game rekomendasi ke obrolan
  await pageComp.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.hidden = true;

    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.innerHTML = `
      <div class="avatar">AI</div>
      <div class="bubble">
        <div class="game-cards">
          <div class="game-card" id="card-1">
            <div class="game-card-inner">
              <h4 class="game-card-title">Hades</h4>
              <div class="game-card-actions">
                <button type="button" class="btn-wishlist-toggle" data-appid="1145360" data-title="Hades" data-store-url="https://store.steampowered.com/app/1145360/">
                  <span class="wishlist-btn-text">Wishlist</span>
                </button>
                <button type="button" class="btn-compare-toggle" data-key="app:1145360" data-appid="1145360" data-title="Hades" data-year="2020" data-developer="Supergiant Games" data-genres="Rogue-like,Action" data-whyfit="Action roguelike cepat." data-specs="Ringan.">
                  <span class="compare-btn-text">Bandingkan</span>
                </button>
              </div>
            </div>
          </div>
          <div class="game-card" id="card-2">
            <div class="game-card-inner">
              <h4 class="game-card-title">Dead Cells</h4>
              <div class="game-card-actions">
                <button type="button" class="btn-wishlist-toggle" data-appid="588650" data-title="Dead Cells" data-store-url="https://store.steampowered.com/app/588650/">
                  <span class="wishlist-btn-text">Wishlist</span>
                </button>
                <button type="button" class="btn-compare-toggle" data-key="app:588650" data-appid="588650" data-title="Dead Cells" data-year="2018" data-developer="Motion Twin" data-genres="Roguelite,Metroidvania" data-whyfit="Eksplorasi kastil seru." data-specs="Sangat bersahabat.">
                  <span class="compare-btn-text">Bandingkan</span>
                </button>
              </div>
            </div>
          </div>
          <div class="game-card" id="card-3">
            <div class="game-card-inner">
              <h4 class="game-card-title">Risk of Rain 2</h4>
              <div class="game-card-actions">
                <button type="button" class="btn-wishlist-toggle" data-appid="632360" data-title="Risk of Rain 2" data-store-url="https://store.steampowered.com/app/632360/">
                  <span class="wishlist-btn-text">Wishlist</span>
                </button>
                <button type="button" class="btn-compare-toggle" data-key="app:632360" data-appid="632360" data-title="Risk of Rain 2" data-year="2020" data-developer="Hopoo Games" data-genres="Third-Person Shooter,Co-op" data-whyfit="Multiplayer adiktif." data-specs="Butuh GPU moderat.">
                  <span class="compare-btn-text">Bandingkan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    messages.appendChild(botMsg);
  });

  // Test 1: Seleksi 1 game memunculkan floating bar dengan instruksi memilih 1 game lagi
  await pageComp.evaluate(() => {
    const btns = document.querySelectorAll('.btn-compare-toggle');
    btns[0].click();
  });

  const barState1 = await pageComp.evaluate(() => {
    const bar = document.getElementById('comparison-bar');
    const text = document.getElementById('comparison-bar-text')?.textContent;
    const openBtn = document.getElementById('comparison-open-btn');
    const firstCardBtn = document.querySelectorAll('.btn-compare-toggle')[0];
    return {
      barHidden: bar?.hidden,
      text,
      openBtnDisabled: openBtn?.disabled,
      btnPressed: firstCardBtn?.getAttribute('aria-pressed'),
      btnSelected: firstCardBtn?.classList.contains('is-selected'),
    };
  });

  const passSelect1 = barState1.barHidden === false &&
    barState1.text.includes('1 game dipilih') &&
    barState1.text.includes('Pilih 1 game lagi') &&
    barState1.openBtnDisabled === true &&
    barState1.btnPressed === 'true' &&
    barState1.btnSelected === true;
  await recordResult('Seleksi 1 game memunculkan floating bar dengan instruksi memilih 1 game lagi', passSelect1, `Bar hidden: ${barState1.barHidden}, Teks: "${barState1.text}", Tombol bandingkan disabled: ${barState1.openBtnDisabled}`, pageComp);

  // Test 2: Seleksi 2 game mengaktifkan tombol Bandingkan Sekarang
  await pageComp.evaluate(() => {
    const btns = document.querySelectorAll('.btn-compare-toggle');
    btns[1].click();
  });

  const barState2 = await pageComp.evaluate(() => {
    const bar = document.getElementById('comparison-bar');
    const text = document.getElementById('comparison-bar-text')?.textContent;
    const openBtn = document.getElementById('comparison-open-btn');
    const secondCardBtn = document.querySelectorAll('.btn-compare-toggle')[1];
    return {
      barHidden: bar?.hidden,
      text,
      openBtnDisabled: openBtn?.disabled,
      btnPressed: secondCardBtn?.getAttribute('aria-pressed'),
      btnSelected: secondCardBtn?.classList.contains('is-selected'),
    };
  });

  const passSelect2 = barState2.barHidden === false &&
    barState2.text.includes('2 game siap dibandingkan') &&
    barState2.openBtnDisabled === false &&
    barState2.btnPressed === 'true' &&
    barState2.btnSelected === true;
  await recordResult('Seleksi 2 game mengaktifkan tombol Bandingkan Sekarang', passSelect2, `Bar hidden: ${barState2.barHidden}, Teks: "${barState2.text}", Tombol bandingkan disabled: ${barState2.openBtnDisabled}`, pageComp);

  // Test 3: Mencoba menambah game ke-3 ditolak dan memicu toast (Mutasi M1)
  await pageComp.evaluate(() => {
    const btns = document.querySelectorAll('.btn-compare-toggle');
    btns[2].click();
  });

  const thirdGameState = await pageComp.evaluate(() => {
    const thirdBtn = document.querySelectorAll('.btn-compare-toggle')[2];
    const toast = document.querySelector('.wishlist-toast');
    return {
      thirdPressed: thirdBtn?.getAttribute('aria-pressed'),
      thirdSelected: thirdBtn?.classList.contains('is-selected'),
      toastVisible: toast && !toast.hidden,
      toastText: toast?.textContent,
    };
  });

  const passRejectThird = thirdGameState.thirdPressed === 'false' &&
    thirdGameState.thirdSelected === false &&
    thirdGameState.toastVisible &&
    thirdGameState.toastText.includes('Maksimal 2 game');
  await recordResult('Penolakan seleksi lebih dari 2 game memicu toast batasan (Mutasi M1)', passRejectThird, `Status game 3: ${thirdGameState.thirdPressed}, Toast: "${thirdGameState.toastText}"`, pageComp);

  // Test 4: Membuka modal komparasi mengaktifkan atribut inert pada latar belakang dan memfokuskan tombol tutup (Mutasi M2)
  await pageComp.focus('#comparison-open-btn');
  await pageComp.click('#comparison-open-btn');

  await pageComp.waitForFunction(() => {
    const dialog = document.getElementById('comparison-dialog');
    return dialog && !dialog.hidden;
  }, { timeout: 3000 });

  const modalOpenState = await pageComp.evaluate(() => {
    const appEl = document.querySelector('.app');
    const dialog = document.getElementById('comparison-dialog');
    const backdrop = document.getElementById('comparison-backdrop');
    const activeId = document.activeElement ? document.activeElement.id : null;
    return {
      hasInert: appEl?.hasAttribute('inert'),
      dialogVisible: dialog && !dialog.hidden,
      backdropVisible: backdrop && !backdrop.hidden,
      activeId,
    };
  });

  const passModalOpen = modalOpenState.hasInert === true &&
    modalOpenState.dialogVisible === true &&
    modalOpenState.backdropVisible === true &&
    modalOpenState.activeId === 'comparison-close-btn';
  await recordResult('Membuka modal komparasi mengaktifkan atribut inert pada latar belakang dan fokus pada tombol tutup (Mutasi M2)', passModalOpen, `Inert aktif: ${modalOpenState.hasInert}, Dialog tampil: ${modalOpenState.dialogVisible}, Fokus: ${modalOpenState.activeId}`, pageComp);

  // Test 5: Focus trap mengurung navigasi Tab di dalam modal komparasi
  const focusTrapState = await pageComp.evaluate(async () => {
    const dialog = document.getElementById('comparison-dialog');
    const closeBtn = document.getElementById('comparison-close-btn');

    // Dapatkan semua elemen interaktif yang terlihat di dalam modal
    const focusables = Array.from(dialog.querySelectorAll('button:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0 || el === closeBtn);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Coba Shift+Tab dari elemen pertama
    first.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const focusedAfterShiftTab = document.activeElement;

    // Coba Tab dari elemen terakhir
    last.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true }));
    const focusedAfterTab = document.activeElement;

    return {
      totalFocusables: focusables.length,
      firstTag: first.tagName,
      lastTag: last.tagName,
      wrappedToLast: focusedAfterShiftTab === last,
      wrappedToFirst: focusedAfterTab === first,
    };
  });

  const passFocusTrap = focusTrapState.totalFocusables >= 2 &&
    focusTrapState.wrappedToLast === true &&
    focusTrapState.wrappedToFirst === true;
  await recordResult('Focus trap mengurung navigasi Tab di dalam modal komparasi', passFocusTrap, `Elemen fokus: ${focusTrapState.totalFocusables}, Wrap first->last: ${focusTrapState.wrappedToLast}, Wrap last->first: ${focusTrapState.wrappedToFirst}`, pageComp);

  // Test 6: Sinkronisasi dua arah wishlist dari modal komparasi memperbarui state kartu chat dan drawer (Mutasi M5)
  // Klik tombol wishlist Game A (Hades) di dalam modal
  await pageComp.evaluate(() => {
    const modalWishlistBtns = document.querySelectorAll('.btn-modal-wishlist');
    if (modalWishlistBtns.length > 0) modalWishlistBtns[0].click();
  });

  const wishlistSyncState1 = await pageComp.evaluate(() => {
    const modalBtnA = document.querySelectorAll('.btn-modal-wishlist')[0];
    const cardBtnA = document.querySelector('#card-1 .btn-wishlist-toggle');
    const badge = document.getElementById('wishlist-badge')?.textContent;
    const wishlistStorage = JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]');
    const isSavedInStorage = wishlistStorage.some((g) => g.title === 'Hades');
    return {
      modalPressed: modalBtnA?.getAttribute('aria-pressed'),
      modalText: modalBtnA?.querySelector('.wishlist-btn-text')?.textContent,
      cardPressed: cardBtnA?.getAttribute('aria-pressed'),
      cardText: cardBtnA?.querySelector('.wishlist-btn-text')?.textContent,
      badge,
      isSavedInStorage,
    };
  });

  const passWishlistModalAdd = wishlistSyncState1.modalPressed === 'true' &&
    wishlistSyncState1.modalText === 'Tersimpan' &&
    wishlistSyncState1.cardPressed === 'true' &&
    wishlistSyncState1.cardText === 'Tersimpan' &&
    wishlistSyncState1.badge === '1' &&
    wishlistSyncState1.isSavedInStorage === true;

  // Klik sekali lagi untuk menghapus dari modal
  await pageComp.evaluate(() => {
    const modalWishlistBtns = document.querySelectorAll('.btn-modal-wishlist');
    if (modalWishlistBtns.length > 0) modalWishlistBtns[0].click();
  });

  const wishlistSyncState2 = await pageComp.evaluate(() => {
    const modalBtnA = document.querySelectorAll('.btn-modal-wishlist')[0];
    const cardBtnA = document.querySelector('#card-1 .btn-wishlist-toggle');
    const badge = document.getElementById('wishlist-badge')?.textContent;
    const wishlistStorage = JSON.parse(localStorage.getItem('steamscout_wishlist') || '[]');
    const isSavedInStorage = wishlistStorage.some((g) => g.title === 'Hades');
    return {
      modalPressed: modalBtnA?.getAttribute('aria-pressed'),
      cardPressed: cardBtnA?.getAttribute('aria-pressed'),
      badge,
      isSavedInStorage,
    };
  });

  const passWishlistModalRemove = wishlistSyncState2.modalPressed === 'false' &&
    wishlistSyncState2.cardPressed === 'false' &&
    wishlistSyncState2.badge === '0' &&
    wishlistSyncState2.isSavedInStorage === false;

  const passWishlistSync = passWishlistModalAdd && passWishlistModalRemove;
  await recordResult('Sinkronisasi dua arah wishlist dari modal komparasi memperbarui state kartu chat dan drawer (Mutasi M5)', passWishlistSync, `Tambah: cardPressed=${wishlistSyncState1.cardPressed}, badge=${wishlistSyncState1.badge}; Hapus: cardPressed=${wishlistSyncState2.cardPressed}, badge=${wishlistSyncState2.badge}`, pageComp);

  // Test 7: Penekanan tombol Escape menutup modal dan memulihkan fokus pemicu
  await pageComp.keyboard.press('Escape');

  await pageComp.waitForFunction(() => {
    const dialog = document.getElementById('comparison-dialog');
    return dialog && dialog.hidden;
  }, { timeout: 3000 });

  const escapeCloseState = await pageComp.evaluate(() => {
    const appEl = document.querySelector('.app');
    const dialog = document.getElementById('comparison-dialog');
    const backdrop = document.getElementById('comparison-backdrop');
    const activeId = document.activeElement ? document.activeElement.id : null;
    return {
      hasInert: appEl?.hasAttribute('inert'),
      dialogHidden: dialog?.hidden,
      backdropHidden: backdrop?.hidden,
      activeId,
    };
  });

  const passEscapeClose = escapeCloseState.hasInert === false &&
    escapeCloseState.dialogHidden === true &&
    escapeCloseState.backdropHidden === true &&
    escapeCloseState.activeId === 'comparison-open-btn';
  await recordResult('Penekanan tombol Escape menutup modal dan memulihkan fokus pemicu', passEscapeClose, `Inert dicabut: ${!escapeCloseState.hasInert}, Dialog hidden: ${escapeCloseState.dialogHidden}, Fokus kembali: ${escapeCloseState.activeId}`, pageComp);

  // Test 8: Menekan tombol bersihkan obrolan (reset chat) mengosongkan seleksi komparasi dan menyembunyikan floating bar (Mutasi M3)
  // Mock confirm dialog agar selalu setuju
  await pageComp.evaluate(() => {
    window.confirm = () => true;
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.click();
  });

  const resetState = await pageComp.evaluate(() => {
    const bar = document.getElementById('comparison-bar');
    const selectedBtns = document.querySelectorAll('.btn-compare-toggle.is-selected');
    const dialog = document.getElementById('comparison-dialog');
    return {
      barHidden: bar?.hidden,
      selectedCount: selectedBtns.length,
      dialogHidden: dialog?.hidden,
    };
  });

  const passResetClear = resetState.barHidden === true &&
    resetState.selectedCount === 0 &&
    resetState.dialogHidden === true;
  await recordResult('Reset obrolan mengosongkan seleksi komparasi dan menyembunyikan floating bar (Mutasi M3)', passResetClear, `Bar hidden: ${resetState.barHidden}, Seleksi tersisa: ${resetState.selectedCount}`, pageComp);

  await pageComp.close();
  activePage = null;

  // =========================================================================
  // PENGUJIAN PERILAKU MODUL P1: EKSPOR & IMPOR WISHLIST
  // =========================================================================
  log('\n--- UJI MODUL P1: EKSPOR DAN IMPOR WISHLIST ---');
  const pageExport = await browser.newPage();
  activePage = pageExport;
  await pageExport.setViewport({ width: 1366, height: 768 });

  // Inisialisasi storage dengan 2 game awal (lengkap dengan data genre)
  await pageExport.goto('http://localhost:3589', { waitUntil: 'networkidle0' });
  await pageExport.evaluate(() => {
    const initialList = [
      { appId: 1145360, title: 'Hades', addedAt: '2026-10-19T10:00:00.000Z', genres: ['Action', 'Roguelite'] },
      { appId: 588650, title: 'Dead Cells', addedAt: '2026-10-19T10:05:00.000Z', genres: ['Roguelite', 'Metroidvania'] },
    ];
    localStorage.setItem('steamscout_wishlist', JSON.stringify(initialList));
    const btn = document.getElementById('wishlist-btn');
    if (btn) btn.click();
  });

  await pageExport.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    return panel && !panel.hidden;
  }, { timeout: 3000 });

  // Test 9 (Test 27): Tombol salin markdown dan ekspor JSON wishlist memicu toast sukses
  const exportCopyState = await pageExport.evaluate(async () => {
    const copyBtn = document.getElementById('wishlist-copy-btn');
    if (copyBtn) copyBtn.click();
    await new Promise((r) => setTimeout(r, 80));
    const toast1 = document.querySelector('.wishlist-toast')?.textContent;

    const exportBtn = document.getElementById('wishlist-export-btn');
    if (exportBtn) exportBtn.click();
    await new Promise((r) => setTimeout(r, 80));
    const toast2 = document.querySelector('.wishlist-toast')?.textContent;

    return {
      copyToast: toast1,
      exportToast: toast2,
    };
  });

  const passExportCopy = (exportCopyState.copyToast && exportCopyState.copyToast.includes('Daftar game berhasil disalin')) ||
    (exportCopyState.exportToast && exportCopyState.exportToast.includes('Berhasil mengekspor 2 game'));
  await recordResult('Tombol salin markdown dan ekspor JSON wishlist memicu notifikasi toast sukses', Boolean(passExportCopy), `Toast salin: "${exportCopyState.copyToast}", Toast ekspor: "${exportCopyState.exportToast}"`, pageExport);

  // Test 10 (Test 28): Impor JSON wishlist memperbarui daftar game secara cerdas tanpa duplikasi
  await pageExport.evaluate(() => {
    const importPayload = JSON.stringify({
      version: '1.0',
      source: 'SteamScout',
      itemCount: 2,
      items: [
        { appId: 413150, title: 'Stardew Valley', addedAt: '2026-10-19T11:00:00.000Z', genres: ['Farming Sim', 'RPG'] },
        { appId: 1145360, title: 'Hades', addedAt: '2026-10-19T10:00:00.000Z', genres: ['Action', 'Roguelite'] },
      ],
    });

    const input = document.getElementById('wishlist-import-input');
    const file = new File([importPayload], 'steamscout_backup.json', { type: 'application/json' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await pageExport.waitForFunction(() => {
    const items = document.querySelectorAll('#wishlist-items .wishlist-item');
    return items.length >= 3;
  }, { timeout: 3000 });

  const finalImportState = await pageExport.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#wishlist-items .wishlist-item-title')).map((el) => el.textContent);
    const countText = document.getElementById('wishlist-drawer-count')?.textContent;
    const badgeText = document.getElementById('wishlist-badge')?.textContent;
    return {
      items,
      countText,
      badgeText,
    };
  });

  const passImport = finalImportState.items.includes('Stardew Valley') &&
    finalImportState.items.length === 3 &&
    finalImportState.countText === '(3/50)' &&
    finalImportState.badgeText === '3';
  await recordResult('Impor berkas JSON wishlist memperbarui daftar game secara cerdas tanpa duplikasi', passImport, `Total game: ${finalImportState.items.length}, Badge: ${finalImportState.badgeText}, Judul: ${JSON.stringify(finalImportState.items)}`, pageExport);

  // Test 11 (Test 29): Quick filter chips genre di drawer wishlist menyaring game sesuai genre aktif (Modul P2)
  const genreChipState = await pageExport.evaluate(async () => {
    const chipsContainer = document.getElementById('wishlist-genre-chips');
    const isVisible = chipsContainer && !chipsContainer.hidden;
    const chips = Array.from(document.querySelectorAll('#wishlist-genre-chips .wishlist-genre-chip'));
    const chipLabels = chips.map((c) => c.textContent);

    // 1. Klik chip "Roguelite"
    const rogueliteBtn = chips.find((c) => c.textContent.trim().toLowerCase() === 'roguelite');
    if (rogueliteBtn) rogueliteBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    const rogueliteItems = Array.from(document.querySelectorAll('#wishlist-items .wishlist-item-title')).map((el) => el.textContent);
    const activeChip1 = document.querySelector('#wishlist-genre-chips .wishlist-genre-chip.is-active')?.textContent?.trim().toLowerCase();
    const rogueliteActive = activeChip1 === 'roguelite';

    // 2. Klik chip "RPG"
    const rpgBtn = Array.from(document.querySelectorAll('#wishlist-genre-chips .wishlist-genre-chip')).find((c) => c.textContent.trim().toLowerCase() === 'rpg');
    if (rpgBtn) rpgBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    const rpgItems = Array.from(document.querySelectorAll('#wishlist-items .wishlist-item-title')).map((el) => el.textContent);
    const activeChip2 = document.querySelector('#wishlist-genre-chips .wishlist-genre-chip.is-active')?.textContent?.trim().toLowerCase();
    const rpgActive = activeChip2 === 'rpg';

    // 3. Klik chip "Semua" untuk mereset filter
    const allBtn = Array.from(document.querySelectorAll('#wishlist-genre-chips .wishlist-genre-chip')).find((c) => c.dataset.genre === 'all');
    if (allBtn) allBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    const allItems = Array.from(document.querySelectorAll('#wishlist-items .wishlist-item-title')).map((el) => el.textContent);
    const activeChip3 = document.querySelector('#wishlist-genre-chips .wishlist-genre-chip.is-active')?.textContent?.trim().toLowerCase();
    const allActive = activeChip3 === 'semua';

    return {
      isVisible,
      chipLabels,
      rogueliteItems,
      rogueliteActive,
      rpgItems,
      rpgActive,
      allItems,
      allActive,
    };
  });

  const passGenreChips = genreChipState.isVisible &&
    genreChipState.chipLabels.includes('Semua') &&
    genreChipState.chipLabels.includes('Roguelite') &&
    genreChipState.rogueliteActive &&
    genreChipState.rogueliteItems.length === 2 &&
    genreChipState.rogueliteItems.includes('Hades') &&
    genreChipState.rogueliteItems.includes('Dead Cells') &&
    genreChipState.rpgActive &&
    genreChipState.rpgItems.length === 1 &&
    genreChipState.rpgItems[0] === 'Stardew Valley' &&
    genreChipState.allActive &&
    genreChipState.allItems.length === 3;

  await recordResult(
    'Quick filter chips genre menyaring game wishlist secara dinamis dan responsif (Modul P2)',
    passGenreChips,
    `Chips: [${genreChipState.chipLabels.join(', ')}], Roguelite count: ${genreChipState.rogueliteItems.length}, RPG count: ${genreChipState.rpgItems.length}, All count: ${genreChipState.allItems.length}`,
    pageExport
  );

  await pageExport.close();
  activePage = null;

} catch (err) {
  logError(`\n[ERROR Verifikasi Perilaku] ${err.message}`);
  results.push({
    testName: 'Pengujian terhenti karena kesalahan fatal / timeout',
    passed: false,
    detail: err.message,
  });
  if (activePage && !activePage.isClosed()) {
    const errShotPath = path.join(screenshotDir, 'behavior_error.png');
    try {
      await activePage.screenshot({ path: errShotPath });
      logError(`Screenshot kesalahan disimpan di: ${path.relative(projectRoot, errShotPath)}`);
    } catch {}
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

log('\n====================================================');
log('RINGKASAN VERIFIKASI PERILAKU & AKSESIBILITAS:');
log('====================================================');
console.table(results);
try {
  fs.appendFileSync(logFile, JSON.stringify(results, null, 2) + '\n');
} catch {}

const allPassed = results.length >= 29 && results.every((r) => r.passed);
if (allPassed) {
  log('\nSEMUA UJI PERILAKU DOM LULUS 100%! Sistem stabil dan terbukti tangguh.\n');
  process.exit(0);
} else {
  logError('\nTerdapat pengujian perilaku yang gagal atau belum lengkap.\n');
  process.exit(1);
}

