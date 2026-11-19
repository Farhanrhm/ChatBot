/**
 * Daftar 5 viewport standar pengujian SobatSteam.
 * Memuat penanda mobile untuk lebar <= 412.
 */
export const viewports = [
  { width: 1366, height: 768, name: '1366x768', isDesktop: true, isMobile: false },
  { width: 1024, height: 575, name: '1024x575', isDesktop: true, isMobile: false },
  { width: 1920, height: 1080, name: '1920x1080', isDesktop: true, isMobile: false },
  { width: 375, height: 667, name: '375x667', isDesktop: false, isMobile: true },
  { width: 412, height: 915, name: '412x915', isDesktop: false, isMobile: true },
];

/**
 * Memeriksa apakah viewport tergolong mobile (lebar <= 412).
 * @param {{ width: number } | number} vp
 * @returns {boolean}
 */
export function isMobileViewport(vp) {
  const width = typeof vp === 'number' ? vp : vp?.width;
  return typeof width === 'number' && width <= 412;
}
