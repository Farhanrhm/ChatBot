import { visualFixtures, buildMockChatRecommendationHtml } from './visualFixtures.js';

/**
 * Menyuntikkan kartu rekomendasi chat deterministik dari fixture terpusat ke area pesan.
 * Mematuhi status Mode Hemat Data serta menyinkronkan visibilitas #welcome, #chips, dan divider.
 * @param {import('@playwright/test').Page} page
 * @param {object} [customData]
 */
export async function renderMockChatRecommendation(page, customData = null) {
  const data = customData || visualFixtures.chatRecommendation;
  const isDataSaver = await page.evaluate(() =>
    Boolean(document.body && document.body.classList.contains('data-saver-active'))
  );
  const bubbleHtml = buildMockChatRecommendationHtml(data, { isDataSaver });

  await page.evaluate((html) => {
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');
    const chips = document.getElementById('chips');
    const divider = document.getElementById('toolbar-divider');
    const quickToolbar = document.getElementById('quick-toolbar');
    if (welcome) welcome.hidden = true;
    if (chips) chips.hidden = true;
    if (divider) divider.hidden = true;
    if (quickToolbar) quickToolbar.setAttribute('aria-label', 'Filter preferensi');

    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.innerHTML = html;
    messages.appendChild(botMsg);
  }, bubbleHtml);
}

/**
 * Mock respons sukses untuk /api/chat/stream (SSE) dan /api/chat (JSON).
 * @param {import('@playwright/test').Page} page
 * @param {object} [customData]
 */
export async function mockChatSuccess(page, customData = null) {
  const data = customData || visualFixtures.chatRecommendation;
  const introText = data.text || data.intro || 'Halo! Ini rekomendasi game PC terbaik untukmu:';

  const sseBody = `data: ${JSON.stringify({ chunk: JSON.stringify({ intro: introText }) })}\n\ndata: ${JSON.stringify({ done: true, data, result: JSON.stringify(data) })}\n\n`;

  await page.route('**/api/chat/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: sseBody,
    });
  });

  await page.route('**/api/chat', async (route) => {
    if (route.request().url().includes('/api/chat/stream')) {
      return route.fallback();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data,
        result: JSON.stringify(data),
      }),
    });
  });
}

/**
 * Mock respons error HTTP untuk /api/chat/stream dan /api/chat.
 * @param {import('@playwright/test').Page} page
 * @param {{ status: 429 | 500, message?: string, code?: string }} options
 */
export async function mockChatError(page, { status = 500, message = null, code = null } = {}) {
  const is429 = status === 429;
  const errorCode = code || (is429 ? 'RATE_LIMIT_EXCEEDED' : 'INTERNAL_SERVER_ERROR');
  const errorMessage =
    message ||
    (is429
      ? 'Terlalu banyak permintaan dalam waktu singkat. Mohon tunggu sebentar sebelum mengirim pesan lagi.'
      : 'Terjadi kesalahan pada server saat memproses streaming rekomendasi.');

  const errorPayload = {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      details: null,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  const responseBody = JSON.stringify(errorPayload);

  await page.route('**/api/chat/stream', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: responseBody,
    });
  });

  await page.route('**/api/chat', async (route) => {
    if (route.request().url().includes('/api/chat/stream')) {
      return route.fallback();
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: responseBody,
    });
  });
}

/**
 * Menyimulasikan stream yang menggantung (tidak pernah selesai) menggunakan page.addInitScript.
 * - Jika afterFirstChunk: true, stream mengirim chunk intro pertama lalu menggantung.
 * - Jika afterFirstChunk: false, stream langsung menggantung tanpa mengirim chunk apa pun.
 * Mencatat jumlah panggilan ke /api/chat/stream dan /api/chat (fallback).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ afterFirstChunk?: boolean, introText?: string }} [options]
 */
export async function mockStreamHang(page, { afterFirstChunk = false, introText = 'Game santai yang cocok untukmu:' } = {}) {
  await page.addInitScript(({ afterFirstChunk, introText }) => {
    window.__streamCallCount = 0;
    window.__fallbackPostCallCount = 0;

    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';

      if (url.includes('/api/chat/stream')) {
        window.__streamCallCount++;

        if (!afterFirstChunk) {
          // Gantung sebelum token pertama tiba
          return new Promise((resolve, reject) => {
            if (init?.signal) {
              if (init.signal.aborted) {
                return reject(new DOMException('Aborted', 'AbortError'));
              }
              init.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }
          });
        }

        // Gantung setelah token pertama terkirim
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const chunkPayload = `data: ${JSON.stringify({ chunk: JSON.stringify({ intro: introText }) })}\n\n`;
            controller.enqueue(encoder.encode(chunkPayload));

            if (init?.signal) {
              if (init.signal.aborted) {
                try { controller.error(init.signal.reason || new DOMException('Aborted', 'AbortError')); } catch {}
              } else {
                init.signal.addEventListener('abort', () => {
                  try { controller.error(init.signal.reason || new DOMException('Aborted', 'AbortError')); } catch {}
                });
              }
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      if (url.includes('/api/chat') && !url.includes('/api/chat/stream')) {
        window.__fallbackPostCallCount++;
      }

      return originalFetch.apply(this, arguments);
    };
  }, { afterFirstChunk, introText });
}

/**
 * Mendapatkan jumlah pemanggilan ke endpoint streaming /api/chat/stream.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getStreamCallCount(page) {
  return await page.evaluate(() => window.__streamCallCount || 0);
}

/**
 * Mendapatkan jumlah pemanggilan ke endpoint fallback /api/chat.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getFallbackCallCount(page) {
  return await page.evaluate(() => window.__fallbackPostCallCount || 0);
}
