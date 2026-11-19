import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { visualFixtures } from './visualFixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fontsFixtureDir = path.resolve(__dirname, '../fixtures/fonts');
const fontsCssPath = path.join(fontsFixtureDir, 'fonts.css');
const fontsCssContent = fs.existsSync(fontsCssPath) ? fs.readFileSync(fontsCssPath, 'utf8') : '';

/**
 * Memasang proteksi jaringan (network guards) pada halaman pengujian Playwright.
 * - Mengembalikan dummy PNG 1x1 untuk CDN Steam (*.steamstatic.com, *.akamaihd.net)
 * - Mengembalikan CSS @font-face lokal untuk fonts.googleapis.com
 * - Menyajikan berkas .woff2 lokal untuk fonts.gstatic.com
 * - Menyajikan mock data fixture chatRecommendation untuk /api/chat/stream (SSE) dan /api/chat (JSON)
 * - Menggagalkan pengujian jika ada request keluar ke host selain localhost/127.0.0.1 yang tidak di-mock
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installNetworkGuards(page) {
  page._unmockedExternalRequests = [];

  await page.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return route.continue();
    }

    const hostname = url.hostname.toLowerCase();

    // Data URI dan blob URI diizinkan secara lokal
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }

    // (a) CDN Steam -> Dummy PNG 1x1
    if (
      hostname.endsWith('steamstatic.com') ||
      hostname.endsWith('akamaihd.net') ||
      hostname === 'steamstatic.com' ||
      hostname === 'akamaihd.net'
    ) {
      const dummyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: dummyPng,
      });
    }

    // (b) Google Fonts CSS -> kembalikan CSS @font-face yang menunjuk ke fonts.gstatic.com
    if (hostname === 'fonts.googleapis.com') {
      return route.fulfill({
        status: 200,
        contentType: 'text/css; charset=utf-8',
        body: fontsCssContent,
      });
    }

    // (c) Google Fonts WOFF2 -> sajikan file .woff2 lokal dari fixtures/fonts
    if (hostname === 'fonts.gstatic.com') {
      const fontFileName = path.basename(url.pathname);
      const fontFilePath = path.join(fontsFixtureDir, fontFileName);

      if (fs.existsSync(fontFilePath)) {
        const fontBuffer = fs.readFileSync(fontFilePath);
        return route.fulfill({
          status: 200,
          contentType: 'font/woff2',
          body: fontBuffer,
        });
      }
    }

    // (d) /api/chat/stream (SSE) dan /api/chat (JSON)
    if (url.pathname === '/api/chat/stream') {
      const donePayload = {
        done: true,
        data: visualFixtures.chatRecommendation,
        result: JSON.stringify(visualFixtures.chatRecommendation),
      };
      const textChunk = JSON.stringify({
        chunk: JSON.stringify({ intro: visualFixtures.chatRecommendation.text }),
      });
      const sseBody = `data: ${textChunk}\n\ndata: ${JSON.stringify(donePayload)}\n\n`;

      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: sseBody,
      });
    }

    if (url.pathname === '/api/chat') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: JSON.stringify(visualFixtures.chatRecommendation),
          data: visualFixtures.chatRecommendation,
        }),
      });
    }

    // Izinkan seluruh request lokal ke backend aplikasi SobatSteam
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0'
    ) {
      return route.continue();
    }

    // (e) Menggagalkan tes bila ada request ke host selain localhost yang tidak di-mock
    const errorMsg = `[NetworkGuard] Request keluar tidak ter-mock terdeteksi: ${req.url()}`;
    page._unmockedExternalRequests.push(req.url());
    await route.abort('blockedbyclient');
    throw new Error(errorMsg);
  });
}
