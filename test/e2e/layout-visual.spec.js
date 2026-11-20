import { test, expect } from '@playwright/test';
import { viewports } from './helpers/viewports.js';
import { visualFixtures } from './helpers/visualFixtures.js';
import { renderMockChatRecommendation } from './helpers/mockChat.js';
import { installNetworkGuards } from './helpers/network.js';
import { waitForFontsReady } from './helpers/fonts.js';

// Pengujian visual menggunakan Google Chrome sistem untuk mereplikasi engine skrip verifikasi lama
test.use({ channel: 'chrome' });

/**
 * Menyiapkan tampilan chat default (Kondisi 1).
 * @param {import('@playwright/test').Page} page
 */
async function prepareDefaultChat(page) {
  await page.goto('/');
  await page.addStyleTag({ url: '/__e2e_stabilize.css' });
  await waitForFontsReady(page);

  await renderMockChatRecommendation(page);
  await waitForFontsReady(page);

  await page.evaluate(() => {
    const wrap = document.getElementById('quick-toolbar-wrap');
    if (wrap) wrap.classList.add('is-collapsed');
  });

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await waitForFontsReady(page);
}

/**
 * Menyiapkan tampilan drawer wishlist terbuka (Kondisi 2).
 * @param {import('@playwright/test').Page} page
 */
async function prepareWishlistDrawer(page) {
  await prepareDefaultChat(page);

  await page.evaluate((items) => {
    localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
    const wishlistBtn = document.getElementById('wishlist-btn');
    if (wishlistBtn) wishlistBtn.click();
  }, visualFixtures.wishlistItems);

  await page.waitForFunction(() => {
    const panel = document.getElementById('wishlist-panel');
    const rendered = document.querySelectorAll('.wishlist-item');
    if (!panel || panel.hidden || rendered.length < 12) return false;
    const r = panel.getBoundingClientRect();
    return Math.abs(r.right - window.innerWidth) <= 1;
  }, { timeout: 4000 });

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await waitForFontsReady(page);
}

/**
 * Menyiapkan dialog komparasi game normal / data saver nonaktif (Kondisi 3).
 * Modal dibuka dari keadaan bersih default chat.
 * @param {import('@playwright/test').Page} page
 * @param {boolean} isMobile
 */
async function prepareComparisonNormal(page, isMobile) {
  await prepareDefaultChat(page);

  await page.evaluate(() => {
    window.setDataSaverMode(false);
    const compareBtns = document.querySelectorAll('#messages .btn-compare-toggle');
    if (compareBtns.length >= 2) {
      compareBtns[0].click();
      compareBtns[1].click();
    }
    const openBtn = document.getElementById('comparison-open-btn');
    if (openBtn && !openBtn.disabled) {
      openBtn.click();
    }
  });

  await page.waitForFunction(() => {
    const dialog = document.getElementById('comparison-dialog');
    return dialog && !dialog.hidden;
  }, { timeout: 4000 });

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  if (isMobile) {
    await page.evaluate(() => {
      const tabB = document.getElementById('comparison-tab-b');
      const tabA = document.getElementById('comparison-tab-a');
      if (tabB && tabA) {
        tabB.click();
        tabA.click();
      }
    });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }

  await waitForFontsReady(page);
}

/**
 * Menyiapkan dialog komparasi game dengan mode hemat data aktif (Kondisi 4).
 * @param {import('@playwright/test').Page} page
 * @param {boolean} isMobile
 * @param {string} [vpName]
 */
async function prepareComparisonDataSaver(page, isMobile, vpName) {
  await prepareDefaultChat(page);

  await page.evaluate(() => {
    window.setDataSaverMode(false);
    const compareBtns = document.querySelectorAll('#messages .btn-compare-toggle');
    if (compareBtns.length >= 2) {
      compareBtns[0].click();
      compareBtns[1].click();
    }
    const openBtn = document.getElementById('comparison-open-btn');
    if (openBtn && !openBtn.disabled) {
      openBtn.click();
    }
  });

  await page.waitForFunction(() => {
    const dialog = document.getElementById('comparison-dialog');
    return dialog && !dialog.hidden;
  }, { timeout: 4000 });

  if (isMobile) {
    await page.evaluate(() => {
      const tabB = document.getElementById('comparison-tab-b');
      const tabA = document.getElementById('comparison-tab-a');
      if (tabB && tabA) {
        tabB.click();
        tabA.click();
      }
    });
  }

  await page.evaluate(() => {
    window.setDataSaverMode(true);
  });

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await waitForFontsReady(page);
}

const visualCodes = {
  '1366x768': { default: 'L05', drawer: 'L06', compNormal: 'L07', compDataSaver: 'L08' },
  '1024x575': { default: 'L13', drawer: 'L14', compNormal: 'L15', compDataSaver: 'L16' },
  '1920x1080': { default: 'L21', drawer: 'L22', compNormal: 'L23', compDataSaver: 'L24' },
  '375x667': { default: 'L29', drawer: 'L30', compNormal: 'L31', compDataSaver: 'L32' },
  '412x915': { default: 'L37', drawer: 'L38', compNormal: 'L39', compDataSaver: 'L40' },
};

const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.015,
  threshold: 0.1,
  animations: /** @type {const} */ ('disabled'),
  caret: /** @type {const} */ ('hide'),
};

// ============================================================================
// 20 TES REGRESI VISUAL (L05-L08 PADA 5 VIEWPORT)
// ============================================================================
for (const vp of viewports) {
  const codes = visualCodes[vp.name];
  const isMobile = vp.width < 600;

  test.describe(`Visual Viewport ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installNetworkGuards(page);
    });

    test(`[${codes.default}] ${vp.name} visual default chat`, async ({ page }) => {
      await prepareDefaultChat(page);
      await waitForFontsReady(page);
      await expect(page).toHaveScreenshot(`layout_default_${vp.name}.png`, SCREENSHOT_OPTS);
    });

    test(`[${codes.drawer}] ${vp.name} visual wishlist drawer`, async ({ page }) => {
      await prepareWishlistDrawer(page);
      await waitForFontsReady(page);
      await expect(page).toHaveScreenshot(`layout_drawer_open_${vp.name}.png`, SCREENSHOT_OPTS);
    });

    test(`[${codes.compNormal}] ${vp.name} visual komparasi normal`, async ({ page }) => {
      await prepareComparisonNormal(page, isMobile, vp.name);
      await waitForFontsReady(page);
      await expect(page).toHaveScreenshot(`layout_comparison_${vp.name}.png`, SCREENSHOT_OPTS);
    });

    test(`[${codes.compDataSaver}] ${vp.name} visual komparasi data saver`, async ({ page }) => {
      await prepareComparisonDataSaver(page, isMobile, vp.name);
      await waitForFontsReady(page);
      await expect(page).toHaveScreenshot(`layout_comparison_datasaver_${vp.name}.png`, SCREENSHOT_OPTS);
    });
  });
}
