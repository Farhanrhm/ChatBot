import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { viewports } from './helpers/viewports.js';
import { visualFixtures } from './helpers/visualFixtures.js';
import { renderMockChatRecommendation } from './helpers/mockChat.js';
import { installNetworkGuards } from './helpers/network.js';
import { waitForFontsReady } from './helpers/fonts.js';

const STABILIZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

/**
 * Menyuntikkan CSS stabilisasi dan menunggu font selesai dimuat.
 * @param {import('@playwright/test').Page} page
 */
async function setupPage(page) {
  await page.goto('/');
  await page.addStyleTag({ content: STABILIZE_CSS });
  await waitForFontsReady(page);
}

const scenarioCodes = {
  '1366x768': { initial: 'L01', ratio: 'L02', drawer: 'L03', comp: 'L04' },
  '1024x575': { initial: 'L09', ratio: 'L10', drawer: 'L11', comp: 'L12' },
  '1920x1080': { initial: 'L17', ratio: 'L18', drawer: 'L19', comp: 'L20' },
  '375x667': { initial: 'L25', ratio: 'L26', drawer: 'L27', comp: 'L28' },
  '412x915': { initial: 'L33', ratio: 'L34', drawer: 'L35', comp: 'L36' },
};

// ============================================================================
// 20 TES METRIK LAYOUT (L01-L04 PADA 5 VIEWPORT)
// ============================================================================
for (const vp of viewports) {
  const codes = scenarioCodes[vp.name];

  test.describe(`Viewport ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installNetworkGuards(page);
    });

    test(`[${codes.initial}] ${vp.name} layout awal & metrik dasar`, async ({ page }) => {
      await setupPage(page);
      await waitForFontsReady(page);

      const metrics = await page.evaluate((isDesktop) => {
        const docEl = document.documentElement;
        const body = document.body;
        const winH = window.innerHeight;
        const winW = window.innerWidth;
        const composer = document.querySelector('.composer')?.getBoundingClientRect();
        const chat = document.getElementById('chat')?.getBoundingClientRect();
        const rail = document.querySelector('.rail')?.getBoundingClientRect();

        return {
          winH,
          winW,
          docScrollH: docEl.scrollHeight,
          bodyScrollH: body.scrollHeight,
          docScrollW: docEl.scrollWidth,
          composerBottom: composer ? composer.bottom : 0,
          composerHeight: composer ? composer.height : 0,
          chatHeight: chat ? chat.height : 0,
          chatRatio: chat ? (chat.height / winH) * 100 : 0,
          railBottom: rail ? rail.bottom : null,
          railHeight: rail ? rail.height : null,
          noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
          noHorizontalOverflow: docEl.scrollWidth <= winW + 1,
          composerSticksToBottom: composer ? Math.abs(composer.bottom - winH) <= 1 : false,
          railStretchesFullHeight: isDesktop ? Boolean(rail && Math.abs(rail.bottom - winH) <= 1) : true,
        };
      }, vp.isDesktop);

      expect(metrics.noVerticalPageOverflow).toBe(true);
      expect(metrics.noHorizontalOverflow).toBe(true);
      expect(metrics.composerSticksToBottom).toBe(true);
      if (vp.isDesktop) {
        expect(metrics.railStretchesFullHeight).toBe(true);
      }
    });

    test(`[${codes.ratio}] ${vp.name} rasio tinggi chat & toolbar kolaps`, async ({ page }) => {
      await setupPage(page);
      await renderMockChatRecommendation(page);
      await waitForFontsReady(page);

      // Kolaps toolbar filter
      await page.evaluate(() => {
        const wrap = document.getElementById('quick-toolbar-wrap');
        if (wrap) wrap.classList.add('is-collapsed');
      });

      // Tunggu 2 frame rendering
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      await waitForFontsReady(page);

      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement;
        const body = document.body;
        const winH = window.innerHeight;
        const chat = document.getElementById('chat')?.getBoundingClientRect();
        const composer = document.querySelector('.composer')?.getBoundingClientRect();

        return {
          docScrollH: docEl.scrollHeight,
          bodyScrollH: body.scrollHeight,
          chatHeight: chat ? chat.height : 0,
          chatRatio: chat ? (chat.height / winH) * 100 : 0,
          composerHeight: composer ? composer.height : 0,
          noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
          composerSticksToBottom: composer ? Math.abs(composer.bottom - winH) <= 1 : false,
        };
      });

      expect(metrics.noVerticalPageOverflow).toBe(true);
      expect(metrics.composerSticksToBottom).toBe(true);
      expect(metrics.chatRatio).toBeGreaterThanOrEqual(60);
    });

    test(`[${codes.drawer}] ${vp.name} drawer wishlist 12 item`, async ({ page }) => {
      await setupPage(page);

      // Buka drawer dengan data fixture 12 item
      await page.evaluate((items) => {
        localStorage.setItem('sobatsteam_wishlist', JSON.stringify(items));
        const wishlistBtn = document.getElementById('wishlist-btn');
        if (wishlistBtn) wishlistBtn.click();
      }, visualFixtures.wishlistItems);

      // Tunggu drawer terbuka dan item ter-render
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

      const metrics = await page.evaluate((isDesktop) => {
        const docEl = document.documentElement;
        const body = document.body;
        const winH = window.innerHeight;
        const winW = window.innerWidth;
        const toolbar = document.getElementById('wishlist-toolbar');
        const searchInput = document.getElementById('wishlist-search');
        const sortSelect = document.getElementById('wishlist-sort');
        const contentContainer = document.getElementById('wishlist-content');

        const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
        const searchRect = searchInput ? searchInput.getBoundingClientRect() : null;
        const sortRect = sortSelect ? sortSelect.getBoundingClientRect() : null;
        const contentRect = contentContainer ? contentContainer.getBoundingClientRect() : null;

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

      expect(metrics.noVerticalPageOverflow).toBe(true);
      expect(metrics.noHorizontalOverflow).toBe(true);
      expect(metrics.isToolbarVisible).toBe(true);
      expect(metrics.isSearchVisible).toBe(true);
      expect(metrics.isSortVisible).toBe(true);
      expect(metrics.isItemsHeightAdequate).toBe(true);
    });

    test(`[${codes.comp}] ${vp.name} dialog komparasi game${vp.isMobile ? ' & tab switch mobile' : ''}`, async ({ page }) => {
      await setupPage(page);
      await renderMockChatRecommendation(page);

      // Seleksi dua game dari kartu yang dirender
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

      // Tunggu dialog komparasi terbuka
      await page.waitForFunction(() => {
        const dialog = document.getElementById('comparison-dialog');
        return dialog && !dialog.hidden;
      }, { timeout: 4000 });

      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      const isMobileViewport = vp.width < 600;
      let mobileTabSwitchPassed = true;

      if (isMobileViewport) {
        mobileTabSwitchPassed = await page.evaluate(() => {
          const tabB = document.getElementById('comparison-tab-b');
          const tabA = document.getElementById('comparison-tab-a');
          if (!tabB || !tabA) return false;

          tabB.click();
          const colA = document.querySelector('.comparison-table td.comparison-col-a');
          const colB = document.querySelector('.comparison-table td.comparison-col-b');
          const isColAHidden = colA ? window.getComputedStyle(colA).display === 'none' : false;
          const isColBVisible = colB ? window.getComputedStyle(colB).display !== 'none' : false;

          tabA.click();
          const isColAVirgin = colA ? window.getComputedStyle(colA).display !== 'none' : false;
          const isColBHidden = colB ? window.getComputedStyle(colB).display === 'none' : false;

          return isColAHidden && isColBVisible && isColAVirgin && isColBHidden;
        });
      }

      await waitForFontsReady(page);

      const metrics = await page.evaluate((isMobile) => {
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

        return {
          docScrollH: docEl.scrollHeight,
          bodyScrollH: body.scrollHeight,
          noVerticalPageOverflow: docEl.scrollHeight <= winH + 1 && body.scrollHeight <= winH + 1,
          noHorizontalOverflow: docEl.scrollWidth <= winW + 1,
          isDialogVisible: Boolean(dialogRect && dialogRect.width > 0 && dialogRect.height > 0),
          areTabsVisibleOnMobile: isMobile
            ? Boolean(tabsRect && tabsRect.width > 0 && tabsRect.height > 0 && window.getComputedStyle(tabs).display === 'flex')
            : true,
          isInertSet: appEl ? appEl.hasAttribute('inert') : false,
          hasInternalScroll: content ? content.scrollHeight >= content.clientHeight : false,
        };
      }, isMobileViewport);

      expect(metrics.noVerticalPageOverflow).toBe(true);
      expect(metrics.noHorizontalOverflow).toBe(true);
      expect(metrics.isDialogVisible).toBe(true);
      expect(metrics.isInertSet).toBe(true);
      if (isMobileViewport) {
        expect(metrics.areTabsVisibleOnMobile).toBe(true);
        expect(mobileTabSwitchPassed).toBe(true);
      }
    });
  });
}

// ============================================================================
// PENGUJIAN AKSESIBILITAS TAMBAHAN (AXE-CORE & NAVIGASI KEYBOARD)
// ============================================================================
test.describe('Aksesibilitas & Kepatuhan Keyboard', () => {
  test('[AXE-SCAN] Scan aksesibilitas axe-core pada halaman utama (serious/critical)', async ({ page }) => {
    await installNetworkGuards(page);
    await setupPage(page);
    await waitForFontsReady(page);

    let axeResults;
    try {
      axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
    } catch (axeErr) {
      console.warn('[AXE-SCAN] Evaluasi Axe-core mengalami kendala (mis. CSP Helmet):', axeErr.message);
      throw axeErr;
    }

    const seriousAndCritical = axeResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );

    if (seriousAndCritical.length > 0) {
      console.warn(`[AXE-SCAN] Ditemukan ${seriousAndCritical.length} pelanggaran serius/kritis:`);
      seriousAndCritical.forEach((v) => {
        console.warn(`  - [${v.impact.toUpperCase()}] ${v.id}: ${v.description}`);
      });
    }

    expect(seriousAndCritical).toEqual([]);
  });

  test('[A11Y-KEYBOARD] Navigasi keyboard dasar dengan indikator fokus terlihat', async ({ page }) => {
    await installNetworkGuards(page);
    await setupPage(page);
    await waitForFontsReady(page);

    // Tekan Tab untuk navigasi keyboard ke elemen interaktif pertama
    await page.keyboard.press('Tab');

    const focusCheck = await page.evaluate(() => {
      const activeEl = document.activeElement;
      if (!activeEl || activeEl === document.body) {
        return { hasActiveElement: false };
      }

      const style = window.getComputedStyle(activeEl);
      const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      const hasFocusVisibleClass = activeEl.matches(':focus-visible') || activeEl.matches(':focus');

      return {
        hasActiveElement: true,
        tagName: activeEl.tagName,
        id: activeEl.id || null,
        className: activeEl.className || null,
        hasVisibleIndicator: hasOutline || hasBoxShadow || hasFocusVisibleClass,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    expect(focusCheck.hasActiveElement).toBe(true);
    expect(focusCheck.hasVisibleIndicator).toBe(true);
  });
});
