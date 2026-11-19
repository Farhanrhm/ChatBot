/**
 * Memastikan seluruh font web selesai dimuat dan siap dirender oleh DOM peramban.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForFontsReady(page) {
  await page.evaluate(() => document.fonts?.ready);
}
