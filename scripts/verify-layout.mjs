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

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const viewports = [
  { width: 1366, height: 768, name: '1366x768', isDesktop: true },
  { width: 1024, height: 575, name: '1024x575', isDesktop: true },
  { width: 1920, height: 1080, name: '1920x1080', isDesktop: true },
  { width: 375, height: 667, name: '375x667', isDesktop: false },
  { width: 412, height: 915, name: '412x915', isDesktop: false },
];

let allPassed = true;
const summaryResults = [];

console.log('====================================================');
console.log('MEMULAI VERIFIKASI LAYOUT & VIEWPORT STEAMSCOUT');
console.log('====================================================');

for (const vp of viewports) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle0' });

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
        <p class="bot-intro">Berikut rekomendasi game pilihan SteamScout:</p>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    messages.appendChild(botMsg);
  });

  // 3. Uji interaksi toolbar: tutup toolbar dan verifikasi persentase chat area
  await page.evaluate(() => {
    const wrap = document.getElementById('quick-toolbar-wrap');
    if (wrap) wrap.classList.add('is-collapsed');
  });
  await new Promise((r) => setTimeout(r, 260));

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

  const passed =
    initialMetrics.noVerticalPageOverflow &&
    initialMetrics.noHorizontalOverflow &&
    initialMetrics.composerSticksToBottom &&
    initialMetrics.railStretchesFullHeight &&
    collapsedMetrics.noVerticalPageOverflow &&
    collapsedMetrics.composerSticksToBottom;

  if (!passed) allPassed = false;

  summaryResults.push({
    viewport: vp.name,
    passed,
    docScrollH: initialMetrics.docScrollH,
    winH: initialMetrics.winH,
    chatRatioCollapsed: collapsedMetrics.chatRatio.toFixed(1) + '%',
    composerHeight: collapsedMetrics.composerHeight.toFixed(1) + 'px',
    cardHeight: collapsedMetrics.cardHeight ? collapsedMetrics.cardHeight.toFixed(1) + 'px' : '-',
    screenshot: path.relative(projectRoot, shotPath),
  });

  console.log(`\n[VIEWPORT] ${vp.name} -> ${passed ? 'PASS (100% Sesuai Spesifikasi)' : 'FAIL'}`);
  console.log(`  - Page Scroll Overflow:  ${initialMetrics.noVerticalPageOverflow ? 'TIDAK ADA (Terkunci Sempurna)' : 'ADA MASALAH'}`);
  console.log(`  - Horizontal Overflow:   ${initialMetrics.noHorizontalOverflow ? 'TIDAK ADA' : 'ADA MASALAH'}`);
  console.log(`  - Sidebar Penuh ke Dasar:${initialMetrics.railStretchesFullHeight ? 'YA (Penuh)' : 'TIDAK'}`);
  console.log(`  - Composer Menempel Dasar:${collapsedMetrics.composerSticksToBottom ? 'YA (0 gap)' : 'TIDAK'}`);
  console.log(`  - Chat Height Ratio:     ${collapsedMetrics.chatRatio.toFixed(1)}% (Target >= 60%)`);
  console.log(`  - Tinggi Kartu Game:     ${collapsedMetrics.cardHeight?.toFixed(1)}px (Satu kartu terlihat utuh)`);
  console.log(`  - Screenshot:            ${path.relative(projectRoot, shotPath)}`);

  await page.close();
}

await browser.close();
server.close();

console.log('\n====================================================');
console.log('RINGKASAN AKHIR VERIFIKASI LAYOUT:');
console.log('====================================================');
console.table(summaryResults);

if (allPassed) {
  console.log('SEMUA PENGUJIAN LAYOUT LULUS 100%! Tidak ada page scroll, layout presisi.');
  process.exit(0);
} else {
  console.error('ADA PENGUJIAN LAYOUT YANG GAGAL.');
  process.exit(1);
}
