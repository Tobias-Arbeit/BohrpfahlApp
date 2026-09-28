'use strict';

/* =====================================================================
   Marke: Logo und Farben von https://www.kellergrundbau.at/
   Farben: Marineblau #003366 (Logo, Links), Dunkelblau #011343 (Text), Gelb #FDC600 (Hauptbutton),
   Hintergrund #EDF1F4, Rahmen #CCD6E0.
   ===================================================================== */

/* Logo-Formen (Original-SVG der Seite, Größe 165 × 48) */
const KELLER_LOGO_PATHS = [
  ['n', 'M23.9314 35.692L12.2743 24C14.7333 31.5944 12.2734 47.3839 12.2734 47.3839L23.9314 35.692Z'],
  ['y', 'M10.8723 25.4102L0.617188 35.6935L9.73821 44.8412C11.8015 38.4589 12.1809 31.7529 10.8723 25.4102Z'],
  ['n', 'M23.9314 12.3091L12.2743 0.617188C14.7333 8.21158 12.2734 24.0011 12.2734 24.0011L23.9314 12.3091Z'],
  ['y', 'M10.8723 2.02734L0.617188 12.3107L9.73821 21.4583C11.8015 15.0761 12.1809 8.37012 10.8723 2.02734Z'],
  ['n', 'M59.3594 12.3105H78.2529V17.6721H66.3261V21.2831H76.1289V26.3323H66.3261V30.328H79.0788V35.6937H59.3594V12.3105Z'],
  ['n', 'M80.7344 12.3105H87.7028V30.222H99.3943V35.6937H80.7344V12.3105Z'],
  ['n', 'M101.047 12.3105H108.014V30.222H119.706V35.6937H101.047V12.3105Z'],
  ['n', 'M121.359 12.3105H140.255V17.6721H128.329V21.2831H138.131V26.3323H128.329V30.328H141.082V35.6937H121.359V12.3105Z'],
  ['n', 'M142.734 12.3105H153.6C155.018 12.3105 156.296 12.4734 157.437 12.802C158.58 13.1266 159.558 13.6148 160.369 14.2533C161.184 14.8968 161.814 15.7006 162.261 16.6588C162.707 17.6129 162.929 18.724 162.929 19.988C162.929 21.5297 162.55 22.8651 161.786 23.9984C161.026 25.1383 160.017 26.0381 158.756 26.7161L164.386 35.6937H156.908L152.457 27.7352H149.545V35.6937H142.734V12.3105ZM152.93 22.861C153.848 22.861 154.598 22.6128 155.176 22.1099C155.752 21.6045 156.043 20.933 156.043 20.0923C156.043 19.2023 155.764 18.5029 155.215 17.9835C154.662 17.4773 153.888 17.2176 152.893 17.2176H149.545V22.861H152.93Z'],
  ['n', 'M58.5335 12.3105H49.6657L42.3982 19.5943V12.3105H35.5938V35.6928H42.3982V28.4091L49.6657 35.6928H58.5335L46.8739 24.0058L58.5335 12.3105Z'],
];

/** Logo als Inline-SVG. Die blauen Teile folgen der Textfarbe (weiß im Dunkelmodus). */
function brandLogoSvg(height = 34, fixedColors = false) {
  const navy = fixedColors ? 'fill="#003366"' : 'class="k-navy"';
  const paths = KELLER_LOGO_PATHS.map(([c, d]) => `<path d="${d}" ${c === 'y' ? 'fill="#FDC600"' : navy}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 165 48" height="${height}" width="${Math.round(height * 165 / 48)}" role="img" aria-label="Keller">${paths}</svg>`;
}

document.querySelectorAll('[data-brand]').forEach(el => { el.innerHTML = brandLogoSvg(+el.dataset.brand || 34); });

/* Logo als PNG für das PDF-Protokoll (wenn im Projekt kein eigenes Logo hinterlegt ist) */
let KELLER_LOGO = null;                                       // { data, w, h }
(function makePng() {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 660; c.height = 192;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    KELLER_LOGO = { data: c.toDataURL('image/png'), w: c.width, h: c.height };
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(brandLogoSvg(48, true));
})();
