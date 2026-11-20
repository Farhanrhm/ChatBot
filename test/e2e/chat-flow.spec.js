import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import { installNetworkGuards } from './helpers/network.js';
import {
  mockChatSuccess,
  mockChatError,
  mockStreamHang,
  getStreamCallCount,
  getFallbackCallCount,
} from './helpers/mockChat.js';
import { visualFixtures } from './helpers/visualFixtures.js';

test.describe('Chat Flow & Perilaku SobatSteam', () => {
  test.beforeEach(async ({ page }) => {
    await installNetworkGuards(page);
  });

  // ==========================================================================
  // [B03] & [B04] Mode Offline & Online Recovery
  // ==========================================================================
  test('[B03] Mode offline menonaktifkan tombol Kirim dan menjaga teks input', async ({ context, page }) => {
    await page.goto('/');

    const input = page.locator('#user-input');
    const sendBtn = page.locator('#send-btn');
    const banner = page.locator('#offline-banner');

    await input.fill('Game rekomendasi laptop kentang');
    const textBefore = await input.inputValue();

    // Simulasikan jaringan terputus (offline)
    await context.setOffline(true);

    await expect(sendBtn).toBeDisabled();
    await expect(sendBtn).toHaveAttribute('aria-disabled', 'true');
    await expect(banner).toBeVisible();
    await expect(input).toHaveValue(textBefore);
  });

  test('[B04] Kembali online mengaktifkan kontrol dan teks input tetap utuh', async ({ context, page }) => {
    await page.goto('/');

    const input = page.locator('#user-input');
    const sendBtn = page.locator('#send-btn');
    const banner = page.locator('#offline-banner');

    await input.fill('Game rekomendasi laptop kentang');
    const textBefore = await input.inputValue();

    // Masuk mode offline terlebih dahulu
    await context.setOffline(true);
    await expect(banner).toBeVisible();
    await expect(sendBtn).toBeDisabled();

    // Pulihkan status koneksi online
    await context.setOffline(false);

    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).not.toHaveAttribute('aria-disabled');
    await expect(banner).toBeHidden();
    await expect(input).toHaveValue(textBefore);
  });

  // ==========================================================================
  // [B16], [B17], [B18] Watchdog Streaming & Mekanisme Coba Lagi
  // ==========================================================================
  test('[B16] Watchdog sebelum token pertama: stream macet fallback otomatis ke POST /api/chat', async ({ page }) => {
    // Percepat batas waktu watchdog agar pengujian deterministik dan cepat (< 1 detik)
    await page.addInitScript(() => {
      window.__STREAM_FIRST_TIMEOUT_MS = 400;
      window.__STREAM_INTER_TIMEOUT_MS = 250;
    });

    // Pasang stream hanging sebelum chunk pertama
    await mockStreamHang(page, { afterFirstChunk: false });

    // Mock endpoint fallback POST /api/chat
    await page.route('**/api/chat', async (route) => {
      if (route.request().url().includes('/api/chat/stream')) {
        return route.fallback();
      }
      await route.fulfill({
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
    });

    await page.goto('/');
    await page.locator('#user-input').fill('Cari game santai');
    await page.locator('#send-btn').click();

    // Tunggu balasan dari fallback POST muncul di layar obrolan
    const botMsg = page.locator('.msg.bot');
    await expect(botMsg).toContainText('Rekomendasi hasil fallback POST berhasil.');

    const streamCount = await getStreamCallCount(page);
    const fallbackCount = await getFallbackCallCount(page);
    expect(streamCount).toBeGreaterThanOrEqual(1);
    expect(fallbackCount).toBeGreaterThanOrEqual(1);
  });

  test('[B17] Watchdog di tengah stream: pertahankan teks parsial, larang fallback diam-diam, sediakan tombol Coba lagi', async ({ page }) => {
    await page.addInitScript(() => {
      window.__STREAM_FIRST_TIMEOUT_MS = 800;
      window.__STREAM_INTER_TIMEOUT_MS = 300;
    });

    await mockStreamHang(page, {
      afterFirstChunk: true,
      introText: 'Game santai yang cocok untukmu:',
    });

    await page.goto('/');
    await page.locator('#user-input').fill('Game santai');
    await page.locator('#send-btn').click();

    // Verifikasi teks intro parsial tampil dan dipertahankan
    const botIntro = page.locator('.msg.bot .bot-intro');
    await expect(botIntro).toContainText('Game santai yang cocok untukmu:');

    // Verifikasi notifikasi koneksi terputus dan tombol coba lagi muncul
    const notice = page.locator('.stream-disconnected-notice');
    const retryBtn = page.locator('.btn-retry-stream');
    const sendBtn = page.locator('#send-btn');

    await expect(notice).toBeVisible();
    await expect(retryBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();

    // Larang fallback diam-diam ke POST /api/chat
    const fallbackCount = await getFallbackCallCount(page);
    expect(fallbackCount).toBe(0);
  });

  test('[B18] Tombol Coba lagi tidak menambah pesan user ganda', async ({ page }) => {
    await page.addInitScript(() => {
      window.__STREAM_FIRST_TIMEOUT_MS = 800;
      window.__STREAM_INTER_TIMEOUT_MS = 300;
    });

    await mockStreamHang(page, {
      afterFirstChunk: true,
      introText: 'Game santai yang cocok untukmu:',
    });

    await page.goto('/');
    await page.locator('#user-input').fill('Game santai');
    await page.locator('#send-btn').click();

    const retryBtn = page.locator('.btn-retry-stream');
    await expect(retryBtn).toBeVisible();

    const userMsgs = page.locator('.msg.user');
    await expect(userMsgs).toHaveCount(1);

    // Klik tombol Coba lagi
    await retryBtn.click();

    // Permintaan stream baru harus dikirimkan (total >= 2)
    await expect.poll(async () => await getStreamCallCount(page)).toBeGreaterThanOrEqual(2);

    // Jumlah pesan user di layar harus tetap 1 (tidak terduplikasi)
    await expect(userMsgs).toHaveCount(1);
  });

  // ==========================================================================
  // [B30] PWA & Deteksi Status Offline (Modul P3)
  // ==========================================================================
  test('[B30] PWA & deteksi status offline menonaktifkan komposer teks dan memunculkan banner (Modul P3)', async ({ context, page }) => {
    await page.goto('/');

    // 1. Verifikasi referensi manifest PWA
    const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestLink).toBe('manifest.json');

    const manifestPath = path.resolve('public', 'manifest.json');
    const manifestObj = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifestObj.short_name).toBe('SobatSteam');
    expect(manifestObj.name).toBe('SobatSteam: Teman Ngobrol Cari Game PC');

    const banner = page.locator('#offline-banner');
    const statusPill = page.locator('#connection-status');
    const sendBtn = page.locator('#send-btn');
    const input = page.locator('#user-input');

    // 2. Putuskan jaringan
    await context.setOffline(true);

    await expect(banner).toBeVisible();
    await expect(statusPill).toContainText('Offline');
    await expect(statusPill).toHaveClass(/is-offline/);
    await expect(sendBtn).toBeDisabled();
    await expect(sendBtn).toHaveAttribute('title', /Koneksi terputus/);

    // 3. Coba kirim pesan saat offline
    await input.fill('Rekomendasi game RPG');
    await page.evaluate(() => {
      const form = document.getElementById('chat-form');
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    const toast = page.locator('.wishlist-toast');
    await expect(toast).toContainText('Koneksi terputus');

    // 4. Pulihkan koneksi jaringan online
    await context.setOffline(false);

    await expect(banner).toBeHidden();
    await expect(statusPill).toContainText('Online');
    await expect(statusPill).not.toHaveClass(/is-offline/);
    await expect(sendBtn).toBeEnabled();
  });

  // ==========================================================================
  // [B31] Riwayat Obrolan Multi-Sesi via IndexedDB (Modul P4)
  // ==========================================================================
  test('[B31] Riwayat obrolan multi-sesi IndexedDB mendukung pembuatan, perpindahan, dan pemulihan konteks pesan (Modul P4)', async ({ page }) => {
    // Bersihkan storage dan basis data sebelum pengujian
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        indexedDB.deleteDatabase('SteamScoutDB');
      } catch {}
    });

    await page.goto('/');
    const sessionsList = page.locator('#sessions-list');
    const newSessionBtn = page.locator('#new-session-btn');
    const input = page.locator('#user-input');
    const sendBtn = page.locator('#send-btn');
    const messages = page.locator('#messages');
    const welcome = page.locator('#welcome');

    // 1. Sesi awal yang masih kosong tidak masuk ke daftar riwayat sesi
    await expect(sessionsList.locator('.session-item')).toHaveCount(0);

    // 2. Kirim pesan ke sesi pertama
    await input.fill('Rekomendasi game roguelite aksi');
    await sendBtn.click();

    // Tunggu respon bot dan pembaruan judul sesi di sidebar via polling
    await expect(messages.locator('.msg.bot')).toBeVisible();
    await expect.poll(async () => await sessionsList.locator('.session-item').count()).toBe(1);

    const activeSessionItem = sessionsList.locator('.session-item.is-active');
    await expect(activeSessionItem.locator('.session-item-title')).toContainText('roguelite');

    // 3. Tekan tombol "+ Baru" untuk menyiapkan sesi kedua yang kosong
    await newSessionBtn.click();

    // Sesi baru yang masih kosong tidak menambah entri riwayat
    await expect(sessionsList.locator('.session-item')).toHaveCount(1);
    await expect(messages.locator('.msg')).toHaveCount(0);
    await expect(welcome).toBeVisible();

    // 4. Konfigurasi respons berbeda untuk sesi kedua
    await mockChatSuccess(page, {
      intro: 'Berikut rekomendasi game simulator santai:',
      games: [
        {
          title: 'PowerWash Simulator',
          year: '2022',
          priceFormatted: 'Rp 200.000',
          ratingPercent: 97,
          steamUrl: 'https://store.steampowered.com/app/1290000/',
          headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1290000/header.jpg',
        },
      ],
      text: 'Berikut rekomendasi game simulator santai:',
    });

    await input.fill('Game simulator santai');
    await sendBtn.click();

    // Verifikasi sesi kedua tersimpan di riwayat
    await expect(messages.locator('.msg.bot')).toBeVisible();
    await expect.poll(async () => await sessionsList.locator('.session-item').count()).toBe(2);

    const session2Item = sessionsList.locator('.session-item.is-active');
    await expect(session2Item.locator('.session-item-title')).toContainText('simulator');

    // 5. Beralih kembali ke sesi pertama
    const firstSessionBtn = sessionsList.locator('.session-item-title', { hasText: 'roguelite' });
    await firstSessionBtn.click();

    // Pesan dari sesi pertama harus dipulihkan secara utuh
    await expect(messages.locator('.msg.user')).toContainText('roguelite');
    await expect(messages.locator('.msg.bot')).toBeVisible();
  });

  // ==========================================================================
  // [B32] Ubah Nama Sesi, Tombol Salin Pesan, & Skeleton Loader
  // ==========================================================================
  test('[B32] Fitur Ubah Nama Sesi, Tombol Salin Pesan, dan Skeleton Loader berfungsi sesuai spesifikasi', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');

    // 1. Suntikkan sesi aktif ke dalam obrolan
    await page.locator('#user-input').fill('Rekomendasi roguelite seru');
    await page.locator('#send-btn').click();
    await expect(page.locator('.msg.bot')).toBeVisible();

    // 2. Ubah Nama Sesi melalui modal kustom aplikasi
    const activeItem = page.locator('#sessions-list .session-item.is-active');
    const renameBtn = activeItem.locator('.btn-session-rename');
    await renameBtn.click();

    const actionDialog = page.locator('#session-action-dialog');
    const renameInput = page.locator('#session-rename-input');
    await expect(actionDialog).toBeVisible();
    await expect(renameInput).toBeFocused();
    await renameInput.fill('Koleksi Roguelite Seru');
    await page.locator('#session-action-confirm-btn').click();

    await expect(actionDialog).toBeHidden();
    await expect(activeItem.locator('.session-item-title')).toContainText('Koleksi Roguelite Seru');

    // 3. Tombol Salin Pesan Bot
    const copyBtn = page.locator('.msg.bot .btn-copy-msg').first();
    await expect(copyBtn).toBeVisible();

    await copyBtn.click();
    await expect(copyBtn).toHaveClass(/is-copied/);
    const copyLabel = copyBtn.locator('.copy-label');
    await expect(copyLabel).toContainText('Tersalin!');

    // 4. Skeleton Loader Kerangka Muat
    const hasSkeleton = await page.evaluate(() => {
      const dummy = typeof window.createTypingIndicator === 'function' ? window.createTypingIndicator() : null;
      return Boolean(dummy?.querySelector('.skeleton-card'));
    });
    expect(hasSkeleton).toBe(true);
  });

  // ==========================================================================
  // [B33], [B34], [B35] Mode Hemat Data (Data Saver)
  // ==========================================================================
  test('[B33] Mode Hemat Data: Tombol toggle memperbarui role switch, aria-checked, kelas body, dan live-announcer', async ({ page }) => {
    await page.goto('/');

    const btn = page.locator('#data-saver-btn');
    const announcer = page.locator('#live-announcer');
    const body = page.locator('body');

    await expect(btn).toHaveAttribute('role', 'switch');
    await expect(btn).toHaveAttribute('aria-checked', 'false');
    await expect(body).not.toHaveClass(/data-saver-active/);

    // Klik untuk mengaktifkan
    await btn.click();

    await expect(btn).toHaveAttribute('aria-checked', 'true');
    await expect(body).toHaveClass(/data-saver-active/);
    await expect(announcer).toContainText('Mode hemat data');
    const activeStored = await page.evaluate(() => localStorage.getItem('sobatsteam_data_saver'));
    expect(activeStored).toBe('true');

    // Klik lagi untuk menonaktifkan
    await btn.click();

    await expect(btn).toHaveAttribute('aria-checked', 'false');
    await expect(body).not.toHaveClass(/data-saver-active/);
    const deactiveStored = await page.evaluate(() => localStorage.getItem('sobatsteam_data_saver'));
    expect(deactiveStored).toBe('false');
  });

  test('[B34] Mode Hemat Data: Verifikasi level jaringan tepat 0 request HTTP ke CDN Steam saat mode aktif', async ({ page }) => {
    const steamRequests = [];
    page.on('request', (req) => {
      if (/steamstatic\.com|akamaihd\.net/.test(req.url())) {
        steamRequests.push(req.url());
      }
    });

    await page.goto('/');

    const renderResult = await page.evaluate(() => {
      window.setDataSaverMode(true);
      const steamUrlA = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/105600/header.jpg';
      const steamUrlB = 'https://cdn.akamai.steamstatic.com/steam/apps/210970/header.jpg';

      const testWrap = document.createElement('div');
      testWrap.id = 'data-saver-network-test';
      testWrap.innerHTML = `
        ${window.renderCoverImage(steamUrlA, 'Cover Game A', 'test-hero-a')}
        ${window.renderCoverImage(steamUrlB, 'Cover Game B', 'test-hero-b')}
      `;
      document.body.appendChild(testWrap);

      return {
        placeholderCount: testWrap.querySelectorAll('.cover-placeholder').length,
        directSteamImgCount: testWrap.querySelectorAll('img[src*="steamstatic.com"]').length,
      };
    });

    expect(renderResult.placeholderCount).toBe(2);
    expect(renderResult.directSteamImgCount).toBe(0);
    expect(steamRequests).toHaveLength(0);
  });

  test('[B35] Mode Hemat Data: Request gambar Steam CDN kembali diizinkan saat mode hemat data dinonaktifkan', async ({ page }) => {
    const steamRequests = [];
    page.on('request', (req) => {
      if (/steamstatic\.com|akamaihd\.net/.test(req.url())) {
        steamRequests.push(req.url());
      }
    });

    await page.goto('/');

    await page.evaluate(() => {
      window.setDataSaverMode(false);
      const testWrap = document.createElement('div');
      testWrap.id = 'data-saver-normal-test';
      testWrap.innerHTML = window.renderCoverImage(
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/header.jpg',
        'Cover Dota 2',
        'normal-cover'
      );
      document.body.appendChild(testWrap);
    });

    await expect.poll(() => steamRequests.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // [N01] & [N02] Penanganan Error HTTP Streaming (429 & 500)
  // ==========================================================================
  test('[N01] Penanganan error HTTP 429 pada stream otomatis fallback ke POST /api/chat dan menampilkan bubble error rate limit', async ({ page }) => {
    await mockChatError(page, {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Terlalu banyak permintaan dalam waktu singkat. Mohon tunggu sebentar sebelum mengirim pesan lagi.',
    });

    await page.goto('/');
    await page.locator('#user-input').fill('Rekomendasi game santai');
    await page.locator('#send-btn').click();

    // Verifikasi bubble error bot muncul di layar obrolan
    const errorBubble = page.locator('.msg.bot.error .bubble');
    await expect(errorBubble).toBeVisible();
    await expect(errorBubble).toContainText('Terlalu banyak permintaan dalam waktu singkat');

    // Input dan tombol kirim harus kembali aktif setelah error ditangani
    const sendBtn = page.locator('#send-btn');
    await expect(sendBtn).toBeEnabled();
  });

  test('[N02] Penanganan error HTTP 500 pada stream otomatis fallback ke POST /api/chat dan menampilkan bubble error server', async ({ page }) => {
    await mockChatError(page, {
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Terjadi kesalahan pada server saat memproses streaming rekomendasi.',
    });

    await page.goto('/');
    await page.locator('#user-input').fill('Rekomendasi game RPG');
    await page.locator('#send-btn').click();

    // Verifikasi bubble error bot muncul di layar obrolan
    const errorBubble = page.locator('.msg.bot.error .bubble');
    await expect(errorBubble).toBeVisible();
    await expect(errorBubble).toContainText('Terjadi kesalahan pada server');

    const sendBtn = page.locator('#send-btn');
    await expect(sendBtn).toBeEnabled();
  });

  // ==========================================================================
  // [C01] Fallback Gambar Cover & Kepatuhan Header CSP
  // ==========================================================================
  test('[C01] Fallback cover image beralih ke /icon.svg saat gagal memuat dan bebas pelanggaran CSP', async ({ page }) => {
    const cspErrors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/content security policy/i.test(text)) {
        cspErrors.push(text);
      }
    });

    // Gagalkan request gambar cover CDN Steam agar memicu error event
    await page.route('**/*steamstatic.com/**', (route) => route.abort());
    await page.route('**/*akamaihd.net/**', (route) => route.abort());

    await page.goto('/');

    await page.evaluate(() => {
      window.setDataSaverMode(false);
      const testWrap = document.createElement('div');
      testWrap.id = 'cover-fallback-test';
      testWrap.innerHTML = window.renderCoverImage(
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/105600/header.jpg',
        'Cover Terraria',
        'fallback-test-img'
      );
      document.body.appendChild(testWrap);
    });

    const img = page.locator('#cover-fallback-test img');
    await expect(img).toBeVisible();

    // Verifikasi bahwa src gambar beralih ke fallback /icon.svg
    await expect.poll(async () => {
      return await img.getAttribute('src');
    }).toContain('/icon.svg');

    // Verifikasi guard anti-loop dataset.fallbackApplied telah terpasang
    await expect.poll(async () => {
      return await img.getAttribute('data-fallback-applied');
    }).toBe('true');

    // Verifikasi tidak ada pesan console yang memuat Content Security Policy
    expect(cspErrors).toHaveLength(0);
  });

  // ==========================================================================
  // [C02] Sinkronisasi Multi-Tab Mode Hemat Data (Data Saver)
  // ==========================================================================
  test('[C02] Sinkronisasi multi-tab: toggle Mode Hemat Data di Tab 1 otomatis memperbarui tombol dan kelas di Tab 2 secara dua arah', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await installNetworkGuards(page1);
    await installNetworkGuards(page2);

    await page1.goto('/');
    await page2.goto('/');

    const btn1 = page1.locator('#data-saver-btn');
    const btn2 = page2.locator('#data-saver-btn');

    // Kondisi awal di kedua tab: data saver nonaktif
    await expect(page1.locator('body')).not.toHaveClass(/data-saver-active/);
    await expect(page2.locator('body')).not.toHaveClass(/data-saver-active/);
    await expect(btn1).toHaveAttribute('aria-checked', 'false');
    await expect(btn2).toHaveAttribute('aria-checked', 'false');

    // 1. Arah 1: Aktifkan data saver di Tab 1 -> Tab 2 harus otomatis aktif tanpa reload
    await btn1.click();
    await expect(page1.locator('body')).toHaveClass(/data-saver-active/);
    await expect(btn1).toHaveAttribute('aria-checked', 'true');

    await expect(page2.locator('body')).toHaveClass(/data-saver-active/);
    await expect(btn2).toHaveAttribute('aria-checked', 'true');

    // 2. Arah 2: Nonaktifkan data saver dari Tab 2 -> Tab 1 harus otomatis nonaktif tanpa reload
    await btn2.click();
    await expect(page2.locator('body')).not.toHaveClass(/data-saver-active/);
    await expect(btn2).toHaveAttribute('aria-checked', 'false');

    await expect(page1.locator('body')).not.toHaveClass(/data-saver-active/);
    await expect(btn1).toHaveAttribute('aria-checked', 'false');

    await page1.close();
    await page2.close();
  });

  // ==========================================================================
  // [C03] Deduplikasi Header Brand, Empty State Sesi Desktop, & Live Region
  // ==========================================================================
  test('[C03] Sidebar desktop menampilkan empty state sesi dengan live region, dan brand header terdeduplikasi di desktop vs mobile', async ({ page }) => {
    // 1. Desktop (1366x768): aside.rail tampil, .topbar-title tersembunyi, empty state sesi tampil
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');

    const rail = page.locator('aside.rail');
    const topbarTitle = page.locator('.topbar-title');
    const sidebarEmpty = page.locator('#sessions-sidebar-empty');
    const sidebarError = page.locator('#sessions-sidebar-error');
    const offlineBanner = page.locator('#offline-banner');

    await expect(rail).toBeVisible();
    await expect(topbarTitle).toBeHidden();
    await expect(sidebarEmpty).toBeVisible();
    await expect(sidebarEmpty).toHaveAttribute('role', 'status');
    await expect(sidebarEmpty).toHaveAttribute('aria-live', 'polite');
    await expect(sidebarError).toHaveAttribute('role', 'status');
    await expect(sidebarError).toHaveAttribute('aria-live', 'polite');
    await expect(offlineBanner).toHaveAttribute('role', 'status');
    await expect(offlineBanner).toHaveAttribute('aria-live', 'polite');

    // Setelah satu sesi percakapan dibuat, empty state harus otomatis menghilang
    await mockChatSuccess(page, {
      intro: 'Rekomendasi tes empty state sesi.',
      games: [],
    });
    await page.locator('#user-input').fill('Halo tes sesi');
    await page.locator('#send-btn').click();

    await expect(page.locator('#sessions-list .session-item')).toHaveCount(1);
    await expect(sidebarEmpty).toBeHidden();

    // 2. Mobile (375x667): aside.rail tersembunyi dan .topbar-title tampil kembali
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(rail).toBeHidden();
    await expect(topbarTitle).toBeVisible();
  });

  // ==========================================================================
  // [C04] Toolbar Sesi Aktif Menyembunyikan Preset Saran (#chips) & Divider
  // ==========================================================================
  test('[C04] Toolbar menyembunyikan saran cepat (#chips) saat sesi chat aktif dan mengembalikannya saat reset/sesi baru', async ({ page }) => {
    await page.goto('/');

    const chips = page.locator('#chips');
    const divider = page.locator('#toolbar-divider');
    const filterGroups = page.locator('#filter-groups');
    const quickToolbar = page.locator('#quick-toolbar');
    const toggleBtn = page.locator('#filter-toggle-btn');

    // Layar awal (#welcome aktif): kedua grup tampil
    await expect(chips).toBeVisible();
    await expect(divider).toBeVisible();
    await expect(filterGroups).toBeVisible();

    await mockChatSuccess(page);
    await page.locator('#user-input').fill('Rekomendasi game roguelite ringan');
    await page.locator('#send-btn').click();
    await expect(page.locator('.game-card')).toHaveCount(2);

    // Buka kembali toolbar pada sesi aktif: hanya #filter-groups yang tampil
    const isExpanded = await toggleBtn.getAttribute('aria-expanded');
    if (isExpanded === 'false') {
      await toggleBtn.click();
    }
    await expect(filterGroups).toBeVisible();
    await expect(chips).toBeHidden();
    await expect(divider).toBeHidden();
    await expect(quickToolbar).toHaveAttribute('aria-label', 'Filter preferensi');

    // Memulai sesi baru memulihkan layar awal beserta #chips dan divider
    await page.locator('#new-session-btn').click();
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(chips).toBeVisible();
    await expect(divider).toBeVisible();
    await expect(quickToolbar).toHaveAttribute('aria-label', 'Filter preferensi dan saran cepat');
  });

  // ==========================================================================
  // [C05] Thumbnail Kapsul Mini Kartu Game & Sinkronisasi Mode Hemat Data
  // ==========================================================================
  test('[C05] Kartu rekomendasi menampilkan thumbnail kapsul mini dan mematuhi toggle Mode Hemat Data secara langsung', async ({ page }) => {
    await page.goto('/');
    await mockChatSuccess(page);

    await page.locator('#user-input').fill('Carikan game pixel indie seru');
    await page.locator('#send-btn').click();

    const firstThumb = page.locator('.game-card .game-card-thumb').first();
    const firstImg = firstThumb.locator('img');
    await expect(firstThumb).toBeVisible();
    await expect(firstImg).toBeVisible();
    await expect(firstImg).toHaveAttribute('src', /steamstatic\.com/);

    // Aktifkan Mode Hemat Data: thumbnail di chat langsung disembunyikan
    const dataSaverBtn = page.locator('#data-saver-btn');
    await dataSaverBtn.click();
    await expect(page.locator('body')).toHaveClass(/data-saver-active/);
    await expect(firstThumb).toBeHidden();

    // Matikan Mode Hemat Data: thumbnail kembali tampil tanpa muat ulang halaman
    await dataSaverBtn.click();
    await expect(page.locator('body')).not.toHaveClass(/data-saver-active/);
    await expect(firstThumb).toBeVisible();

    // Mulai obrolan baru dengan Mode Hemat Data aktif terlebih dahulu -> hidrasi saat dimatikan
    await page.locator('#new-session-btn').click();
    await dataSaverBtn.click();
    await expect(page.locator('body')).toHaveClass(/data-saver-active/);

    await page.locator('#user-input').fill('Game strategi ringan hemat data');
    await page.locator('#send-btn').click();

    const hiddenThumb = page.locator('.game-card .game-card-thumb').first();
    await expect(hiddenThumb).toBeHidden();
    await expect(hiddenThumb.locator('.cover-placeholder')).toHaveCount(1);

    await dataSaverBtn.click();
    await expect(hiddenThumb).toBeVisible();
    await expect(hiddenThumb.locator('img')).toBeVisible();
  });

  // ==========================================================================
  // [C06] Tooltip Prompt Penuh Riwayat Sesi Tanpa Label Tanggal/Waktu
  // ==========================================================================
  test('[C06] Item riwayat sesi menampilkan tooltip teks prompt lengkap tanpa tanggal atau waktu', async ({ page }) => {
    await page.goto('/');
    await mockChatSuccess(page);

    const longPrompt = 'Carikan game cozy santai bertani di desa dengan spesifikasi laptop kentang budget di bawah 100 ribu';
    await page.locator('#user-input').fill(longPrompt);
    await page.locator('#send-btn').click();

    const activeItem = page.locator('#sessions-list .session-item.is-active');
    const titleBtn = activeItem.locator('.session-item-title');

    await expect(activeItem).toHaveCount(1);
    await expect(activeItem.locator('.session-item-time')).toHaveCount(0);
    await expect(titleBtn).toHaveAttribute('title', longPrompt);
  });

  // ==========================================================================
  // [C07] Modal Kustom Ubah Nama Sesi (Validasi, Counter, Keyboard, & A11y)
  // ==========================================================================
  test('[C07] Modal ubah nama sesi menyediakan input praisi, validasi kosong, Escape cancel, dan lulus axe-core', async ({ page }) => {
    await page.goto('/');
    await mockChatSuccess(page);

    const longPrompt = 'Carikan game cozy santai pelepas stres untuk laptop kentang harga terjangkau';
    await page.locator('#user-input').fill(longPrompt);
    await page.locator('#send-btn').click();

    const activeItem = page.locator('#sessions-list .session-item.is-active');
    const renameBtn = activeItem.locator('.btn-session-rename');
    await renameBtn.click();

    const dialog = page.locator('#session-action-dialog');
    const input = page.locator('#session-rename-input');
    const counter = page.locator('#session-rename-counter');
    const errorEl = page.locator('#session-action-error');
    const confirmBtn = page.locator('#session-action-confirm-btn');

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(input).toBeFocused();
    // Elipsis bawaan hasil pemotongan otomatis dibersihkan agar counter 35/35 akurat
    await expect(input).toHaveValue(longPrompt.slice(0, 35));
    await expect(counter).toHaveText('35/35');

    // Audit aksesibilitas axe-core saat modal rename terbuka
    const axeResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = axeResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious).toEqual([]);

    // Validasi input kosong menahan dialog tetap terbuka dan menampilkan pesan error
    await input.fill('   ');
    await expect(counter).toHaveText('3/35');
    await confirmBtn.click();
    await expect(dialog).toBeVisible();
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('Nama sesi tidak boleh kosong');
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    // Penekanan Escape membatalkan tanpa mengubah nama sesi dan memulihkan fokus
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(activeItem.locator('.session-item-name')).toContainText(longPrompt.slice(0, 35));

    // Buka ulang dan simpan nama baru via Enter
    await renameBtn.click();
    await input.fill('Cozy Laptop Hemat');
    await expect(counter).toHaveText('17/35');
    await input.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(activeItem.locator('.session-item-name')).toHaveText('Cozy Laptop Hemat');
  });

  // ==========================================================================
  // [C08] Modal Konfirmasi Hapus Sesi (Desktop & Drawer Mobile 375px)
  // ==========================================================================
  test('[C08] Modal konfirmasi hapus sesi aman secara fokus dan berfungsi di desktop maupun drawer mobile', async ({ page }) => {
    await page.goto('/');
    await mockChatSuccess(page);

    // 1. Desktop: buat sesi dan buka dialog hapus
    await page.locator('#user-input').fill('Rekomendasi game RPG santai');
    await page.locator('#send-btn').click();

    const activeItem = page.locator('#sessions-list .session-item.is-active');
    const delBtn = activeItem.locator('.btn-session-delete');
    await delBtn.click();

    const dialog = page.locator('#session-action-dialog');
    const cancelBtn = page.locator('#session-action-cancel-btn');
    const confirmBtn = page.locator('#session-action-confirm-btn');

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog).toContainText('Rekomendasi game RPG santai');
    // Pengaman destruktif: fokus awal harus berada di tombol Batal
    await expect(cancelBtn).toBeFocused();

    // Batal menjaga sesi tetap tersimpan
    await cancelBtn.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#sessions-list .session-item')).toHaveCount(1);

    // 2. Mobile Drawer (375x667): uji penghapusan dari dalam drawer mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.locator('#sessions-btn').click();
    const drawer = page.locator('#sessions-panel');
    await expect(drawer).toBeVisible();

    await page.locator('#drawer-sessions-list .btn-session-delete').first().click();
    await expect(dialog).toBeVisible();
    await expect(cancelBtn).toBeFocused();
    await expect(drawer).toHaveAttribute('inert', '');

    // Pastikan 0px horizontal overflow dan lolos axe-core pada mobile dengan dialog terbuka
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow).toBe(false);

    const axeMobile = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axeMobile.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

    await confirmBtn.click();
    await expect(dialog).toBeHidden();
    await expect(drawer).not.toHaveAttribute('inert');
    await expect(page.locator('#sessions-empty')).toBeVisible();
    await expect(page.locator('#drawer-new-session-btn')).toBeFocused();
  });

  // ==========================================================================
  // [C09] Keamanan XSS storeUrl, Validasi Host Steam, Anti Double-Escape, & 0 CSP Error
  // ==========================================================================
  test('[C09] Data sesi korup/phishing dibersihkan aman tanpa DOM XSS, double-escape, maupun pelanggaran CSP', async ({ page }) => {
    const cspErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /content security policy|csp/i.test(msg.text())) {
        cspErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // Suntikkan sesi dengan payload uji storeUrl (attribute breakout, javascript:, phishing),
    // headerImage non-Steam & query string Steam CDN, serta tautan Markdown phishing vs Steam resmi
    await page.evaluate(async () => {
      const craftedReply = JSON.stringify({
        intro: 'Cek [Link Asing](https://evil.example/phish) dan [Halaman Steam](https://store.steampowered.com/app/367520/).',
        games: [
          {
            appId: 367520,
            title: 'Hollow Knight',
            year: '2017',
            developer: 'Team Cherry',
            genres: ['Metroidvania'],
            verified: true,
            storeUrl: '" data-xss="1',
            headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg?t=1&v=2',
            whyFit: 'Atmosfer mendalam.',
            specsAndBudget: 'Ringan.',
          },
          {
            appId: 413150,
            title: 'Stardew Valley',
            year: '2016',
            developer: 'ConcernedApe',
            genres: ['Farming Sim'],
            verified: true,
            storeUrl: 'javascript:alert(1)',
            headerImage: 'https://evil.example/tracker.png',
            whyFit: 'Santai.',
            specsAndBudget: 'Ringan.',
          },
        ],
        followUp: 'Mau cari genre lain?',
      });

      const session = {
        id: 'session_sec_test',
        title: 'Uji Keamanan Sesi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [
          { role: 'user', text: 'Rekomendasi game aman' },
          { role: 'model', text: craftedReply },
        ],
      };

      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('SteamScoutDB', 1);
        req.onupgradeneeded = (ev) => {
          const d = ev.target.result;
          if (!d.objectStoreNames.contains('chat_sessions')) {
            const st = d.createObjectStore('chat_sessions', { keyPath: 'id' });
            st.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      await new Promise((resolve, reject) => {
        const tx = db.transaction('chat_sessions', 'readwrite');
        tx.objectStore('chat_sessions').put(session);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      sessionStorage.setItem('sobatsteam_active_session_id', 'session_sec_test');
      sessionStorage.setItem('sobatsteam_chat_history', JSON.stringify(session.messages));
    });

    await page.reload();
    await expect(page.locator('.game-card')).toHaveCount(2);

    // 1. Tidak boleh ada atribut injeksi [data-xss] di DOM
    await expect(page.locator('[data-xss]')).toHaveCount(0);

    // 2. Seluruh tombol Steam Store wajib jatuh ke https://store.steampowered.com/...
    const storeLinks = page.locator('.steam-store-card-btn');
    await expect(storeLinks.nth(0)).toHaveAttribute('href', 'https://store.steampowered.com/app/367520/');
    await expect(storeLinks.nth(1)).toHaveAttribute('href', 'https://store.steampowered.com/app/413150/');

    // 3. Gambar Steam CDN ber-query string tidak mengalami double-escaping, dan gambar non-Steam diblokir
    const thumbs = page.locator('.game-card-thumb');
    await expect(thumbs).toHaveCount(1);
    const thumbImg = thumbs.first().locator('img');
    await expect(thumbImg).toHaveAttribute(
      'src',
      'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg?t=1&v=2'
    );
    await expect(page.locator('img[src*="evil.example"]')).toHaveCount(0);

    // 4. Tautan Markdown non-Steam dirender sebagai teks biasa, sedangkan tautan Steam tetap aktif
    const introEl = page.locator('.bot-intro').first();
    await expect(introEl).toContainText('Link Asing');
    await expect(introEl.locator('a[href*="evil.example"]')).toHaveCount(0);
    await expect(introEl.locator('a[href="https://store.steampowered.com/app/367520/"]')).toHaveCount(1);

    // 5. Nol pelanggaran console CSP dan nol uncaught pageerror
    expect(cspErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
