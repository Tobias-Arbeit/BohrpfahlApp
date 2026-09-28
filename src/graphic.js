'use strict';

/* =====================================================================
   Bodenarten (Hauptanteile lt. Vorlage: Benennung, Symbol, Zeichen, Farbe, Farbnummer)
   Untervarianten (gerundet/kantig, Grob-/Mittel-/Fein-) und Nebenanteile werden nicht verwendet.
   ===================================================================== */
const SOILS = [
  { name: 'Große Blöcke',      sym: 'LBo', farbe: 'gelb',        ncs: 'G907Y', color: '#f7ec7a', pat: 'block' },
  { name: 'Blöcke',            sym: 'Bo',  farbe: 'gelb',        ncs: 'G907Y', color: '#f7ec7a', pat: 'block' },
  { name: 'Steine',            sym: 'Co',  farbe: 'gelb',        ncs: 'G907Y', color: '#f7ec7a', pat: 'stone' },
  { name: 'Kies',              sym: 'Gr',  farbe: 'gelb',        ncs: 'G907Y', color: '#f7ec7a', pat: 'gravel' },
  { name: 'Sand',              sym: 'Sa',  farbe: 'rot-orange',  ncs: 'Y500R', color: '#f4a56d', pat: 'sand' },
  { name: 'Schluff',           sym: 'Si',  farbe: 'olivgelb',    ncs: 'G943Y', color: '#b9b66e', pat: 'silt' },
  { name: 'Ton',               sym: 'Cl',  farbe: 'violett',     ncs: 'R536B', color: '#cdbbe8', pat: 'clay' },
  { name: 'Organischer Boden', sym: 'Or',  farbe: '',            ncs: '',      color: '#e7e3da', pat: 'org' },
  { name: 'Faulschlamm',       sym: 'F',   farbe: 'steingrau',   ncs: 'S500W', color: '#c7ccd1', pat: 'mud' },
  { name: 'Torf',              sym: 'T',   farbe: 'braun',       ncs: 'Y563R', color: '#a98268', pat: 'peat' },
  { name: 'Humus',             sym: 'H',   farbe: 'braun',       ncs: 'Y563R', color: '#a98268', pat: 'humus' },
  { name: 'Mutterboden',       sym: 'Mu',  farbe: '',            ncs: '',      color: '#e7e3da', pat: 'topsoil' },
  { name: 'Anschüttung',       sym: 'A',   farbe: 'kräftigrot',  ncs: 'Y900R', color: '#f08e8e', pat: 'fill' },
  { name: 'Löß',               sym: 'Lö',  farbe: 'orange-gelb', ncs: 'Y127R', color: '#f8b93f', pat: 'loess' },
  { name: 'Lößlehm',           sym: 'LöL', farbe: 'orange-gelb', ncs: 'Y127R', color: '#f8b93f', pat: 'loam' },
  { name: 'Kohle',             sym: 'Ko',  farbe: 'schwarz',     ncs: 'S950W', color: '#2b2b2b', pat: 'coal' },
];
const soilLabel = s => `${s.name} (${s.sym})`;

/* Vom Administrator in den Projektdaten angelegte, zusätzliche Bodenarten (state.projekt.bodenartenCustom:
   [{ name, sym }]). Bekommen reihum eine Farbe aus einer kleinen Palette und ein gemeinsames, generisches
   Zeichen (Raute) in der Grafik, da für frei benannte Bodenarten keine Norm-Schraffur existiert. */
const CUSTOM_SOIL_PALETTE = ['#c9d6e3', '#e3c9d6', '#d6e3c9', '#e3d6c9', '#c9e3d6', '#d6c9e3'];
function customSoils() {
  return (state.projekt.bodenartenCustom || []).map((c, i) => ({
    name: c.name, sym: c.sym || c.name.slice(0, 2), farbe: '', ncs: '',
    color: CUSTOM_SOIL_PALETTE[i % CUSTOM_SOIL_PALETTE.length], pat: 'custom', custom: true,
  }));
}
/** Alle Bodenarten: Standardliste (SOILS) + vom Administrator angelegte zusätzliche. */
function allSoils() { return [...SOILS, ...customSoils()]; }
/** Für den Borist freigegebene Bodenarten (Projektdaten "Bodenarten für den Borist");
    ohne Einschränkung (bodenartenAktiv nicht gesetzt) stehen alle Standard-Bodenarten zur Verfügung. */
function enabledSoils() {
  const aktiv = state.projekt.bodenartenAktiv;
  const basis = Array.isArray(aktiv) ? SOILS.filter(s => aktiv.includes(s.name)) : SOILS;
  return [...basis, ...customSoils()];
}

const normSoil = s => String(s ?? '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

/** Bodenart zu einem Text finden (Name, Symbol oder Anfang des Namens); sonst null.
    Bei mehreren, kommagetrennten Bodenarten (Borist-Checkboxen) zählt für Farbe/Zeichen
    die zuerst genannte (Haupt-)Bodenart. Berücksichtigt auch vom Administrator angelegte Bodenarten. */
function soilOf(text) {
  const n = normSoil(String(text ?? '').split(',')[0]);
  if (!n) return null;
  const all = allSoils();
  return all.find(s => normSoil(s.name) === n || normSoil(s.sym) === n) ||
    all.find(s => n.startsWith(normSoil(s.name))) ||
    all.find(s => n.includes(normSoil(s.name)) && normSoil(s.name).length > 3) || null;
}

/* Schraffuren (Zeichen) als Muster; einmal im Dokument definiert und überall per url(#…) verwendet */
const SOIL_PATTERNS = {
  block:   '<path d="M1 11 a4 4 0 0 1 8 0z"/><path d="M8 4.5 l3 5 h-6z"/>',
  stone:   '<path d="M1 11 a4 4 0 0 1 8 0z"/><circle cx="10" cy="3.5" r="1.3"/>',
  gravel:  '<circle cx="3" cy="3" r="1.6"/><path d="M8 8 l2 3.5 h-4z"/><circle cx="9.5" cy="2.5" r=".6" fill="#2b2b2b"/>',
  sand:    '<g fill="#2b2b2b" stroke="none"><circle cx="2" cy="2" r=".8"/><circle cx="8" cy="5" r=".8"/><circle cx="4" cy="9" r=".8"/><circle cx="10" cy="10.5" r=".8"/></g>',
  silt:    '<path d="M1 10 L5 6 M7 10 L11 6"/>',
  clay:    '<path d="M1 4 h6 M5 9 h6"/>',
  org:     '<circle cx="6" cy="6" r="2.2"/>',
  mud:     '<path d="M0 4 h12 M0 9 h12"/><circle cx="3" cy="6.5" r=".7" fill="#2b2b2b"/>',
  peat:    '<path d="M0 4 q1.5 -2 3 0 t3 0 t3 0 t3 0 M0 9.5 q1.5 -2 3 0 t3 0 t3 0 t3 0"/>',
  humus:   '<path d="M2 2 v8 M6 2 v8 M2 6 h4 M9 4 h3 M9 8 h3"/>',
  topsoil: '<text x="1" y="8.5" font-size="7.5" font-family="sans-serif" fill="#2b2b2b" stroke="none">Mu</text>',
  fill:    '<text x="3" y="9" font-size="8" font-family="sans-serif" fill="#2b2b2b" stroke="none">A</text>',
  loess:   '<path d="M3 2 v3 M9 7 v3"/><circle cx="8" cy="3" r=".6" fill="#2b2b2b"/><circle cx="3" cy="9" r=".6" fill="#2b2b2b"/>',
  loam:    '<path d="M0 12 L12 0 M-3 3 L3 -3 M9 15 L15 9"/>',
  coal:    '<rect width="12" height="12" fill="#111" stroke="none"/>',
  custom:  '<path d="M6 1 L11 6 L6 11 L1 6 Z"/>',   // generisches Zeichen für vom Administrator angelegte Bodenarten
};

(function injectDefs() {
  const pats = Object.entries(SOIL_PATTERNS).map(([k, body]) =>
    `<pattern id="pgs-${k}" width="12" height="12" patternUnits="userSpaceOnUse"><g fill="none" stroke="#2b2b2b" stroke-width=".7" opacity=".85">${body}</g></pattern>`).join('');
  const extra = `
    <pattern id="pgHind" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#a9744a"/><line x1="0" y1="0" x2="0" y2="6" stroke="#5b3a1f" stroke-width="2"/></pattern>
    <pattern id="pgHart" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#9aa1ab"/><line x1="0" y1="0" x2="0" y2="6" stroke="#4b525c" stroke-width="2"/></pattern>
    <pattern id="pgWater" width="8" height="6" patternUnits="userSpaceOnUse"><path d="M0 3 q2 -3 4 0 t4 0" fill="none" stroke="#2563eb" stroke-width="0.8" opacity=".55"/></pattern>`;
  document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${pats}${extra}</defs></svg>`);
})();

/** Kleines Vorschau-Symbol (Farbe + Zeichen) für eine Schicht */
function soilSwatch(art, boden) {
  const w = 26, h = 18;
  let bg = '#e7e3da', pat = null;
  if (art === 'hindernis') pat = 'url(#pgHind)';
  else if (art === 'hart') pat = 'url(#pgHart)';
  else { const s = soilOf(boden); if (s) { bg = s.color; pat = `url(#pgs-${s.pat})`; } }
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><rect width="${w}" height="${h}" rx="3" fill="${bg}"/>${pat ? `<rect width="${w}" height="${h}" rx="3" fill="${pat}"/>` : ''}<rect width="${w}" height="${h}" rx="3" fill="none" stroke="#7a6a45" stroke-width=".8"/></svg>`;
}

/* =====================================================================
   Grafische Übersicht eines Pfahls (Schnitt)
   Tiefen werden ab Bohrebene (= Arbeitsebene) gemessen. Links das Bodenaufschluss-Profil,
   daneben der Pfahl (Soll gestrichelt, Ist gefüllt), das Grundwasser und „Bohren im GW“.
   ===================================================================== */
const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pileGraphicSvg(p) {
  const W = 340;
  const AEs = p.sArbeitsebene, AEi = isNum(p.arbeitsebene) ? p.arbeitsebene : p.sArbeitsebene;
  // Tiefen ab Bohrebene: OK (Leerbohrung) und UK (Bohrlänge) für Soll und Ist
  const dS = { ok: diff(AEs, p.sOberkante), uk: diff(AEs, p.sUnterkante) };
  const dI = { ok: diff(AEi, p.oberkante), uk: diff(AEi, p.unterkante) };
  const hasS = isNum(dS.ok) && isNum(dS.uk), hasI = isNum(dI.ok) && isNum(dI.uk);
  const layers = layerSpans(p);
  const lastBis = layers.length ? layers[layers.length - 1].bis : null;
  const gw = isNum(p.gwTiefe) ? p.gwTiefe : null;

  const depths = [0, hasS && dS.ok, hasS && dS.uk, hasI && dI.ok, hasI && dI.uk, lastBis, gw].filter(isNum);
  if (!hasS && !hasI && !layers.length) {
    return `<div class="pg-empty">Für die Grafik Arbeitsebene, Pfahl-OK und Pfahl-UK (Soll) eintragen – oder Ist-Werte bzw. das Bodenaufschluss-Profil.</div>`;
  }
  const top = Math.min(0, ...depths) - 0.6, bot = Math.max(...depths) + 0.8;
  const range = bot - top;
  const sc = Math.min(26, 400 / range);                        // Pixel je Meter
  const M = 22;                                                // Rand oben/unten
  const H = Math.round(range * sc + 2 * M);
  const Y = d => M + (d - top) * sc;

  const sx = { x: 44, w: 104 };                                // Bodenprofil
  const pS = { x: 160, w: 22 }, pI = { x: 188, w: 28 };       // Pfahl Soll / Ist
  const rx = 226;                                              // Beschriftungen rechts

  const o = [];
  const used = new Map();                                      // für die Legende
  o.push(`<svg class="pg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Schnitt: Arbeitsebene, Bodenaufschluss, Pfahl und Grundwasser">`);

  // Luftbereich oberhalb der Bohrebene
  o.push(`<rect class="pg-bg" x="${sx.x}" y="${Y(top)}" width="${sx.w}" height="${Y(0) - Y(top)}"/>`);

  // Bodenaufschluss
  let lastTick = Y(0);
  if (layers.length) {
    layers.forEach((l, i) => {
      const y1 = Y(l.von), y2 = Y(l.bis), h = Math.max(1, y2 - y1);
      const soil = l.art === 'boden' ? soilOf(l.boden) : null;
      let base, pattern;
      if (l.art === 'hindernis') { base = null; pattern = 'url(#pgHind)'; used.set('hindernis', { label: 'Bohrhindernis', sw: soilSwatch('hindernis') }); }
      else if (l.art === 'hart') { base = null; pattern = 'url(#pgHart)'; used.set('hart', { label: 'harte Bodenschicht', sw: soilSwatch('hart') }); }
      else if (soil) { base = soil.color; pattern = `url(#pgs-${soil.pat})`; used.set(soil.sym, { label: soilLabel(soil), sw: soilSwatch('boden', soil.name) }); }
      else { base = '#e7e3da'; pattern = null; if (l.boden) used.set('x:' + l.boden, { label: l.boden, sw: soilSwatch('boden', '') }); }
      if (base) o.push(`<rect x="${sx.x}" y="${y1}" width="${sx.w}" height="${h}" fill="${base}"/>`);
      if (pattern) o.push(`<rect x="${sx.x}" y="${y1}" width="${sx.w}" height="${h}" fill="${pattern}"/>`);
      o.push(`<rect x="${sx.x}" y="${y1}" width="${sx.w}" height="${h}" fill="none" stroke="#7a6a45" stroke-width=".6"/>`);

      // Beschriftung im Profil: Symbol/Name bzw. Titel und Hinweis
      const clip = s => (s.length > 19 ? s.slice(0, 18) + '…' : s);
      const cx = sx.x + sx.w / 2;
      const dark = soil && soil.pat === 'coal';
      const lightTxt = l.art !== 'boden' || dark;
      const cls = `pg-soil${lightTxt ? ' light' : ''} pg-halo`;
      const title = l.art === 'hindernis' ? 'Bohrhindernis' : l.art === 'hart' ? 'harte Bodenschicht' : '';
      if (title && l.boden && h >= 28) {
        o.push(`<text x="${cx}" y="${y1 + h / 2 - 1.5}" text-anchor="middle" class="${cls}">${esc2(title)}</text>`);
        o.push(`<text x="${cx}" y="${y1 + h / 2 + 9.5}" text-anchor="middle" class="${cls}">${esc2(clip(l.boden))}</text>`);
      } else {
        const txt = title ? [title, l.boden].filter(Boolean).join(' – ') : (soil ? soilLabel(soil) : l.boden);
        if (txt && h >= 12) o.push(`<text x="${cx}" y="${y1 + h / 2 + 3.5}" text-anchor="middle" class="${cls}">${esc2(clip(txt))}</text>`);
      }
      // Tiefenmarke an der Unterkante der Schicht (nur, wenn genug Abstand zur vorigen Zahl)
      o.push(`<line x1="${sx.x - 4}" y1="${y2}" x2="${sx.x}" y2="${y2}" class="pg-tick"/>`);
      if (y2 - lastTick >= 11 || i === layers.length - 1) {
        o.push(`<text x="${sx.x - 6}" y="${y2 + 3.5}" text-anchor="end" class="pg-axis">${fmtPlain(l.bis, 2)}</text>`);
        lastTick = y2;
      }
    });
  } else {
    o.push(`<rect x="${sx.x}" y="${Y(0)}" width="${sx.w}" height="${Y(bot) - Y(0)}" class="pg-bg"/>`);
    o.push(`<text x="${sx.x + sx.w / 2}" y="${Y(0) + 16}" text-anchor="middle" class="pg-axis">Bodenaufschluss</text><text x="${sx.x + sx.w / 2}" y="${Y(0) + 29}" text-anchor="middle" class="pg-axis">noch nicht erfasst</text>`);
  }

  // Grundwasser
  if (gw != null) {
    o.push(`<rect x="${sx.x}" y="${Y(gw)}" width="${pI.x + pI.w + 8 - sx.x}" height="${Y(bot) - Y(gw)}" fill="url(#pgWater)"/>`);
    o.push(`<rect x="${sx.x}" y="${Y(gw)}" width="${pI.x + pI.w + 8 - sx.x}" height="${Y(bot) - Y(gw)}" fill="#2563eb" opacity=".10"/>`);
    o.push(`<line x1="${sx.x - 4}" y1="${Y(gw)}" x2="${pI.x + pI.w + 8}" y2="${Y(gw)}" stroke="#2563eb" stroke-width="1.6" stroke-dasharray="5 3"/>`);
  }

  // Bohrebene / Arbeitsebene
  o.push(`<line x1="${sx.x - 4}" y1="${Y(0)}" x2="${pI.x + pI.w + 8}" y2="${Y(0)}" class="pg-ground"/>`);
  o.push(`<text x="${sx.x - 6}" y="${Y(0) + 3.5}" text-anchor="end" class="pg-axis">0,00</text>`);

  // Pfahl (Soll gestrichelt, Ist gefüllt); darüber die Leerbohrung als offene Bohrung
  const drawPile = (d, px, kind) => {
    const y1 = Y(d.ok), y2 = Y(d.uk);
    if (kind === 'soll') o.push(`<rect x="${px.x}" y="${y1}" width="${px.w}" height="${y2 - y1}" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="4 3"/>`);
    else o.push(`<rect x="${px.x}" y="${y1}" width="${px.w}" height="${y2 - y1}" class="pg-pile"/>`);
    if (d.ok > 0.001) o.push(`<line x1="${px.x}" y1="${Y(0)}" x2="${px.x}" y2="${y1}" class="pg-bore"/><line x1="${px.x + px.w}" y1="${Y(0)}" x2="${px.x + px.w}" y2="${y1}" class="pg-bore"/>`);
  };
  if (hasS) drawPile(dS, pS, 'soll');
  if (hasI) drawPile(dI, pI, 'ist');

  // Bohren im Grundwasser: Teil des Pfahls unterhalb des Grundwasserspiegels
  const ref = hasI ? dI : (hasS ? dS : null);
  if (gw != null && ref && ref.uk > gw) {
    const y1 = Y(Math.max(gw, ref.ok)), y2 = Y(ref.uk), bx = pI.x + pI.w + 8;
    o.push(`<path d="M${bx} ${y1} h5 v${y2 - y1} h-5" fill="none" stroke="#2563eb" stroke-width="1.6"/>`);
    o.push(`<text transform="translate(${bx + 15} ${(y1 + y2) / 2}) rotate(-90)" text-anchor="middle" class="pg-gwtxt">Bohren im GW ${isNum(p.grundwasser) ? fmtPlain(p.grundwasser, 3) : fmtPlain(ref.uk - Math.max(gw, ref.ok), 3)} m</text>`);
  }

  // Beschriftungen rechts (mit Abstandsprüfung)
  const eS = { ok: p.sOberkante, uk: p.sUnterkante }, eI = { ok: p.oberkante, uk: p.unterkante };
  const val = (s, i) => [isNum(s) ? 'S ' + fmtPlain(s, 3) : '', isNum(i) ? 'I ' + fmtPlain(i, 3) : ''].filter(Boolean).join('  ');
  const labels = [];
  const add = (depth, title, sub, cls = '') => { if (isNum(depth)) labels.push({ y: Y(depth), title, sub, cls }); };
  add(0, 'Arbeitsebene', val(AEs, p.arbeitsebene));
  add(hasI ? dI.ok : hasS ? dS.ok : null, 'Pfahl-OK', val(eS.ok, eI.ok));
  add(hasI ? dI.uk : hasS ? dS.uk : null, 'Pfahl-UK', val(eS.uk, eI.uk));
  if (gw != null) add(gw, 'Grundwasser ab', fmtPlain(gw, 2) + ' m u. Bohrebene', 'gw');
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 26) labels[i].y = labels[i - 1].y + 26;
  labels.forEach(l => {
    o.push(`<text x="${rx}" y="${l.y - 1}" class="pg-lbl ${l.cls}">${esc2(l.title)}</text>`);
    if (l.sub) o.push(`<text x="${rx}" y="${l.y + 10}" class="pg-sub">${esc2(l.sub)}</text>`);
  });

  // Kopfzeile
  o.push(`<text x="${pS.x + pS.w / 2}" y="${M - 8}" text-anchor="middle" class="pg-head">Soll</text><text x="${pI.x + pI.w / 2}" y="${M - 8}" text-anchor="middle" class="pg-head">Ist</text>`);
  o.push(`<text x="${sx.x + sx.w / 2}" y="${M - 8}" text-anchor="middle" class="pg-head">Bodenaufschluss</text>`);
  o.push(`</svg>`);

  // Legende der verwendeten Bodenarten
  const legend = used.size
    ? `<ul class="pg-leg">${[...used.values()].map(u => `<li>${u.sw}<span>${esc2(u.label)}</span></li>`).join('')}</ul>` : '';
  return o.join('') + legend;
}
