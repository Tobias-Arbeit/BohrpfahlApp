'use strict';

/* =====================================================================
   Bohrprotokoll (PDF, eine A4-Seite je Pfahl) – Layout nach „Beispiel Bohrpfahlprotokoll_V02“
   Alle Koordinaten sind Punkt (pt) in der Ebene der Vorlage (612 × 792, Ursprung oben links).
   Für A4 wird das Blatt um (DX, DY) verschoben; Schriftgrößen der Vorlage (Calibri) werden
   für Helvetica mit dem Faktor F verkleinert.
   ===================================================================== */

/** Verteilt die Höhe A auf die Schichten (proportional zur Mächtigkeit, mindestens mins[i] je Schicht). */
function allocateHeights(raw, A, mins) {
  const n = raw.length;
  if (!n) return [];
  if (mins.reduce((a, b) => a + b, 0) >= A) return mins.map(m => m * A / mins.reduce((a, b) => a + b, 0));
  const small = raw.map((v, i) => v < mins[i]);
  let h = raw.slice();
  for (let it = 0; it < 12; it++) {
    const fixed = raw.reduce((s, v, i) => s + (small[i] ? mins[i] : 0), 0);
    const bigSum = raw.reduce((s, v, i) => s + (small[i] ? 0 : v), 0);
    if (!bigSum) return mins.slice();
    const rest = A - fixed;
    h = raw.map((v, i) => small[i] ? mins[i] : v / bigSum * rest);
    let changed = false;
    h.forEach((v, i) => { if (!small[i] && v < mins[i]) { small[i] = true; changed = true; } });
    if (!changed) break;
  }
  return h;
}

/** Zeichen (Schraffur) einer Bodenart in ein Rechteck zeichnen (Seitenkoordinaten in pt, nur ganze Kacheln). */
function drawSoilMarks(doc, pat, x, y, w, h, dark = [43, 43, 43]) {
  const TL = 11, s = TL / 12;
  const cols = Math.floor(w / TL), rows = Math.floor(h / TL);
  if (cols < 1 || rows < 1 || pat === 'coal') return;
  const ox = x + (w - cols * TL) / 2, oy = y + (h - rows * TL) / 2;
  doc.setDrawColor(...dark); doc.setFillColor(...dark); doc.setLineWidth(0.35);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bx = ox + c * TL, by = oy + r * TL;
      const ln = (x1, y1, x2, y2) => doc.line(bx + x1 * s, by + y1 * s, bx + x2 * s, by + y2 * s);
      const ci = (cx, cy, rr, fill) => doc.circle(bx + cx * s, by + cy * s, rr * s, fill ? 'F' : 'S');
      const tri = (a, b, c2, d, e, f) => doc.triangle(bx + a * s, by + b * s, bx + c2 * s, by + d * s, bx + e * s, by + f * s, 'S');
      const dome = (cx, cy, rr) => {                       // Halbkreis nach oben
        const pts = []; for (let k = 0; k <= 6; k++) { const a = Math.PI + Math.PI * k / 6; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
        for (let k = 0; k < pts.length - 1; k++) ln(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
        ln(pts.at(-1)[0], pts.at(-1)[1], pts[0][0], pts[0][1]);
      };
      const wave = yy => { for (let k = 0; k < 4; k++) ln(k * 3, yy + (k % 2 ? 1 : -1), k * 3 + 3, yy + (k % 2 ? -1 : 1)); };
      switch (pat) {
        case 'block':   dome(5, 11, 4); tri(8, 4.5, 11, 9.5, 5, 9.5); break;
        case 'stone':   dome(5, 11, 4); ci(10, 3.5, 1.3); break;
        case 'gravel':  ci(3, 3, 1.6); tri(8, 8, 10, 11.5, 6, 11.5); ci(9.5, 2.5, .6, true); break;
        case 'sand':    ci(2, 2, .8, true); ci(8, 5, .8, true); ci(4, 9, .8, true); ci(10, 10.5, .8, true); break;
        case 'silt':    ln(1, 10, 5, 6); ln(7, 10, 11, 6); break;
        case 'clay':    ln(1, 4, 7, 4); ln(5, 9, 11, 9); break;
        case 'org':     ci(6, 6, 2.2); break;
        case 'mud':     ln(0, 4, 12, 4); ln(0, 9, 12, 9); ci(3, 6.5, .7, true); break;
        case 'peat':    wave(4); wave(9.5); break;
        case 'humus':   ln(2, 2, 2, 10); ln(6, 2, 6, 10); ln(2, 6, 6, 6); ln(9, 4, 12, 4); ln(9, 8, 12, 8); break;
        case 'topsoil': doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.text('Mu', bx + 1 * s, by + 8.5 * s); break;
        case 'fill':    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('A', bx + 3.5 * s, by + 9 * s); break;
        case 'loess':   ln(3, 2, 3, 5); ln(9, 7, 9, 10); ci(8, 3, .6, true); ci(3, 9, .6, true); break;
        case 'loam':    ln(0, 12, 12, 0); ln(0, 6, 6, 0); ln(6, 12, 12, 6); break;
        case 'hatch':   ln(0, 12, 12, 0); ln(0, 6, 6, 0); ln(6, 12, 12, 6); break;       // Bohrhindernis / harte Bodenschicht
        case 'hatchR':  ln(0, 0, 12, 12); ln(6, 0, 12, 6); ln(0, 6, 6, 12); break;
      }
    }
  }
}

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** „Block00“ → „Block 00“, „C25-30“ → „C25/30“ (übliche Schreibweise im Protokoll) */
const protoBewTyp = s => String(s || '').replace(/^(Block)\s*(\d+)$/i, '$1 $2');

function drawProtokoll(doc, p, proj) {
  const DX = 5.3, DY = 21.6, F = 0.9;
  const X = x => x + DX, Y = y => y + DY;
  const hb = proj.hoehenbezug || 'm ü. A';

  // Keller-Farben (kellergrundbau.at)
  const NAVY = [0, 51, 102], INK = [1, 19, 67], YEL = [253, 198, 0], BG = [237, 241, 244], MID = [120, 138, 165], LINEC = [178, 190, 206];
  doc.setDrawColor(...NAVY);
  doc.setTextColor(...INK);
  doc.setLineDashPattern([], 0);

  /** Linie: dicke Trennlinien in Marineblau, feine Rasterlinien hellgrau */
  const L = (x1, y1, x2, y2, w = 0.8) => {
    doc.setDrawColor(...(w >= 1.5 ? NAVY : w >= 0.85 ? MID : LINEC));
    doc.setLineWidth(w); doc.line(X(x1), Y(y1), X(x2), Y(y2)); doc.setDrawColor(...NAVY);
  };
  /** Farbfläche (Koordinaten der Vorlage) */
  const FILL = (x, y, w, h, c) => { doc.setFillColor(...c); doc.rect(X(x), Y(y), w, h, 'F'); };
  /** Text; size = Schriftgröße der Vorlage, maxW (pt) verkleinert die Schrift, bis der Text passt. */
  const T = (s, x, y, o = {}) => {
    s = String(s ?? '');
    if (!s) return;
    let size = (o.size || 10.3) * F;
    doc.setFont('helvetica', o.style || 'normal');
    doc.setFontSize(size);
    if (o.maxW) while (size > 4 && doc.getTextWidth(s) > o.maxW) { size -= 0.25; doc.setFontSize(size); }
    doc.setTextColor(...(o.color || INK));
    doc.text(s, X(x), Y(y), { align: o.align || 'left' });
    doc.setTextColor(...INK);
  };

  /* ---------- Farbflächen (vor Linien und Text) ---------- */
  FILL(41, 22.6, 401.3, 46.6, NAVY);            // Titelband (Logo bleibt auf Weiß)
  FILL(41, 69.2, 502.6, 3.2, YEL);              // gelber Akzentstreifen
  FILL(41, 90.1, 502.6, 21, BG);                // Kopfzeile 2
  FILL(41, 132.2, 502.6, 20.4, NAVY);           // Spaltenüberschriften „Schichtenfolge“ / „Bohr-/Pfahldaten“
  FILL(41, 152.6, 226.6, 48.9, BG);             // Kopf der Schichtentabelle
  FILL(267.6, 152.6, 276, 17.4, BG);            // SOLL / IST
  for (const [a, b] of [[332.1, 348.4], [419.1, 435.4], [500.7, 517]]) FILL(267.6, a, 276, b - a, NAVY);   // Abschnittsbänder rechts
  FILL(267.6, 517, 276, 32.6, BG);              // Kopf der Zeitentabelle
  FILL(41, 647.6, 226.6, 30.6, BG);             // Summen harte Schichten / Hindernisse
  FILL(41, 733.5, 502.6, 40.7, BG);             // Unterschriftenzeile

  /* ---------- Rahmen ---------- */
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.5);
  doc.rect(X(41), Y(22.6), 502.6, 753.4);

  /* ---------- Titel ---------- */
  T('BOHRPROTOKOLL Nr.:', 43, 40.4, { size: 18.8, style: 'bold', color: [255, 255, 255] });
  T(p.nr, 363.5, 40.4, { size: 18.8, style: 'bold', align: 'center', maxW: 96, color: YEL });
  doc.setDrawColor(...YEL); doc.setLineWidth(1.4); doc.line(X(313.7), Y(46), X(413.2), Y(46)); doc.setDrawColor(...NAVY);
  T('P[Blocknr.]-[Pfahlnr.]', 363.5, 53.5, { size: 6.6, align: 'center', color: [190, 205, 228] });
  const titel = proj.titel || 'Ortbetonbohrpfähle';
  T(titel, 43, 63.6, { size: 18.8, style: 'bold', color: [255, 255, 255] });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18.8 * F);
  T(proj.norm, 43 + doc.getTextWidth(titel) + 2.5, 63.6, { size: 9.3, color: [190, 205, 228] });
  L(442.3, 24, 442.3, 68.3);
  // eigenes Projektlogo, sonst das Keller-Logo
  const lg = (proj.logo && proj.logoW && proj.logoH) ? { data: proj.logo, w: proj.logoW, h: proj.logoH } : (typeof KELLER_LOGO !== 'undefined' ? KELLER_LOGO : null);
  if (lg) {
    const k = Math.min(92 / lg.w, 38 / lg.h);
    const w = lg.w * k, h = lg.h * k;
    doc.addImage(lg.data, 'PNG', X(444 + (99 - w) / 2), Y(26 + (42 - h) / 2), w, h);
  }
  L(41, 69.2, 543.6, 69.2, 1.6);

  /* ---------- Kopfzeilen ---------- */
  T('Baustelle Nr.:', 42, 83, { size: 11.3 });  T(proj.nr, 119.2, 83, { size: 11.3, style: 'bold', maxW: 84 });
  T('Baustelle:', 209.4, 83, { size: 11.3 });   T(proj.name, 268.6, 83, { size: 11.3, style: 'bold', maxW: 272 });
  L(41, 90.1, 543.6, 90.1, 1);
  T('Pfahl Nr.:', 42, 104, { size: 11.3 });     T(p.nr, 119.2, 104, { size: 11.3, style: 'bold', maxW: 84 });
  T('Ort:', 209.4, 104, { size: 11.3 });        T(proj.ort, 268.6, 104, { size: 11.3, style: 'bold', maxW: 272 });
  L(41, 111.1, 543.6, 111.1, 1);
  T('Pfahlart:', 42, 125, { size: 11.3 });      T(p.pfahlart, 91.2, 125, { size: 11.3, maxW: 110 });
  T('Neigung:', 209.9, 125, { size: 11.3 });    T(fmtFlex(p.neigung), 300, 125, { size: 10.3, align: 'center', maxW: 60 });
  T('°', 339, 125.2, { size: 10.3 });
  T('Pfahl-Ø :', 386.2, 125, { size: 11.3 });   T(fmtFlex(p.durchmesser), 485.4, 124.7, { size: 10.3, align: 'center', maxW: 60 });
  T('m', 515.7, 125.2, { size: 10.3 });
  L(41, 132.2, 543.6, 132.2, 1.6);
  L(41, 139.6, 543.6, 139.6, 1.6);

  /* ---------- Spaltenköpfe ---------- */
  T('Schichtenfolge', 152.9, 149, { style: 'bold', align: 'center', color: [255, 255, 255] });
  T('Bohr-/Pfahldaten', 404.1, 149, { style: 'bold', align: 'center', color: [255, 255, 255] });
  L(41, 152.6, 543.6, 152.6, 1);
  L(267.6, 139.6, 267.6, 678.2, 0.9);

  /* ---------- Links: Schichtenfolge ---------- */
  L(41, 185.2, 267.6, 185.2, 1);
  L(89.8, 152.6, 89.8, 647.6);
  L(122.3, 152.6, 122.3, 647.6);
  T('[m] unter', 64.8, 159.4, { size: 9.3, align: 'center' });
  T('Bohr-', 64.8, 171.6, { size: 9.3, align: 'center' });
  T('ebene', 64.8, 183.8, { size: 9.3, align: 'center' });
  T('GW', 106, 171.8, { align: 'center' });
  T('Bodenart und -beschaffenheit', 194.9, 171.8, { align: 'center', maxW: 140 });

  T('± 0,00', 87.3, 196.3, { align: 'right' });
  T('Bohrebene', 123.5, 196.3);
  doc.setLineWidth(0.7);
  doc.triangle(X(45.5), Y(189.5), X(55.5), Y(189.5), X(50.5), Y(197.5), 'S');
  doc.setLineDashPattern([8.2, 2.6], 0);
  L(43, 201.5, 265.8, 201.5, 0.9);
  doc.setLineDashPattern([], 0);

  const top = 201.5, bot = 647.6, LINE = 16.3, LBL_X = 178;
  const layers = layerSpans(p);
  const spans = [];
  let ygw = null;                   // y-Position des Wasserspiegels
  if (layers.length) {
    const D = layers[layers.length - 1].bis;
    const lines = layers.map(l => {
      if (l.art === 'hindernis' || l.art === 'hart') return [l.art === 'hart' ? 'harte Bodenschicht' : 'Bohrhindernis', l.boden].filter(Boolean);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.3 * F);
      // Im Protokoll mit Kürzeln statt vollem Namen, z. B. "Gr, Sa" statt "Kies, Sand"
      const kuerzel = soilsIn(l.boden).map(s => s.sym).join(', ');
      return l.boden ? doc.splitTextToSize(kuerzel || l.boden, 96).slice(0, 2) : [];
    });
    const mins = lines.map(ls => Math.max(LINE, ls.length * LINE - 2));
    const hs = allocateHeights(layers.map(l => (l.bis - l.von) / D * (bot - top)), bot - top, mins);
    let y = top;
    // Beschriftung mit heller Unterlage, damit sie auf der Schraffur lesbar bleibt (nur zentrierter Text)
    const TB = (s, x, yy, o) => {
      if (!s) return;
      let size = (o.size || 10.3) * F;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
      if (o.maxW) while (size > 4 && doc.getTextWidth(s) > o.maxW) { size -= 0.25; doc.setFontSize(size); }
      const w = doc.getTextWidth(s);
      doc.setGState(new doc.GState({ opacity: 0.85 }));
      doc.setFillColor(255, 255, 255);
      doc.rect(X(x) - w / 2 - 2, Y(yy) - size * 0.82, w + 4, size * 1.12, 'F');
      doc.setGState(new doc.GState({ opacity: 1 }));
      T(s, x, yy, { ...o, align: 'center' });
    };
    layers.forEach((l, i) => {
      const yt = y, yb = y + hs[i];
      spans.push([yt, yb]);
      y = yb;
      // Farbe und Zeichen der Bodenart (wie in der Grafik) in der Spalte „Bodenart“
      const soil = l.art === 'boden' ? soilOf(l.boden) : null;
      const alleSoils = l.art === 'boden' ? soilsIn(l.boden) : [];
      let rgb = null, pat = null, ink;
      if (l.art === 'hindernis') { rgb = [169, 116, 74]; pat = 'hatch'; ink = [91, 58, 31]; }
      else if (l.art === 'hart') { rgb = [154, 161, 171]; pat = 'hatchR'; ink = [75, 82, 92]; }
      else if (alleSoils.length > 1) {
        // Mehrere Bodenarten in einer Schicht: gleich breite Spalten nebeneinander (wie in der Grafik),
        // statt nur die erste (Hauptanteil) farblich darzustellen.
        const colW = 142.5 / alleSoils.length;
        alleSoils.forEach((sl, si) => {
          const cx = 122.8 + si * colW;
          doc.setFillColor(...hexRgb(sl.color));
          doc.rect(X(cx), Y(yt), colW, yb - yt, 'F');
          if (sl.pat !== 'coal' && yb - yt > 12) drawSoilMarks(doc, sl.pat, X(cx) + 1, Y(yt) + 1, colW - 2, yb - yt - 2, [43, 43, 43]);
        });
        doc.setLineWidth(0.3); doc.setLineDashPattern([1, 1], 0);
        for (let si = 1; si < alleSoils.length; si++) {
          const cx = X(122.8 + si * colW);
          doc.setDrawColor(122, 106, 69); doc.line(cx, Y(yt), cx, Y(yb));
        }
        doc.setLineDashPattern([], 0);
        doc.setDrawColor(0); doc.setFillColor(0); doc.setTextColor(0);
      }
      else if (soil) { rgb = hexRgb(soil.color); pat = soil.pat; ink = soil.pat === 'coal' ? null : [43, 43, 43]; }
      else if (l.boden) rgb = [231, 227, 218];
      if (rgb) {
        doc.setFillColor(...rgb);
        doc.rect(X(122.8), Y(yt), 142.5, yb - yt, 'F');
        if (pat && ink && yb - yt > 12) drawSoilMarks(doc, pat, X(122.8) + 1, Y(yt) + 1, 140.5, yb - yt - 2, ink);
        doc.setDrawColor(0); doc.setFillColor(0); doc.setTextColor(0);
      }
      if (i < layers.length - 1) { L(41, yb, 89.8, yb); L(122.3, yb, 265.8, yb); }
      T(fmtPlain(l.bis, 2), 65.4, yb - 5.1, { align: 'center' });
      const ls = lines[i];
      const dark = soil && soil.pat === 'coal';
      if (ls.length >= 2) {
        TB(ls[0], LBL_X, yb - 5.1 - LINE, { size: 10.3, maxW: 96 });
        TB(ls[1], LBL_X, yb - 5.1, { size: 10.3, maxW: 96 });
      } else if (ls.length === 1) {
        TB(ls[0], LBL_X, (yt + yb) / 2 + 3.5, { size: 9.3, maxW: 96 });
      }
      if (dark) doc.setTextColor(0);
    });
    // Grundwasser: Höhe für die grafische Darstellung (unten)
    if (isNum(p.gwTiefe)) {
      const i = layers.findIndex(l => p.gwTiefe <= l.bis);
      if (i >= 0) {
        const l = layers[i];
        ygw = spans[i][0] + (p.gwTiefe - l.von) / (l.bis - l.von) * (spans[i][1] - spans[i][0]);
      }
    }
  }
  /* ---------- Grundwasser grafisch: blaue Spalte unter dem Wasserspiegel, Wasserspiegel-Symbol, Linie über die Schichten ---------- */
  const WB = [30, 110, 190];
  if (ygw != null) {
    doc.setFillColor(196, 222, 246); doc.rect(X(90.3), Y(ygw), 31.5, bot - ygw, 'F');
    doc.setDrawColor(...WB); doc.setLineWidth(1.1);
    for (let k = 0; k < 8; k++) { const x = 90.3 + k * 4; doc.line(X(x), Y(ygw + (k % 2 ? 1.6 : -1.6)), X(x + 4), Y(ygw + (k % 2 ? -1.6 : 1.6))); }
    doc.setFillColor(...WB);
    doc.triangle(X(100.5), Y(ygw - 12), X(111.5), Y(ygw - 12), X(106), Y(ygw - 3.5), 'F');
    doc.setLineWidth(0.8);
    doc.line(X(101), Y(ygw + 4.5), X(111), Y(ygw + 4.5)); doc.line(X(103), Y(ygw + 7.5), X(109), Y(ygw + 7.5));
    doc.setLineDashPattern([5, 2.5], 0); doc.setLineWidth(1);
    doc.line(X(122.3), Y(ygw), X(265.8), Y(ygw));
    doc.setLineDashPattern([], 0); doc.setDrawColor(0); doc.setFillColor(0);
    T(fmtPlain(p.gwTiefe, 2), 106, ygw - 15, { size: 9.3, align: 'center' });
  }

  /* ---------- Bohrpfahl im Schnitt (Ist, sonst Soll) rechts in der Spalte „Bodenart“ ---------- */
  {
    const bl = isNum(p.bohrlaenge) ? p.bohrlaenge : p.sBohrlaenge;
    const lb = Math.max(0, isNum(p.leerbohrung) ? p.leerbohrung : (isNum(p.sLeerbohrung) ? p.sLeerbohrung : 0));
    if (isNum(bl) && bl > 0) {
      const D = layers.length ? layers.at(-1).bis : bl;
      const dy = d => {
        d = Math.min(Math.max(d, 0), D);
        if (!layers.length) return top + d / D * (bot - top);
        let i = layers.findIndex(l => d <= l.bis); if (i < 0) i = layers.length - 1;
        const l = layers[i];
        return spans[i][0] + (d - l.von) / (l.bis - l.von) * (spans[i][1] - spans[i][0]);
      };
      const px = 233.5, pw = 30;
      const y0 = dy(0), yl = dy(Math.min(lb, bl)), y1 = dy(bl);
      // Bohrloch: leer (weiß), unter dem Wasserspiegel wassergefüllt (hellblau)
      doc.setFillColor(255, 255, 255); doc.rect(X(px), Y(y0), pw, y1 - y0, 'F');
      if (ygw != null && ygw < y1) { const yw = Math.max(ygw, y0); doc.setFillColor(196, 222, 246); doc.rect(X(px), Y(yw), pw, y1 - yw, 'F'); }
      // Pfahlbeton: hellgrau mit Zuschlagpunkten
      doc.setFillColor(225, 225, 225); doc.rect(X(px), Y(yl), pw, y1 - yl, 'F');
      doc.setFillColor(140, 140, 140);
      for (let y = yl + 3, r = 0; y < y1 - 1.5; y += 5, r++) for (let x = px + 2 + (r % 2) * 2.5; x < px + pw - 1.5; x += 5) doc.circle(X(x), Y(y), 0.45, 'F');
      if (p.pfahlart !== 'unbewehrt' && y1 - yl > 14) {                                     // Bewehrungskorb: Längsstäbe + Wendel
        doc.setDrawColor(40); doc.setLineWidth(0.6);
        for (let y = yl + 4; y + 7 < y1 - 3; y += 7) { doc.line(X(px + 4.5), Y(y), X(px + pw - 4.5), Y(y + 3.5)); doc.line(X(px + pw - 4.5), Y(y + 3.5), X(px + 4.5), Y(y + 7)); }
        doc.setLineWidth(1.6);
        doc.line(X(px + 4.5), Y(yl + 3), X(px + 4.5), Y(y1 - 3)); doc.line(X(px + pw - 4.5), Y(yl + 3), X(px + pw - 4.5), Y(y1 - 3));
      }
      doc.setDrawColor(20); doc.setLineWidth(1.2); doc.rect(X(px), Y(y0), pw, y1 - y0, 'S');
      if (lb > 0 && yl > y0 + 1) { doc.setLineWidth(0.9); doc.setLineDashPattern([2.5, 2], 0); doc.line(X(px), Y(yl), X(px + pw), Y(yl)); doc.setLineDashPattern([], 0); }
      if (ygw != null && ygw > y0 && ygw < y1) { doc.setDrawColor(...WB); doc.setLineWidth(1.4); doc.line(X(px), Y(ygw), X(px + pw), Y(ygw)); }
      doc.setDrawColor(0);
      T('Pfahl', px + pw / 2, 196.3, { size: 8.5, style: 'bold', align: 'center' });
    }
  }
  L(41, bot, 267.6, bot, 1);

  // Summen (Σ aus der Symbol-Schrift)
  const hart = hartSumme(p), hm = hindernisMin(p);
  const sigma = y => { doc.setFont('symbol', 'normal'); doc.setFontSize(10.3 * F); doc.text('S', X(41.9), Y(y)); };
  sigma(658.7); T('Durchörtern harte Bodenschichten', 50, 658.7, { maxW: 176 });
  T(hart == null ? '' : fmtPlain(hart, 2), 246.6, 658.7, { align: 'right' }); T('m', 254, 659.2);
  sigma(674);   T('Durchörtern Bohrhindernisse', 50, 674, { maxW: 176 });
  T(hm == null ? '' : fmtDurPad(hm), 249.4, 674, { align: 'right' }); T('h', 254, 674.5);

  /* ---------- Rechts: Bohr-/Pfahldaten (Soll / Ist) ---------- */
  T('SOLL', 413.5, 163.7, { align: 'center' });
  T('IST', 471, 163.7, { align: 'center' });
  const daten = [
    ['Arbeitsebene:', p.sArbeitsebene, p.arbeitsebene, hb],
    ['Pfahl-OK:',     p.sOberkante,    p.oberkante,    hb],
    ['Pfahl-UK:',     p.sUnterkante,   p.unterkante,   hb],
    ['Bohrlänge:',    p.sBohrlaenge,   p.bohrlaenge,   'm'],
    ['Pfahllänge:',   p.sPfahllaenge,  p.pfahllaenge,  'm'],
    ['Leerbohrung:',  p.sLeerbohrung,  p.leerbohrung,  'm'],
  ];
  const HAIR = 0.75;
  daten.forEach(([lab, s, i, unit], k) => {
    const y = 180.4 + k * 16.3;
    T(lab, 268.4, y);
    T(fmtPlain(s, 3), 413.4, y, { align: 'center', maxW: 52 });
    T(fmtPlain(i, 3), 471, y, { align: 'center', maxW: 52, style: 'bold' });
    T(unit, 501.2, y, { maxW: 40 });
    L(384.2, y + 4.7, 499.6, y + 4.7, 0.5, HAIR);
  });
  const single = (lab, val, y, unit) => {
    T(lab, 268.4, y);
    T(val, 442, y, { align: 'center', maxW: 90 });
    T(unit, 501.2, y, { maxW: 42 });
    L(384.2, y + 4.7, 499.6, y + 4.7, 0.5, HAIR);
  };
  const dual = (lab, s, i, y, unit, dec) => {
    T(lab, 268.4, y);
    T(fmtPlain(s, dec), 413.4, y, { align: 'center', maxW: 52 });
    T(fmtPlain(i, dec), 471, y, { align: 'center', maxW: 52, style: 'bold' });
    T(unit, 501.2, y, { maxW: 40 });
    L(384.2, y + 4.7, 499.6, y + 4.7, 0.5, HAIR);
  };
  single('Wasserauflast:', p.wasserauflast ? 'Ja' : 'Nein', 278.2, '');
  single('Bohren im GW', fmtPlain(p.grundwasser, 3), 294.4, 'm');
  dual('Abstichmaß Überbeton:', abstichSoll(p), p.abstich, 310.6, 'cm', 1);
  L(267.6, 315.8, 543.6, 315.8, 1.6);
  const ger = geraetText(p.geraet, p.geraetInfo);
  if (ger) { T('Bohrgerät:', 268.4, 327.6); T(ger, 322, 327.6, { size: 9.5, maxW: 218 }); }

  /* ---------- Pfahlbewehrung ---------- */
  const head = (txt, y) => T(txt, 404.1, y, { style: 'bold', align: 'center', color: [255, 255, 255] });
  const row = (lab, val, y, size = 10.3) => { T(lab, 268.4, y); T(val, 452, y, { size, align: 'center', maxW: 160 }); };
  L(267.6, 332.1, 543.6, 332.1);
  head('Pfahlbewehrung', 343.2);
  L(267.6, 348.4, 543.6, 348.4);
  row('Bew. Typ', protoBewTyp(p.bewTyp), 359.7, 11.3);
  row('lt. Plan Nr.:', p.planNr, 378.4, 7.5);
  row('Masse [kg]:', fmtPlain(p.masse, 2), 397.6);
  L(267.6, 402.8, 543.6, 402.8, 1.6);

  /* ---------- Pfahlbeton ---------- */
  L(267.6, 419.1, 543.6, 419.1);
  head('Pfahlbeton', 430.2);
  L(267.6, 435.4, 543.6, 435.4);
  row('Betongüte:', p.betongute, 447);
  row('Konsistenz:', p.konsistenz, 463.3);
  const s = soll(p);
  T('Verbrauch SOLL:', 268.4, 479.4);
  T(s == null ? '' : `${fmtFlex(s)} m³`, 362.5, 479.4, { maxW: 60 });
  T('Verbrauch IST:', 429.2, 479.4);
  T(isNum(p.verbrauchIst) ? `${fmtFlex(p.verbrauchIst)} m³` : '', 501.2, 479.4, { maxW: 40 });
  L(267.6, 484.4, 543.6, 484.4, 1.6);

  /* ---------- Ausführungszeiten ----------
     Nicht mehr pro Arbeitsvorgang fest reservierte Zeilen (früher immer 2 für Bohren/
     Bohrhindernis/harte Bodenschicht, unabhängig davon ob genutzt): stattdessen eine
     Zeile je tatsächlich erfasstem Ereignis, über das ganze Feld verteilt. Kategorien
     ohne Eintrag erscheinen gar nicht. */
  L(267.6, 500.7, 543.6, 500.7);
  head('Ausführungszeiten', 511.8);
  L(267.6, 517, 543.6, 517);
  L(427.6, 533.35, 541.8, 533.35, 0.6);
  L(361.2, 517, 361.2, 678.2, 0.8);
  L(427.6, 517, 427.6, 678.2, 0.8);
  L(485.2, 533.35, 485.2, 678.2, 0.8);
  T('Arbeitsvorgang', 313.8, 536.4, { align: 'center', maxW: 88 });
  T('Datum', 394.5, 536.3, { align: 'center' });
  T('Uhrzeit', 485.5, 527.8, { size: 9.3, align: 'center' });
  T('von', 456.6, 544.4, { align: 'center' });
  T('bis', 514.2, 544.4, { align: 'center' });

  const zTop = 549.6, zBottom = 678.2;
  const eintraege = ZEIT_GROUPS.flatMap(g =>
    (p.zeiten?.[g.k] || [])
      .filter(e => e.d || e.von || e.bis)
      .map(e => ({ label: g.label, e }))
  );
  L(267.6, zTop, 541.8, zTop, 1);
  const rowH = eintraege.length ? Math.max(11, (zBottom - zTop) / eintraege.length) : 16.1;
  eintraege.forEach((row, i) => {
    const y1 = zTop + (i + 1) * rowH;
    const mid = y1 - rowH / 2 + 3.5;
    T(row.label, 313.8, mid, { size: row.label.length > 12 ? 9.3 : 10.3, align: 'center', maxW: 88 });
    T(fmtDateShort(row.e.d), 394.5, mid, { align: 'center' });
    T(row.e.von, 456.6, mid, { align: 'center' });
    T(row.e.bis, 514.2, mid, { align: 'center' });
    L(267.6, y1, 541.8, y1, 0.8);
  });
  L(41, 678.2, 543.6, 678.2, 1.8);

  /* ---------- Bemerkung & Unterschriften ---------- */
  T('Bem.:', 43.8, 688);
  if (p.bemerkung) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.3 * F);
    doc.splitTextToSize(p.bemerkung, 494).slice(0, 3).forEach((t, i) => T(t, 43.8, 700.5 + i * 12, { size: 10.3 }));
  }
  L(41, 733.5, 543.6, 733.5, 1.8);
  L(208, 734.4, 208, 774.2);
  L(384.7, 734.4, 384.7, 774.2);
  const sp = span(p);
  T('AN-ZBm', 41.9, 771.5);
  T(sp.s == null ? '' : fmtDateShort(toLocalInput(new Date(sp.s)).slice(0, 10)), 157.8, 771, { align: 'center' });
  T('AG/ÖBA', 296.4, 771, { align: 'center' });
  T('GEO-ZBm', 386, 771);
  L(41, 774.2, 543.6, 774.2, 1);
  // Fußzeile außerhalb des Rahmens
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MID);
  doc.text(`Bohrprotokoll Pfahl ${p.nr} · erstellt am ${fmtDateShort(new Date().toISOString().slice(0, 10))}`, X(41), Y(787.5));
  doc.text('kellergrundbau.at', X(543.6), Y(787.5), { align: 'right' });
  doc.setTextColor(...INK);
}

/** Fotoseiten zu einem Pfahl: Kopf mit Logo, Baustelle usw., darunter die Fotos (2 Spalten, 3 Zeilen je Seite).
    fresh: true, wenn doc gerade erst angelegt wurde (keine vorangehenden Seiten) – dann wird die erste
    Seite nicht über addPage() ergänzt (sonst bliebe Seite 1 leer); siehe exportProtokolle. */
function drawFotoSeiten(doc, p, proj, { fresh = false } = {}) {
  const fotos = (p.fotos || []).filter(f => f && f.data);
  if (!fotos.length) return;
  const PW = doc.internal.pageSize.getWidth();
  const x0 = 46.3, x1 = 548.9, y0 = 44.2, y1 = 797.6;
  const perPage = 6, gap = 12, cw = (x1 - x0 - 24 - gap) / 2, ch = 170, capH = 14;
  const gy0 = 202;
  const lg = (proj.logo && proj.logoW && proj.logoH) ? { data: proj.logo, w: proj.logoW, h: proj.logoH } : (typeof KELLER_LOGO !== 'undefined' ? KELLER_LOGO : null);
  const sp = span(p);
  const datum = sp.s == null ? '' : fmtDateShort(toLocalInput(new Date(sp.s)).slice(0, 10));
  const pages = Math.ceil(fotos.length / perPage);
  for (let pg = 0; pg < pages; pg++) {
    if (!(fresh && pg === 0)) doc.addPage();
    doc.setDrawColor(0, 51, 102); doc.setTextColor(1, 19, 67); doc.setLineDashPattern([], 0);
    doc.setFillColor(0, 51, 102); doc.rect(x0, y0, x1 - x0 - 108, 52, 'F');
    doc.setFillColor(253, 198, 0); doc.rect(x0, y0 + 52, x1 - x0, 3.2, 'F');
    doc.setFillColor(237, 241, 244); [1, 3].forEach(i => doc.rect(x0, y0 + 56 + 17 * i, x1 - x0, 17, 'F'));
    doc.setLineWidth(1.5); doc.rect(x0, y0, x1 - x0, y1 - y0);
    const T = (s, x, y, size = 10, style = 'normal', o = {}) => {
      s = String(s ?? ''); if (!s) return;
      doc.setFont('helvetica', style); doc.setFontSize(size);
      if (o.maxW) while (size > 5 && doc.getTextWidth(s) > o.maxW) { size -= 0.25; doc.setFontSize(size); }
      doc.setTextColor(...(o.color || [1, 19, 67]));
      doc.text(s, x, y, { align: o.align || 'left' });
    };
    T('FOTODOKUMENTATION', x0 + 6, y0 + 26, 17, 'bold', { color: [255, 255, 255] });
    T(`Pfahl Nr. ${p.nr}${pages > 1 ? `   (Seite ${pg + 1} von ${pages})` : ''}`, x0 + 6, y0 + 44, 12, 'normal', { color: [253, 198, 0] });
    doc.setLineWidth(0.8); doc.line(x1 - 108, y0, x1 - 108, y0 + 52);
    if (lg) {
      const k = Math.min(92 / lg.w, 38 / lg.h), w = lg.w * k, h = lg.h * k;
      doc.addImage(lg.data, 'PNG', x1 - 108 + (108 - w) / 2, y0 + (52 - h) / 2, w, h);
    }
    doc.setLineWidth(1.6); doc.line(x0, y0 + 52, x1, y0 + 52);
    const rows = [['Baustelle Nr.:', proj.nr], ['Baustelle:', proj.name], ['Ort:', proj.ort], ['Pfahl Nr.:', p.nr], ['Bohrdatum:', datum]];
    rows.forEach(([lab, val], i) => {
      const y = y0 + 52 + 16 + i * 17;
      T(lab, x0 + 3, y, 10.5); T(val, x0 + 88, y, 10.5, 'bold', { maxW: x1 - x0 - 96 });
      doc.setLineWidth(0.6); doc.line(x0, y + 5, x1, y + 5);
    });
    doc.setLineWidth(1.6); doc.line(x0, y0 + 52 + 16 + 4 * 17 + 5, x1, y0 + 52 + 16 + 4 * 17 + 5);
    fotos.slice(pg * perPage, pg * perPage + perPage).forEach((f, i) => {
      const c = i % 2, r = Math.floor(i / 2);
      const bx = x0 + 12 + c * (cw + gap), by = gy0 + r * (ch + capH + 8);
      doc.setDrawColor(150); doc.setLineWidth(0.5); doc.rect(bx, by, cw, ch);
      const k = Math.min((cw - 4) / f.w, (ch - 4) / f.h), w = f.w * k, h = f.h * k;
      doc.addImage(f.data, 'JPEG', bx + (cw - w) / 2, by + (ch - h) / 2, w, h);
      T(`Foto ${pg * perPage + i + 1}${f.name ? ' – ' + f.name : ''}`, bx, by + ch + 11, 8.5, 'normal', { maxW: cw });
    });
  }
}

/** Kopiert alle Seiten aus bytes (ArrayBuffer/Uint8Array eines PDFs) ans Ende von target (pdf-lib). */
async function appendPdfBytes(target, bytes) {
  const src = await window.PDFLib.PDFDocument.load(bytes);
  const pages = await target.copyPages(src, src.getPageIndices());
  pages.forEach(pg => target.addPage(pg));
}

/** Baut je Pfahl Protokoll (1 Seite) + angehängte PDFs + Fotoseiten zusammen und reiht die Pfähle
    aneinander. jsPDF kann keine fremden PDF-Seiten einbetten, daher wird nur dann über pdf-lib
    zusammengefügt (etwas aufwändiger: jedes Teilstück entsteht als eigenes kleines PDF, das per
    copyPages eingefügt wird), wenn tatsächlich Anhänge vorhanden sind – ohne Anhänge bleibt der
    einfache, rein jsPDF-basierte Weg wie bisher bestehen. */
async function exportProtokolle(list, { fotos = true, pdfs = true } = {}) {
  if (!list.length) return toast('Keine Pfähle für den Export vorhanden.');
  if (!window.jspdf) return toast('PDF-Bibliothek nicht geladen.');
  const name = list.length === 1
    ? fileBase('Bohrprotokoll_' + String(list[0].nr).replace(/[^\wäöüÄÖÜß-]+/g, '_'))
    : fileBase('Bohrprotokolle');

  const anyPdfs = pdfs && list.some(p => (p.pdfs || []).length);
  if (!anyPdfs) {
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    list.forEach((p, i) => {
      if (i) doc.addPage();
      drawProtokoll(doc, p, state.projekt);
      if (fotos) drawFotoSeiten(doc, p, state.projekt);   // eigene Seite(n) mit Fotos, falls vorhanden
    });
    doc.save(name + '.pdf');
  } else {
    if (!window.PDFLib) return toast('PDF-Bibliothek (pdf-lib) für Anhänge nicht geladen.');
    const merged = await window.PDFLib.PDFDocument.create();
    for (const p of list) {
      const protoDoc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
      drawProtokoll(protoDoc, p, state.projekt);
      await appendPdfBytes(merged, protoDoc.output('arraybuffer'));
      for (const f of (pdfs ? (p.pdfs || []) : [])) {
        if (!f?.data) continue;
        try { await appendPdfBytes(merged, dataUrlBytes(f.data)); }
        catch { toast(`Anhang „${f.name || 'PDF'}“ bei Pfahl „${p.nr}“ konnte nicht eingefügt werden (beschädigte Datei?).`); }
      }
      if (fotos && (p.fotos || []).length) {
        const fotoDoc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        drawFotoSeiten(fotoDoc, p, state.projekt, { fresh: true });
        await appendPdfBytes(merged, fotoDoc.output('arraybuffer'));
      }
    }
    download(await merged.save(), name + '.pdf', 'application/pdf');
  }
  toast(list.length === 1 ? `Bohrprotokoll „${list[0].nr}“ erstellt.` : `Bohrprotokolle erstellt: ${plural(list.length)}.`);
}
