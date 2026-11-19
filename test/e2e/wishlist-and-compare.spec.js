import { test, expect } from '@playwright/test';
import { installNetworkGuards } from './helpers/network.js';

test.describe('Wishlist', () => {
  // ==========================================================================
  // [B01] & [B02] Sinkronisasi Wishlist Antar-Tab
  // ==========================================================================
  test('[B01] Tab B menerima update item dari Tab A', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await installNetworkGuards(pageA);
    await installNetworkGuards(pageB);

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.evaluate(() => localStorage.clear());

    // Tambahkan item dari Tab A
    await pageA.evaluate(() => {
      const item = { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' };
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify([item]));
    });

    // Kirim event storage ke Tab B
    await pageB.evaluate(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'sobatsteam_wishlist',
        newValue: localStorage.getItem('sobatsteam_wishlist'),
      }));
    });

    // Tab B merefleksikan update item secara reaktif pada badge
    await expect(pageB.locator('#wishlist-badge')).toHaveText('1');

    await pageA.close();
    await pageB.close();
  });

  test('[B02] Tab A menerima update dari Tab B tanpa kehilangan data awal', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await installNetworkGuards(pageA);
    await installNetworkGuards(pageB);

    await pageA.goto('/');
    await pageB.goto('/');

    // Item awal di Tab A: Terraria
    await pageA.evaluate(() => {
      const item = { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' };
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify([item]));
    });

    // Tab B menambahkan item kedua tanpa menghapus item awal
    await pageB.evaluate(() => {
      const raw = localStorage.getItem('sobatsteam_wishlist');
      const list = raw ? JSON.parse(raw) : [];
      list.push({ appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' });
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(list));
    });

    // Kirim event storage ke Tab A
    await pageA.evaluate(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'sobatsteam_wishlist',
        newValue: localStorage.getItem('sobatsteam_wishlist'),
      }));
    });

    // Tab A merefleksikan 2 item
    await expect(pageA.locator('#wishlist-badge')).toHaveText('2');
    const listA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]'));
    expect(listA).toHaveLength(2);
    expect(listA.some((g) => g.title === 'Terraria')).toBe(true);
    expect(listA.some((g) => g.title === 'Stardew Valley')).toBe(true);

    await pageA.close();
    await pageB.close();
  });

  // ==========================================================================
  // [B05] & [B06] Region Live Screen Reader & Status Tombol Wishlist
  // ==========================================================================
  test('[B05] Region live mengumumkan penambahan game dan aria-pressed sinkron', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    // Suntikkan kartu game ke area obrolan
    await page.evaluate(() => {
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

    const toggleBtn = page.locator('.btn-wishlist-toggle');
    const announcer = page.locator('#live-announcer');

    await toggleBtn.click();

    await expect(announcer).toContainText('ditambahkan ke wishlist');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('[B06] Region live mengumumkan penghapusan game dan aria-pressed sinkron', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
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

    const toggleBtn = page.locator('.btn-wishlist-toggle');
    const announcer = page.locator('#live-announcer');

    // Klik pertama: tambah ke wishlist
    await toggleBtn.click();
    await expect(announcer).toContainText('ditambahkan ke wishlist');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');

    // Klik kedua: hapus dari wishlist
    await toggleBtn.click();
    await expect(announcer).toContainText('dihapus dari wishlist');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // ==========================================================================
  // [B07], [B08], [B14] Focus Trap Drawer Wishlist
  // ==========================================================================
  test('[B07] Focus trap saat drawer kosong (menahan fokus dan kembali ke tombol pembuka via Esc)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => localStorage.clear());

    const wishlistBtn = page.locator('#wishlist-btn');
    const wishlistPanel = page.locator('#wishlist-panel');
    const closeBtn = page.locator('#wishlist-close-btn');

    await wishlistBtn.focus();
    await wishlistBtn.click();

    await expect(wishlistPanel).toBeVisible();
    await expect(closeBtn).toBeFocused();

    // Tab di dalam drawer kosong menahan fokus pada satu-satunya elemen fokus (closeBtn)
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Escape menutup panel dan mengembalikan fokus ke tombol pembuka
    await page.keyboard.press('Escape');
    await expect(wishlistPanel).toBeHidden();
    await expect(wishlistBtn).toBeFocused();
  });

  test('[B08] Focus trap saat drawer terisi item mengurung navigasi di dalam panel', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify([
        { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' },
        { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' },
      ]));
    });

    const wishlistBtn = page.locator('#wishlist-btn');
    const wishlistPanel = page.locator('#wishlist-panel');

    await wishlistBtn.focus();
    await wishlistBtn.click();

    await expect(wishlistPanel).toBeVisible();

    // Tab berputar di dalam panel
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const panel = document.getElementById('wishlist-panel');
        return panel ? panel.contains(document.activeElement) : false;
      });
      expect(isInside).toBe(true);
    }

    // Escape menutup panel dan mengembalikan fokus
    await page.keyboard.press('Escape');
    await expect(wishlistPanel).toBeHidden();
    await expect(wishlistBtn).toBeFocused();
  });

  test('[B14] Focus trap tetap menahan navigasi keyboard di dalam drawer saat hasil filter kosong', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify([
        { appId: 1, title: 'Portal', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
      ]));
    });

    const wishlistBtn = page.locator('#wishlist-btn');
    const searchInput = page.locator('#wishlist-search');
    const emptyNotice = page.locator('#wishlist-filter-empty');

    await wishlistBtn.click();
    await searchInput.fill('nomatchgame');

    await expect(emptyNotice).toBeVisible();
    await expect(page.locator('.wishlist-item')).toHaveCount(0);

    // Tab beberapa kali, pastikan navigasi keyboard tetap terkurung di dalam panel
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const panel = document.getElementById('wishlist-panel');
        return panel ? panel.contains(document.activeElement) : false;
      });
      expect(isInside).toBe(true);
    }

    // Shift+Tab mundur
    await page.keyboard.press('Shift+Tab');
    const isInsideShift = await page.evaluate(() => {
      const panel = document.getElementById('wishlist-panel');
      return panel ? panel.contains(document.activeElement) : false;
    });
    expect(isInsideShift).toBe(true);
  });

  // ==========================================================================
  // [B09] & [B10] Pengurutan dan Pencarian Wishlist
  // ==========================================================================
  test('[B09] Mengetik pada input memfilter kartu tanpa kehilangan fokus dan tanpa pergantian node DOM', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/', addedAt: '2026-01-01T10:00:00.000Z' },
        { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/', addedAt: '2026-01-02T10:00:00.000Z' },
        { appId: 367520, title: 'Hollow Knight', storeUrl: 'https://store.steampowered.com/app/367520/', addedAt: '2026-01-03T10:00:00.000Z' },
        { appId: 504230, title: 'Celeste', storeUrl: 'https://store.steampowered.com/app/504230/', addedAt: '2026-01-04T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('.wishlist-item')).toHaveCount(4);

    const searchInput = page.locator('#wishlist-search');
    await searchInput.focus();

    // Simpan referensi DOM node input asli
    await page.evaluate(() => {
      window.__testInputNode = document.getElementById('wishlist-search');
    });

    // Ketik kueri filter
    await searchInput.pressSequentially('hollow');

    await expect(page.locator('.wishlist-item')).toHaveCount(1);
    await expect(page.locator('.wishlist-item .wishlist-item-title')).toHaveText('Hollow Knight');

    // Fokus tidak boleh hilang
    await expect(searchInput).toBeFocused();

    // Node input tidak boleh diganti/re-render
    const isNodePreserved = await page.evaluate(() => {
      return window.__testInputNode === document.getElementById('wishlist-search');
    });
    expect(isNodePreserved).toBe(true);
  });

  test('[B10] Dropdown sort mengurutkan kartu secara deterministik (latest, oldest, alpha-asc)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 105600, title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/', addedAt: '2026-01-01T10:00:00.000Z' },
        { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/', addedAt: '2026-01-02T10:00:00.000Z' },
        { appId: 367520, title: 'Hollow Knight', storeUrl: 'https://store.steampowered.com/app/367520/', addedAt: '2026-01-03T10:00:00.000Z' },
        { appId: 504230, title: 'Celeste', storeUrl: 'https://store.steampowered.com/app/504230/', addedAt: '2026-01-04T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    await page.locator('#wishlist-btn').click();
    const sortSelect = page.locator('#wishlist-sort');
    const titles = page.locator('.wishlist-item .wishlist-item-title');

    // 1. Urutan default (latest)
    await expect(titles).toHaveText(['Celeste', 'Hollow Knight', 'Stardew Valley', 'Terraria']);

    // 2. Urutan oldest
    await sortSelect.selectOption('oldest');
    await expect(titles).toHaveText(['Terraria', 'Stardew Valley', 'Hollow Knight', 'Celeste']);

    // 3. Urutan alpha-asc
    await sortSelect.selectOption('alpha-asc');
    await expect(titles).toHaveText(['Celeste', 'Hollow Knight', 'Stardew Valley', 'Terraria']);
  });

  // ==========================================================================
  // [B11] Sinkronisasi Multi-Tab Pencarian & Sort
  // ==========================================================================
  test('[B11] Sinkronisasi multi-tab mempertahankan query pencarian dan pilihan sort yang sedang aktif', async ({ context }) => {
    const pageSyncA = await context.newPage();
    const pageSyncB = await context.newPage();
    await installNetworkGuards(pageSyncA);
    await installNetworkGuards(pageSyncB);

    await pageSyncA.goto('/');
    await pageSyncB.goto('/');

    await pageSyncA.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 10, title: 'Counter-Strike 2', storeUrl: 'https://store.steampowered.com/app/10/', addedAt: '2026-01-01T10:00:00.000Z' },
        { appId: 20, title: 'Portal 2', storeUrl: 'https://store.steampowered.com/app/20/', addedAt: '2026-01-02T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    // Di Tab B, buka drawer, filter "portal" dan sort "alpha-asc"
    await pageSyncB.locator('#wishlist-btn').click();
    await expect(pageSyncB.locator('.wishlist-item')).toHaveCount(2);

    await pageSyncB.locator('#wishlist-search').fill('portal');
    await pageSyncB.locator('#wishlist-sort').selectOption('alpha-asc');
    await expect(pageSyncB.locator('.wishlist-item')).toHaveCount(1);
    await expect(pageSyncB.locator('.wishlist-item .wishlist-item-title')).toHaveText('Portal 2');

    // Di Tab A, tambahkan game ketiga ("Portal Revolution")
    await pageSyncA.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      list.push({ appId: 30, title: 'Portal Revolution', storeUrl: 'https://store.steampowered.com/app/30/', addedAt: '2026-01-03T10:00:00.000Z' });
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(list));
    });

    // Kirim storage event ke Tab B
    await pageSyncB.evaluate(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'sobatsteam_wishlist',
        newValue: localStorage.getItem('sobatsteam_wishlist'),
      }));
    });

    // Tab B harus otomatis memperbarui daftar menjadi 2 item yang cocok dengan kueri dan urutan
    await expect(pageSyncB.locator('.wishlist-item')).toHaveCount(2);
    await expect(pageSyncB.locator('#wishlist-search')).toHaveValue('portal');
    await expect(pageSyncB.locator('#wishlist-sort')).toHaveValue('alpha-asc');
    await expect(pageSyncB.locator('.wishlist-item .wishlist-item-title')).toHaveText(['Portal 2', 'Portal Revolution']);

    await pageSyncA.close();
    await pageSyncB.close();
  });

  // ==========================================================================
  // [B12] Hapus Item Terfilter & Pemindahan Fokus
  // ==========================================================================
  test('[B12] Hapus item terfilter menghapus game yang tepat (berdasarkan appId, bukan indeks) dan memindahkan fokus secara aman', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 101, title: 'Alpha Game', storeUrl: 'https://store.steampowered.com/app/101/', addedAt: '2026-01-01T10:00:00.000Z' },
        { appId: 102, title: 'Beta One', storeUrl: 'https://store.steampowered.com/app/102/', addedAt: '2026-01-02T10:00:00.000Z' },
        { appId: 103, title: 'Beta Two', storeUrl: 'https://store.steampowered.com/app/103/', addedAt: '2026-01-03T10:00:00.000Z' },
        { appId: 104, title: 'Beta Three', storeUrl: 'https://store.steampowered.com/app/104/', addedAt: '2026-01-04T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('.wishlist-item')).toHaveCount(4);

    // Filter "Beta" -> tampil 3 game (Beta Three, Beta Two, Beta One)
    await page.locator('#wishlist-search').fill('Beta');
    await expect(page.locator('.wishlist-item')).toHaveCount(3);

    // 1. Hapus item pertama pada daftar terfilter (Beta Three, appId 104)
    const delBtns = page.locator('.btn-item-delete');
    await delBtns.first().click();

    await expect(page.locator('.wishlist-item')).toHaveCount(2);

    const storageAfterDel1 = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      const appIds = list.map((g) => g.appId);
      const focusedDatasetKey = document.activeElement ? document.activeElement.dataset?.key : null;
      return { appIds, focusedDatasetKey };
    });

    expect(storageAfterDel1.appIds).toContain(101); // Alpha Game tetap ada
    expect(storageAfterDel1.appIds).not.toContain(104); // Beta Three terhapus
    expect(storageAfterDel1.focusedDatasetKey).toBe('app_103'); // Fokus berpindah ke Beta Two

    // 2. Hapus item terakhir pada daftar terfilter (Beta One, appId 102)
    await delBtns.nth(1).click();
    await expect(page.locator('.wishlist-item')).toHaveCount(1);

    const storageAfterDel2 = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      const appIds = list.map((g) => g.appId);
      const focusedDatasetKey = document.activeElement ? document.activeElement.dataset?.key : null;
      return { appIds, focusedDatasetKey };
    });

    expect(storageAfterDel2.appIds).not.toContain(102);
    expect(storageAfterDel2.focusedDatasetKey).toBe('app_103'); // Fokus tetap pada item tersisa (Beta Two)

    // 3. Hapus item terfilter terakhir yang tersisa (Beta Two, appId 103)
    await delBtns.first().click();

    const emptyNotice = page.locator('#wishlist-filter-empty');
    await expect(emptyNotice).toBeVisible();

    // Fokus harus pindah ke input pencarian
    await expect(page.locator('#wishlist-search')).toBeFocused();
  });

  // ==========================================================================
  // [B13] Debounce Pengumuman Live Region (400ms)
  // ==========================================================================
  test('[B13] Live region mengumumkan jumlah game secara tepat (debounce 400ms, dan tidak mengumumkan saat drawer dibuka)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 1, title: 'Game A', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
        { appId: 2, title: 'Game B', storeUrl: 'https://store.steampowered.com/app/2/', addedAt: '2026-01-02T10:00:00.000Z' },
        { appId: 3, title: 'Game C', storeUrl: 'https://store.steampowered.com/app/3/', addedAt: '2026-01-03T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    const announcer = page.locator('#wishlist-filter-announcer');

    // Buka drawer
    await page.locator('#wishlist-btn').click();
    await expect(page.locator('#wishlist-panel')).toBeVisible();

    // Tidak boleh ada pengumuman saat drawer dibuka
    await expect(announcer).toHaveText('');

    // Pasang page.clock untuk menguji timing debounce
    await page.clock.install();

    // Ketik "Game" di kotak pencarian
    await page.locator('#wishlist-search').fill('Game');

    // Segera setelah mengetik, belum ada pengumuman (debounce belum selesai)
    await expect(announcer).toHaveText('');

    // Majukan waktu melewati batas debounce 400 ms
    await page.clock.fastForward(450);

    // Live region mengumumkan jumlah game hasil filter
    await expect(announcer).toHaveText('Menampilkan 3 dari 3 game');
  });

  // ==========================================================================
  // [B15] Proteksi XSS pada Empty State
  // ==========================================================================
  test('[B15] Penyisipan teks empty state terhindar dari interpretasi tag HTML / XSS (textContent murni)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.clear();
      const items = [
        { appId: 1, title: 'Cyberpunk 2077', storeUrl: 'https://store.steampowered.com/app/1/', addedAt: '2026-01-01T10:00:00.000Z' },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    });

    let dialogFired = false;
    page.on('dialog', () => {
      dialogFired = true;
    });

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('.wishlist-item')).toHaveCount(1);

    const xssPayload = '<img src=x onerror=window.__xss=1>';
    await page.locator('#wishlist-search').fill(xssPayload);

    const emptyNotice = page.locator('#wishlist-filter-empty');
    await expect(emptyNotice).toBeVisible();

    // Verifikasi tidak ada tag <img> baru di dalam notice empty state
    await expect(emptyNotice.locator('img')).toHaveCount(0);

    // Verifikasi script onerror tidak dieksekusi
    const isScriptExecuted = await page.evaluate(() => Boolean(window.__xss));
    expect(isScriptExecuted).toBe(false);
    expect(dialogFired).toBe(false);

    // Verifikasi teks payload ditampilkan sebagai textContent murni
    await expect(emptyNotice).toContainText(xssPayload);
  });

  // ==========================================================================
  // [B27], [B28], [B29] Pembaruan Modul Wishlist & Genre Filter
  // ==========================================================================
  test('[B27] Tombol ekspor JSON, salin teks, dan impor JSON telah dikurangi dari antarmuka drawer wishlist', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('#wishlist-panel')).toBeVisible();

    // Seluruh tombol ekspor/impor lama telah dikurangi dari DOM
    await expect(page.locator('#wishlist-export-btn')).toHaveCount(0);
    await expect(page.locator('#wishlist-copy-btn')).toHaveCount(0);
    await expect(page.locator('#wishlist-import-btn')).toHaveCount(0);
    await expect(page.locator('.wishlist-footer')).toHaveCount(0);
  });

  test('[B28] Drawer wishlist menampilkan pembaruan game tersimpan secara dinamis dan rapi', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    // Inisialisasi storage dengan 2 game awal
    await page.evaluate(() => {
      const initialList = [
        { appId: 1145360, title: 'Hades', addedAt: '2026-10-19T10:00:00.000Z', genres: ['Action', 'Roguelite'] },
        { appId: 588650, title: 'Dead Cells', addedAt: '2026-10-19T10:05:00.000Z', genres: ['Roguelite', 'Metroidvania'] },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(initialList));
    });

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('#wishlist-panel')).toBeVisible();
    await expect(page.locator('#wishlist-items .wishlist-item')).toHaveCount(2);
    await expect(page.locator('#wishlist-badge')).toHaveText('2');

    // Tambahkan game ketiga secara dinamis
    await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      list.push({ appId: 413150, title: 'Stardew Valley', addedAt: '2026-10-19T11:00:00.000Z', genres: ['Farming Sim', 'RPG'] });
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(list));
      if (typeof window.updateWishlistUI === 'function') {
        window.updateWishlistUI();
      }
    });

    await expect(page.locator('#wishlist-items .wishlist-item')).toHaveCount(3);
    await expect(page.locator('#wishlist-items .wishlist-item-title')).toContainText(['Stardew Valley']);
    await expect(page.locator('#wishlist-drawer-count')).toHaveText('(3/50)');
    await expect(page.locator('#wishlist-badge')).toHaveText('3');
  });

  test('[B29] Quick filter chips genre menyaring game wishlist secara dinamis dan responsif (Modul P2)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await page.evaluate(() => {
      const list = [
        { appId: 1145360, title: 'Hades', addedAt: '2026-10-19T10:00:00.000Z', genres: ['Action', 'Roguelite'] },
        { appId: 588650, title: 'Dead Cells', addedAt: '2026-10-19T10:05:00.000Z', genres: ['Roguelite', 'Metroidvania'] },
        { appId: 413150, title: 'Stardew Valley', addedAt: '2026-10-19T11:00:00.000Z', genres: ['Farming Sim', 'RPG'] },
      ];
      localStorage.setItem('sobatsteam_wishlist', JSON.stringify(list));
    });

    await page.locator('#wishlist-btn').click();
    await expect(page.locator('#wishlist-panel')).toBeVisible();

    const chipsContainer = page.locator('#wishlist-genre-chips');
    await expect(chipsContainer).toBeVisible();

    const items = page.locator('#wishlist-items .wishlist-item');

    // 1. Klik chip "Roguelite" -> tampil 2 game (Dead Cells, Hades)
    const rogueliteChip = chipsContainer.locator('.wishlist-genre-chip', { hasText: /^Roguelite$/i });
    await rogueliteChip.click();

    await expect(rogueliteChip).toHaveClass(/is-active/);
    await expect(items).toHaveCount(2);
    await expect(page.locator('#wishlist-items .wishlist-item-title')).toHaveText(['Dead Cells', 'Hades']);

    // 2. Klik chip "RPG" -> tampil 1 game (Stardew Valley)
    const rpgChip = chipsContainer.locator('.wishlist-genre-chip', { hasText: /^RPG$/i });
    await rpgChip.click();

    await expect(rpgChip).toHaveClass(/is-active/);
    await expect(items).toHaveCount(1);
    await expect(page.locator('#wishlist-items .wishlist-item-title')).toHaveText(['Stardew Valley']);

    // 3. Klik chip "Semua" -> reset filter, tampil seluruh 3 game
    const allChip = chipsContainer.locator('.wishlist-genre-chip[data-genre="all"]');
    await allChip.click();

    await expect(allChip).toHaveClass(/is-active/);
    await expect(items).toHaveCount(3);
    await expect(page.locator('#wishlist-items .wishlist-item-title')).toHaveText(['Stardew Valley', 'Dead Cells', 'Hades']);
  });
});

// ============================================================================
// HELPER: INJEKSI KARTU GAME KOMPARASI
// ============================================================================
/**
 * Menyuntikkan 3 kartu game rekomendasi ke obrolan untuk pengujian komparasi.
 * Mengikuti struktur fixture dan metadata game rekomendasi SobatSteam.
 * @param {import('@playwright/test').Page} page
 */
async function injectComparisonCards(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    try {
      indexedDB.deleteDatabase('SteamScoutDB');
    } catch {}

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
}

// ============================================================================
// SKENARIO KOMPARASI GAME BERDAMPINGAN (B19-B26)
// ============================================================================
test.describe('Komparasi', () => {
  // ==========================================================================
  // [B19], [B20], [B21] Seleksi Game & Floating Bar
  // ==========================================================================
  test('[B19] Seleksi 1 game memunculkan floating bar dengan instruksi memilih 1 game lagi', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();

    const bar = page.locator('#comparison-bar');
    const barText = page.locator('#comparison-bar-text');
    const openBtn = page.locator('#comparison-open-btn');

    await expect(bar).toBeVisible();
    await expect(barText).toContainText('1 game dipilih');
    await expect(barText).toContainText('Pilih 1 game lagi');
    await expect(openBtn).toBeDisabled();
    await expect(compareBtns.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(compareBtns.nth(0)).toHaveClass(/is-selected/);
  });

  test('[B20] Seleksi 2 game mengaktifkan tombol Bandingkan Sekarang', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    const bar = page.locator('#comparison-bar');
    const barText = page.locator('#comparison-bar-text');
    const openBtn = page.locator('#comparison-open-btn');

    await expect(bar).toBeVisible();
    await expect(barText).toContainText('2 game siap dibandingkan');
    await expect(openBtn).toBeEnabled();
    await expect(compareBtns.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(compareBtns.nth(1)).toHaveClass(/is-selected/);
  });

  test('[B21] Penolakan seleksi lebih dari 2 game memicu toast batasan (Mutasi M1)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    // Coba pilih game ke-3
    await compareBtns.nth(2).click();

    // Game ke-3 harus ditolak
    await expect(compareBtns.nth(2)).toHaveAttribute('aria-pressed', 'false');
    await expect(compareBtns.nth(2)).not.toHaveClass(/is-selected/);

    // Toast batasan harus muncul
    const toast = page.locator('.wishlist-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Maksimal 2 game');
  });

  // ==========================================================================
  // [B22], [B23], [B25] Modal Dialog Komparasi & Focus Trap
  // ==========================================================================
  test('[B22] Membuka modal komparasi mengaktifkan atribut inert pada latar belakang dan fokus pada tombol tutup (Mutasi M2)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    const openBtn = page.locator('#comparison-open-btn');
    await openBtn.focus();
    await openBtn.click();

    const dialog = page.locator('#comparison-dialog');
    const backdrop = page.locator('#comparison-backdrop');
    const closeBtn = page.locator('#comparison-close-btn');
    const appEl = page.locator('.app');

    await expect(dialog).toBeVisible();
    await expect(backdrop).toBeVisible();
    await expect(appEl).toHaveAttribute('inert', '');
    await expect(closeBtn).toBeFocused();
  });

  test('[B23] Focus trap mengurung navigasi Tab di dalam modal komparasi', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    await page.locator('#comparison-open-btn').click();

    const dialog = page.locator('#comparison-dialog');
    await expect(dialog).toBeVisible();

    const closeBtn = page.locator('#comparison-close-btn');
    await expect(closeBtn).toBeFocused();

    // Shift+Tab dari tombol pertama (closeBtn) harus melompat ke elemen terakhir
    await page.keyboard.press('Shift+Tab');

    const isLastFocused = await page.evaluate(() => {
      const modal = document.getElementById('comparison-dialog');
      const close = document.getElementById('comparison-close-btn');
      const focusables = Array.from(
        modal.querySelectorAll('button:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])')
      ).filter((el) => el === close || (el.closest('[hidden]') === null && (el.offsetParent !== null || el.getClientRects().length > 0)));
      return document.activeElement === focusables[focusables.length - 1];
    });
    expect(isLastFocused).toBe(true);

    // Tab dari elemen terakhir harus melompat kembali ke elemen pertama (closeBtn)
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();
  });

  test('[B24] Sinkronisasi dua arah wishlist dari modal komparasi memperbarui state kartu chat dan drawer (Mutasi M5)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    await page.locator('#comparison-open-btn').click();
    await expect(page.locator('#comparison-dialog')).toBeVisible();

    const modalWishlistBtnA = page.locator('.btn-modal-wishlist').first();
    const chatWishlistBtnA = page.locator('#card-1 .btn-wishlist-toggle');
    const badge = page.locator('#wishlist-badge');

    // 1. Simpan Game A ke wishlist dari dalam modal
    await modalWishlistBtnA.click();

    await expect(modalWishlistBtnA).toHaveAttribute('aria-pressed', 'true');
    await expect(modalWishlistBtnA.locator('.wishlist-btn-text')).toHaveText('Tersimpan');
    await expect(chatWishlistBtnA).toHaveAttribute('aria-pressed', 'true');
    await expect(chatWishlistBtnA.locator('.wishlist-btn-text')).toHaveText('Tersimpan');
    await expect(badge).toHaveText('1');

    const hasHadesInStorage = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      return list.some((g) => g.title === 'Hades');
    });
    expect(hasHadesInStorage).toBe(true);

    // 2. Hapus Game A dari wishlist melalui modal
    await modalWishlistBtnA.click();

    await expect(modalWishlistBtnA).toHaveAttribute('aria-pressed', 'false');
    await expect(chatWishlistBtnA).toHaveAttribute('aria-pressed', 'false');
    await expect(badge).toHaveText('0');

    const hasHadesAfterRemove = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('sobatsteam_wishlist') || '[]');
      return list.some((g) => g.title === 'Hades');
    });
    expect(hasHadesAfterRemove).toBe(false);
  });

  test('[B25] Penekanan tombol Escape menutup modal dan memulihkan fokus pemicu', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');
    await injectComparisonCards(page);

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    const openBtn = page.locator('#comparison-open-btn');
    await openBtn.focus();
    await openBtn.click();

    const dialog = page.locator('#comparison-dialog');
    const backdrop = page.locator('#comparison-backdrop');
    const appEl = page.locator('.app');

    await expect(dialog).toBeVisible();

    // Tekan Escape untuk menutup modal
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(backdrop).toBeHidden();
    await expect(appEl).not.toHaveAttribute('inert');
    await expect(openBtn).toBeFocused();
  });

  // ==========================================================================
  // [B26] Reset Chat & Pembersihan Komparasi (Mutasi M3)
  // ==========================================================================
  test('[B26] Reset obrolan mengosongkan seleksi komparasi dan menyembunyikan floating bar (Mutasi M3)', async ({ page }) => {
    await installNetworkGuards(page);
    await page.goto('/');

    await injectComparisonCards(page);

    // Kirim pesan obrolan agar history terisi dan konfirmasi reset dipicu
    await page.locator('#user-input').fill('Rekomendasi roguelite seru');
    await page.locator('#send-btn').click();
    await expect(page.locator('.msg.bot').first()).toBeVisible();

    const compareBtns = page.locator('.btn-compare-toggle');
    await compareBtns.nth(0).click();
    await compareBtns.nth(1).click();

    const bar = page.locator('#comparison-bar');
    await expect(bar).toBeVisible();

    // Tangani dialog konfirmasi reset obrolan
    let dialogHandled = false;
    page.once('dialog', async (dialog) => {
      dialogHandled = true;
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });

    await page.locator('#reset-btn').click();

    expect(dialogHandled).toBe(true);
    await expect(bar).toBeHidden();
    await expect(page.locator('.btn-compare-toggle.is-selected')).toHaveCount(0);
    await expect(page.locator('#comparison-dialog')).toBeHidden();
  });
});

