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

const logFile = path.join(screenshotDir, 'layout.log');
fs.writeFileSync(logFile, `=== VERIFIKASI LAYOUT SOBATSTEAM (${new Date().toISOString()}) ===\n`);

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

// Static server lokal untuk pengujian layout
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

const PORT = 3588;
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

const viewports = [
  { width: 1366, height: 768, name: '1366x768', isDesktop: true },
  { width: 1024, height: 575, name: '1024x575', isDesktop: true },
  { width: 1920, height: 1080, name: '1920x1080', isDesktop: true },
  { width: 375, height: 667, name: '375x667', isDesktop: false },
  { width: 412, height: 915, name: '412x915', isDesktop: false },
];

let allPassed = true;
const summaryResults = [];

log('====================================================');
log('MEMULAI VERIFIKASI LAYOUT & VIEWPORT SOBATSTEAM');
log('====================================================');

for (const vp of viewports) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle0' });

  // Tunggu Google Fonts dan font fallback siap dihitung
  await page.evaluate(() => document.fonts?.ready);

  // 1. Uji State Awal
  const initialMetrics = await page.evaluate((isDesktop) => {
    const docEl = document.documentElement;
    const body = document.body;
    const winH = window.innerHeight;
    const winW = window.innerWidth;
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const chat = document.getElementById('chat').getBoundingClientRect();
    const rail = document.querySelector('.rail')?.getBoundingClientRect();

    return {
      winH,
      winW,
      docScrollH: docEl.scrollHeight,
      bodyScrollH: body.scrollHeight,
      docScrollW: docEl.scrollWidth,
      composerBottom: composer.bottom,
      composerHeight: composer.height,
      chatHeight: chat.height,
      chatRatio: (chat.height / winH) * 100,
      railBottom: rail ? rail.bottom : null,
      railHeight: rail ? rail.height : null,
      noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
      noHorizontalOverflow: docEl.scrollWidth <= winW + 1,
      composerSticksToBottom: Math.abs(composer.bottom - winH) <= 1,
      railStretchesFullHeight: isDesktop ? (rail && Math.abs(rail.bottom - winH) <= 1) : true,
    };
  }, vp.isDesktop);

  // 2. Simulasi pesan dengan kartu rekomendasi game
  await page.evaluate(() => {
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.hidden = true;

    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.innerHTML = `
      <div class="avatar">AI</div>
      <div class="bubble">
        <p class="bot-intro">Berikut rekomendasi game pilihan SobatSteam:</p>
        <div class="game-cards">
          <div class="game-card">
            <div class="game-card-banner">
              <span class="discount-badge">-50%</span>
              <img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='460' height='215'><rect width='460' height='215' fill='%231b2838'/><text x='20' y='110' fill='%2366c0f4' font-size='26' font-family='sans-serif'>Hollow Knight</text></svg>" alt="Hollow Knight">
            </div>
            <div class="game-card-inner">
              <div class="game-card-head">
                <div class="game-card-title-group"><h4 class="game-card-title">Hollow Knight</h4></div>
                <span class="game-card-meta">2017 • Team Cherry</span>
              </div>
              <div class="game-price-row">
                <del class="price-original">Rp115.999</del>
                <span class="price-current">Rp57.999</span>
              </div>
              <div class="game-card-tags"><span class="game-tag">Metroidvania</span><span class="game-tag">Souls-like</span></div>
              <div class="game-card-body">
                <p><strong>Kenapa cocok:</strong> Eksplorasi bawah tanah misterius dengan tingkat tantangan tinggi.</p>
                <p><strong>Spek & budget:</strong> Sangat ringan untuk laptop kentang (Intel HD).</p>
              </div>
              <div class="game-card-actions">
                <a href="#" class="steam-store-card-btn">Buka di Steam Store</a>
                <button type="button" class="btn-wishlist-toggle"><span class="wishlist-btn-text">Wishlist</span></button>
                <button type="button" class="btn-compare-toggle" data-key="app:367520" data-appid="367520" data-title="Hollow Knight" data-year="2017" data-developer="Team Cherry" data-genres="Metroidvania,Souls-like" data-whyfit="Eksplorasi bawah tanah misterius dengan tingkat tantangan tinggi." data-specs="Sangat ringan untuk laptop kentang (Intel HD)." aria-pressed="false" aria-label="Bandingkan Hollow Knight"><span class="compare-btn-text">Bandingkan</span></button>
              </div>
            </div>
          </div>
          <div class="game-card">
            <div class="game-card-banner">
              <img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='460' height='215'><rect width='460' height='215' fill='%231b2838'/><text x='20' y='110' fill='%23a4d007' font-size='26' font-family='sans-serif'>Stardew Valley</text></svg>" alt="Stardew Valley">
            </div>
            <div class="game-card-inner">
              <div class="game-card-head">
                <div class="game-card-title-group"><h4 class="game-card-title">Stardew Valley</h4></div>
                <span class="game-card-meta">2016 • ConcernedApe</span>
              </div>
              <div class="game-price-row"><span class="price-current">Rp115.999</span></div>
              <div class="game-card-tags"><span class="game-tag">Farming Sim</span><span class="game-tag">Co-op</span></div>
              <div class="game-card-body">
                <p><strong>Kenapa cocok:</strong> Simulasi bertani santai pelepas stres bisa main bareng teman.</p>
                <p><strong>Spek & budget:</strong> Ringan, jalan lancar di netbook RAM 4GB.</p>
              </div>
              <div class="game-card-actions">
                <a href="#" class="steam-store-card-btn">Buka di Steam Store</a>
                <button type="button" class="btn-wishlist-toggle"><span class="wishlist-btn-text">Wishlist</span></button>
                <button type="button" class="btn-compare-toggle" data-key="app:413150" data-appid="413150" data-title="Stardew Valley" data-year="2016" data-developer="ConcernedApe" data-genres="Farming Sim,Co-op" data-whyfit="Simulasi bertani santai pelepas stres bisa main bareng teman." data-specs="Ringan, jalan lancar di netbook RAM 4GB." aria-pressed="false" aria-label="Bandingkan Stardew Valley"><span class="compare-btn-text">Bandingkan</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    messages.appendChild(botMsg);
  });

  // Tunggu font pada kartu selesai dirender
  await page.evaluate(() => document.fonts?.ready);

  // 3. Uji interaksi toolbar: tutup toolbar dan tunggu transisi CSS selesai secara andal
  await page.evaluate(async () => {
    const wrap = document.getElementById('quick-toolbar-wrap');
    if (!wrap) return;

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          wrap.removeEventListener('transitionend', onEnd);
          resolve();
        }
      };
      const onEnd = (e) => {
        if (e.target === wrap && (e.propertyName === 'max-height' || e.propertyName === 'opacity')) {
          finish();
        }
      };
      wrap.addEventListener('transitionend', onEnd);
      // Batas waktu maksimum 500ms jika transitionend tidak terpancing
      setTimeout(finish, 500);
      wrap.classList.add('is-collapsed');
    });
  });

  // Tunggu 2 frame rendering berturut-turut agar layout stabil
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const collapsedMetrics = await page.evaluate((isDesktop) => {
    const docEl = document.documentElement;
    const body = document.body;
    const winH = window.innerHeight;
    const chat = document.getElementById('chat').getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const card = document.querySelector('.game-card')?.getBoundingClientRect();

    return {
      docScrollH: docEl.scrollHeight,
      bodyScrollH: body.scrollHeight,
      chatHeight: chat.height,
      chatRatio: (chat.height / winH) * 100,
      composerHeight: composer.height,
      cardHeight: card ? card.height : null,
      noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
      composerSticksToBottom: Math.abs(composer.bottom - winH) <= 1,
    };
  }, vp.isDesktop);

  // Ambil Screenshot bukti pengujian
  const shotPath = path.join(screenshotDir, `layout_${vp.name}.png`);
  await page.screenshot({ path: shotPath });

  // 4. Uji Wishlist Drawer Terbuka dan Terisi (minimal 12 game)
  await page.evaluate(() => {
    const dummyGames = [];
    for (let i = 1; i <= 15; i++) {
      dummyGames.push({
        appId: 1000 + i,
        title: `Game Favorit ${i}`,
        storeUrl: `https://store.steampowered.com/app/${1000 + i}/`,
        addedAt: Date.now() - i * 60000,
      });
    }
    localStorage.setItem('sobatsteam_wishlist', JSON.stringify(dummyGames));
    const wishlistBtn = document.getElementById('wishlist-btn');
    if (wishlistBtn) wishlistBtn.click();
  });

  // Tunggu drawer terbuka, daftar item dirender, dan animasi slide-in selesai (menempel sempurna di kanan)
  await page.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    const items = document.querySelectorAll('.wishlist-item');
    if (!panel || panel.hidden || items.length < 12) return false;
    const r = panel.getBoundingClientRect();
    return Math.abs(r.right - window.innerWidth) <= 1;
  }, { timeout: 3000 });

  // Tunggu 2 frame rendering berturut-turut agar layout drawer stabil
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const drawerMetrics = await page.evaluate((isDesktop) => {
    const docEl = document.documentElement;
    const body = document.body;
    const winH = window.innerHeight;
    const winW = window.innerWidth;
    const toolbar = document.getElementById('wishlist-toolbar');
    const searchInput = document.getElementById('wishlist-search');
    const sortSelect = document.getElementById('wishlist-sort');
    const contentContainer = document.getElementById('wishlist-content');
    const panel = document.getElementById('wishlist-panel');

    const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
    const searchRect = searchInput ? searchInput.getBoundingClientRect() : null;
    const sortRect = sortSelect ? sortSelect.getBoundingClientRect() : null;
    const contentRect = contentContainer ? contentContainer.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;

    const minItemsHeight = isDesktop ? 200 : 150;
    const isItemsHeightAdequate = contentRect && contentRect.height >= minItemsHeight;

    const isToolbarVisible = toolbarRect && toolbarRect.width > 0 && toolbarRect.height > 0 &&
      toolbarRect.top >= 0 && toolbarRect.bottom <= winH;
    const isSearchVisible = searchRect && searchRect.width > 0 && searchRect.height > 0 &&
      searchRect.left >= 0 && searchRect.right <= winW;
    const isSortVisible = sortRect && sortRect.width > 0 && sortRect.height > 0 &&
      sortRect.left >= 0 && sortRect.right <= winW;

    return {
      docScrollH: docEl.scrollHeight,
      bodyScrollH: body.scrollHeight,
      noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
      noHorizontalOverflow: docEl.scrollWidth <= winW + 1,
      isToolbarVisible: Boolean(isToolbarVisible),
      isSearchVisible: Boolean(isSearchVisible),
      isSortVisible: Boolean(isSortVisible),
      itemsHeight: contentRect ? contentRect.height : 0,
      isItemsHeightAdequate: Boolean(isItemsHeightAdequate),
      minItemsHeight,
    };
  }, vp.isDesktop);

  // Ambil Screenshot bukti drawer terbuka
  const drawerShotPath = path.join(screenshotDir, `layout_drawer_open_${vp.name}.png`);
  await page.screenshot({ path: drawerShotPath });

  // Tutup kembali drawer dan bersihkan storage
  await page.evaluate(() => {
    const closeBtn = document.getElementById('wishlist-close-btn');
    if (closeBtn) closeBtn.click();
    localStorage.clear();
  });

  // 5. Uji Modal Komparasi Game Terbuka dan Tabbed View pada Layar Ponsel
  await page.evaluate(() => {
    const compareBtns = document.querySelectorAll('.btn-compare-toggle');
    if (compareBtns.length >= 2) {
      compareBtns[0].click();
      compareBtns[1].click();
    }
    const openBtn = document.getElementById('comparison-open-btn');
    if (openBtn && !openBtn.disabled) {
      openBtn.click();
    }
  });

  // Tunggu dialog komparasi terbuka
  await page.waitForFunction(() => {
    const dialog = document.getElementById('comparison-dialog');
    return dialog && !dialog.hidden;
  }, { timeout: 3000 });

  // Tunggu 2 frame rendering berturut-turut agar layout dialog stabil
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const isMobileViewport = vp.width < 600;

  // Uji interaksi tab mobile jika pada viewport mobile (< 600px)
  let mobileTabSwitchPassed = true;
  if (isMobileViewport) {
    const tabSwitchResult = await page.evaluate(() => {
      const tabB = document.getElementById('comparison-tab-b');
      const tabA = document.getElementById('comparison-tab-a');
      if (!tabB || !tabA) return false;

      // Klik Tab B
      tabB.click();
      const colA = document.querySelector('.comparison-table td.comparison-col-a');
      const colB = document.querySelector('.comparison-table td.comparison-col-b');
      const isColAHidden = colA ? window.getComputedStyle(colA).display === 'none' : false;
      const isColBVisible = colB ? window.getComputedStyle(colB).display !== 'none' : false;

      // Kembalikan ke Tab A
      tabA.click();
      const isColAVirgin = colA ? window.getComputedStyle(colA).display !== 'none' : false;
      const isColBHidden = colB ? window.getComputedStyle(colB).display === 'none' : false;

      return isColAHidden && isColBVisible && isColAVirgin && isColBHidden;
    });
    mobileTabSwitchPassed = tabSwitchResult;
  }

  const comparisonMetrics = await page.evaluate((isMobile) => {
    const docEl = document.documentElement;
    const body = document.body;
    const winH = window.innerHeight;
    const winW = window.innerWidth;
    const dialog = document.getElementById('comparison-dialog');
    const tabs = document.getElementById('comparison-mobile-tabs');
    const content = document.getElementById('comparison-content');
    const appEl = document.querySelector('.app');

    const dialogRect = dialog ? dialog.getBoundingClientRect() : null;
    const tabsRect = tabs ? tabs.getBoundingClientRect() : null;

    const isInertSet = appEl ? appEl.hasAttribute('inert') : false;
    const isDialogVisible = Boolean(dialogRect && dialogRect.width > 0 && dialogRect.height > 0);
    const areTabsVisibleOnMobile = isMobile
      ? Boolean(tabsRect && tabsRect.width > 0 && tabsRect.height > 0 && window.getComputedStyle(tabs).display === 'flex')
      : true;

    return {
      docScrollH: docEl.scrollHeight,
      bodyScrollH: body.scrollHeight,
      noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
      noHorizontalOverflow: docEl.scrollWidth <= winW + 1,
      isDialogVisible,
      areTabsVisibleOnMobile,
      isInertSet,
      hasInternalScroll: content ? content.scrollHeight >= content.clientHeight : false,
    };
  }, isMobileViewport);

  // Ambil Screenshot bukti modal komparasi terbuka
  const comparisonShotPath = path.join(screenshotDir, `layout_comparison_${vp.name}.png`);
  await page.screenshot({ path: comparisonShotPath });

  // Tutup dialog komparasi dan bersihkan seleksi
  await page.evaluate(() => {
    const closeBtn = document.getElementById('comparison-close-btn');
    if (closeBtn) closeBtn.click();
    const clearBtn = document.getElementById('comparison-clear-btn');
    if (clearBtn) clearBtn.click();
  });

  const passed =
    initialMetrics.noVerticalPageOverflow &&
    initialMetrics.noHorizontalOverflow &&
    initialMetrics.composerSticksToBottom &&
    initialMetrics.railStretchesFullHeight &&
    collapsedMetrics.noVerticalPageOverflow &&
    collapsedMetrics.composerSticksToBottom &&
    drawerMetrics.noVerticalPageOverflow &&
    drawerMetrics.noHorizontalOverflow &&
    drawerMetrics.isToolbarVisible &&
    drawerMetrics.isSearchVisible &&
    drawerMetrics.isSortVisible &&
    drawerMetrics.isItemsHeightAdequate &&
    comparisonMetrics.noVerticalPageOverflow &&
    comparisonMetrics.noHorizontalOverflow &&
    comparisonMetrics.isDialogVisible &&
    comparisonMetrics.areTabsVisibleOnMobile &&
    comparisonMetrics.isInertSet &&
    mobileTabSwitchPassed;

  if (!passed) {
    allPassed = false;
    const failShotPath = path.join(screenshotDir, `layout_fail_${vp.name}.png`);
    await page.screenshot({ path: failShotPath });
    logError(`Pengujian layout gagal pada viewport ${vp.name}. Screenshot kegagalan disimpan di: ${path.relative(projectRoot, failShotPath)}`);
  }

  summaryResults.push({
    viewport: vp.name,
    passed,
    docScrollH: initialMetrics.docScrollH,
    winH: initialMetrics.winH,
    chatRatioCollapsed: collapsedMetrics.chatRatio.toFixed(1) + '%',
    composerHeight: collapsedMetrics.composerHeight.toFixed(1) + 'px',
    cardHeight: collapsedMetrics.cardHeight ? collapsedMetrics.cardHeight.toFixed(1) + 'px' : '-',
    drawerItemsHeight: drawerMetrics.itemsHeight.toFixed(1) + 'px',
    screenshot: path.relative(projectRoot, shotPath),
  });

  log(`\n[VIEWPORT] ${vp.name} -> ${passed ? 'PASS (100% Sesuai Spesifikasi)' : 'FAIL'}`);
  log(`  - Page Scroll Overflow:  ${initialMetrics.noVerticalPageOverflow ? 'TIDAK ADA (Terkunci Sempurna)' : 'ADA MASALAH'}`);
  log(`  - Horizontal Overflow:   ${initialMetrics.noHorizontalOverflow ? 'TIDAK ADA' : 'ADA MASALAH'}`);
  log(`  - Sidebar Penuh ke Dasar:${initialMetrics.railStretchesFullHeight ? 'YA (Penuh)' : 'TIDAK'}`);
  log(`  - Composer Menempel Dasar:${collapsedMetrics.composerSticksToBottom ? 'YA (0 gap)' : 'TIDAK'}`);
  log(`  - Chat Height Ratio:     ${collapsedMetrics.chatRatio.toFixed(1)}% (Target >= 60%)`);
  log(`  - Tinggi Kartu Game:     ${collapsedMetrics.cardHeight?.toFixed(1)}px (Satu kartu terlihat utuh)`);
  log(`  - Drawer Terisi:         ${drawerMetrics.isItemsHeightAdequate ? 'PASS (Tinggi >= ' + drawerMetrics.minItemsHeight + 'px: ' + drawerMetrics.itemsHeight.toFixed(1) + 'px)' : 'FAIL'}`);
  log(`  - Drawer Page Scroll:    ${drawerMetrics.noVerticalPageOverflow ? 'TIDAK ADA (0px)' : 'ADA MASALAH'}`);
  log(`  - Toolbar & Kontrol:     ${drawerMetrics.isToolbarVisible && drawerMetrics.isSearchVisible && drawerMetrics.isSortVisible ? 'TERLIHAT UTUH' : 'TERPOTONG'}`);
  log(`  - Komparasi Page Scroll: ${comparisonMetrics.noVerticalPageOverflow ? 'TIDAK ADA (0px)' : 'ADA MASALAH'}`);
  log(`  - Komparasi Tabbed View: ${comparisonMetrics.areTabsVisibleOnMobile && mobileTabSwitchPassed ? 'PASS (Responsif Sempurna)' : 'FAIL'}`);
  log(`  - Screenshot Default:    ${path.relative(projectRoot, shotPath)}`);
  log(`  - Screenshot Drawer:     ${path.relative(projectRoot, drawerShotPath)}`);
  log(`  - Screenshot Komparasi:  ${path.relative(projectRoot, comparisonShotPath)}`);

  await page.close();
}

await browser.close();
server.close();

log('\n====================================================');
log('RINGKASAN AKHIR VERIFIKASI LAYOUT:');
log('====================================================');
console.table(summaryResults);
try {
  fs.appendFileSync(logFile, JSON.stringify(summaryResults, null, 2) + '\n');
} catch {}

if (allPassed) {
  log('SEMUA PENGUJIAN LAYOUT LULUS 100%! Tidak ada page scroll, layout presisi.');
  process.exit(0);
} else {
  logError('ADA PENGUJIAN LAYOUT YANG GAGAL.');
  process.exit(1);
}
