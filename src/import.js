'use strict';

/* =====================================================================
   Excel-/CSV-Import
   Ablauf: Datei lesen → Überschriften erkennen und Spalten Feldern zuordnen →
   Vorschau mit Prüfung → Pfähle anlegen (oder vorhandene aktualisieren).
   Nutzt Funktionen und Zustand aus app.js (state, render, persist, AUTO, …).
   ===================================================================== */

const IMP_MAX_ROWS = 5000;
const IMP_MAX_COLS = 100;

/* Zielfelder: [Schlüssel, Bezeichnung, Typ, Nachkommastellen] */
const IMP_GROUPS = [
  { label: 'Pfahl', fields: [
    ['nr', 'Pfahl-Nr.', 'text'], ['pfahlart', 'Pfahlart', 'pfahlart'],
    ['bewTyp', 'Bew. Typ', 'text'], ['durchmesser', 'Pfahl-Ø', 'num', 2],
    ['neigung', 'Neigung', 'num', 1], ['wasserauflast', 'Wasserauflast', 'bool'],
  ] },
  { label: 'Lage (Koordinaten)', fields: [
    ['ost', 'Rechtswert / Ost (Länge)', 'num', 8], ['nord', 'Hochwert / Nord (Breite)', 'num', 8],
  ] },
  { label: 'Höhen und Längen', fields: [
    ['sArbeitsebene', 'Arbeitsebene – SOLL', 'num', 3], ['sOberkante', 'Pfahl-OK – SOLL', 'num', 3], ['sUnterkante', 'Pfahl-UK – SOLL', 'num', 3],
    ['sBohrlaenge', 'Bohrlänge – SOLL', 'num', 3], ['sPfahllaenge', 'Pfahllänge – SOLL', 'num', 3], ['sLeerbohrung', 'Leerbohrung – SOLL', 'num', 3],
    ['arbeitsebene', 'Arbeitsebene – IST', 'num', 3], ['oberkante', 'Pfahl-OK – IST', 'num', 3], ['unterkante', 'Pfahl-UK – IST', 'num', 3],
    ['bohrlaenge', 'Bohrlänge – IST', 'num', 3], ['pfahllaenge', 'Pfahllänge – IST', 'num', 3], ['leerbohrung', 'Leerbohrung – IST', 'num', 3],
    ['gwTiefe', 'Grundwasser ab', 'num', 2], ['grundwasser', 'Bohren im GW', 'num', 3], ['abstich', 'Abstichmaß Überbeton', 'num', 2],
  ] },
  { label: 'Bodenaufschluss', fields: [
    ['schichten', 'Bodenschichten (Tiefe m [Art] Bodenart/Hinweis, je Schicht mit „ | “ getrennt)', 'schichten'],
  ] },
  { label: 'Bewehrung und Beton', fields: [
    ['planNr', 'Bewehrung lt. Plan Nr.', 'text'], ['masse', 'Bewehrung Masse', 'num', 2], ['betongute', 'Betongüte', 'text'],
    ['konsistenz', 'Konsistenz', 'text'], ['verbrauchIst', 'Verbrauch IST', 'num', 2],
  ] },
  { label: 'Ausführungszeiten', fields: [
    ['beginn', 'Beginn (Datum + Uhrzeit, für Bohren)', 'dt'], ['ende', 'Ende (Datum + Uhrzeit, für Bohren)', 'dt'],
    ...ZEIT_GROUPS.flatMap(g => [
      [`${g.k}_d`, `${g.label}: Datum`, 'date'],
      [`${g.k}_von`, `${g.label}: von`, 'time'],
      [`${g.k}_bis`, `${g.label}: bis`, 'time'],
      [`${g.k}_text`, `${g.label}: „Datum von–bis“ als Text`, 'zeittext'],
    ]),
  ] },
  { label: 'Sonstiges', fields: [['bemerkung', 'Bemerkung (extern)', 'text'], ['bemerkungIntern', 'Bemerkung (intern)', 'text']] },
];
const IMP_DEF = Object.fromEntries(IMP_GROUPS.flatMap(g => g.fields.map(([k, label, type, dec]) => [k, { k, label, type, dec }])));

/** Überschrift vereinfachen: Einheiten in [..]/(..) entfernen, Umlaute falten, nur a–z/0–9. */
const impNorm = s => String(s ?? '').toLowerCase()
  .replace(/\[.*?\]|\(.*?\)/g, '')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/ø/g, 'o')
  .replace(/[^a-z0-9]/g, '');

const IMP_ALIASES = (() => {
  const a = {
    nr: ['pfahlnr', 'pfahlnummer', 'pfahl', 'nr', 'nummer', 'pfahlbezeichnung', 'bezeichnung', 'bohrpfahl', 'bohrpfahlnr', 'pfahlno'],
    neigung: ['neigung', 'pfahlneigung', 'anzug'],
    abstich: ['abstichmassueberbeton', 'abstichmass', 'abstich', 'ueberbeton'],
    pfahlart: ['pfahlart'],
    bewTyp: ['bewtyp', 'bewehrungstyp', 'bewehrungtyp'],
    durchmesser: ['pfahlo', 'pfahldurchmesser', 'durchmesser', 'o', 'pfahld', 'd', 'pfahlod'],
    wasserauflast: ['wasserauflast'],
    arbeitsebene: ['arbeitsebene', 'hoehearbeitsebene', 'hoehederarbeitsebene', 'ae', 'arbeitsplanum'],
    oberkante: ['pfahlok', 'ok', 'pfahloberkante', 'oberkante', 'pfahlkopf', 'kopf', 'hoehepfahlok'],
    unterkante: ['pfahluk', 'uk', 'pfahlunterkante', 'unterkante', 'pfahlfuss', 'fuss', 'hoehepfahluk'],
    bohrlaenge: ['bohrlaenge', 'bohrtiefe'],
    pfahllaenge: ['pfahllaenge', 'laenge'],
    leerbohrung: ['leerbohrung', 'leerbohrlaenge'],
    gwTiefe: ['grundwasserab', 'gwab', 'grundwassertiefe', 'gwtiefe', 'grundwasserstand', 'gwstand'],
    grundwasser: ['bohrenimgw', 'bohrenimgrundwasser', 'grundwasser', 'gw', 'imgrundwasser', 'gwbohrung'],
    planNr: ['bewehrungltplannr', 'ltplannr', 'plannr', 'plan', 'bewehrungplannr', 'planbewehrung'],
    masse: ['masse', 'bewehrung', 'bewehrungmasse', 'bewehrungsmasse', 'gewicht', 'bewehrunggewicht'],
    schichten: ['bodenschichten', 'bodenaufschluss', 'schichten', 'schichtenfolge', 'bodenprofil'],
    betongute: ['betonguete', 'betongute', 'beton', 'betonsorte', 'guete'],
    konsistenz: ['konsistenz'],
    verbrauchIst: ['verbrauchist', 'betonverbrauch', 'verbrauch', 'betonverbrauchist'],
    bemerkung: ['bemerkung', 'bem', 'anmerkung', 'kommentar', 'bemerkungen'],
    bemerkungIntern: ['bemerkungintern', 'internebemerkung', 'internebemerkungen', 'internerkommentar', 'internenotiz', 'notizintern'],
    ost: ['rechtswert', 'rw', 'ost', 'ostwert', 'easting', 'east', 'longitude', 'lon', 'lng', 'laengengrad', 'geolaenge', 'koordinateost', 'koordrw'],
    nord: ['hochwert', 'hw', 'nord', 'nordwert', 'northing', 'north', 'latitude', 'lat', 'breitengrad', 'geobreite', 'koordinatenord', 'koordhw'],
    beginn: ['beginn', 'start', 'bohrbeginn', 'startzeit', 'beginnzeit'],
    ende: ['ende', 'bohrende', 'endzeit', 'fertig'],
  };
  for (const g of ZEIT_GROUPS) {
    const L = impNorm(g.label);
    a[`${g.k}_d`] = [`${L}datum`, `datum${L}`];
    a[`${g.k}_von`] = [`${L}von`, `von${L}`, `${L}beginn`];
    a[`${g.k}_bis`] = [`${L}bis`, `bis${L}`, `${L}ende`];
    a[`${g.k}_text`] = [L, `${L}datumvonbis`];
  }
  return a;
})();

const IMP = { sheets: [], grid: [], headerIdx: 0, map: [], units: [], mode: 'skip', result: null, fileName: '', crs: 'EPSG:25832', xyGuess: false };

/* =====================================================================
   Datei lesen
   ===================================================================== */
const impCellText = c => c ? String(c.w !== undefined ? c.w : (c.v !== undefined ? c.v : '')).trim() : '';
const impHasVal = c => !!c && c.v !== undefined && c.v !== '' && String(c.w !== undefined ? c.w : c.v).trim() !== '';

/** Minimaler CSV-Parser (Trennzeichen ; , oder Tab, Anführungszeichen). */
function impParseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => first.split(ch).length - 1;
  const delim = [[';', count(';')], ['\t', count('\t')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', q = false;
  const endCell = () => { row.push(cur); cur = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length && rows.length <= IMP_MAX_ROWS + 50; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) endCell();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) endRow();
  return rows.map(r => r.slice(0, IMP_MAX_COLS).map(s => (s === '' ? undefined : { t: 's', v: s, w: s })));
}

/** Tabellenblatt (SheetJS) → Raster aus Zellobjekten. */
function impGrid(ws) {
  if (!ws || !ws['!ref']) return [];
  const rng = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  const lastR = Math.min(rng.e.r, IMP_MAX_ROWS + 50), lastC = Math.min(rng.e.c, IMP_MAX_COLS - 1);
  for (let r = 0; r <= lastR; r++) {
    const row = [];
    for (let c = 0; c <= lastC; c++) row.push(ws[XLSX.utils.encode_cell({ r, c })]);
    rows.push(row);
  }
  return rows;
}

async function impReadFile(file) {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || ext === 'txt') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('windows-1252').decode(buf); }
    return [{ name: 'CSV', grid: impParseCsv(text) }];
  }
  if (!window.XLSX) throw new Error('Excel-Bibliothek nicht geladen.');
  const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false });
  return wb.SheetNames.map(name => ({ name, ws: wb.Sheets[name] }));
}

/* =====================================================================
   Werte lesen
   ===================================================================== */
function impNum(c) {
  if (!impHasVal(c)) return null;
  if (c.t === 'n') return isFinite(c.v) ? c.v : NaN;
  if (c.t === 'b') return NaN;
  const n = parseNum(impCellText(c));
  return n;
}

function impBool(c, txt) {
  if (c && c.t === 'b') return !!c.v;
  const s = txt.toLowerCase();
  if (/^(ja|j|x|yes|y|true|wahr|mit|1)$/.test(s)) return true;
  if (/^(nein|n|no|false|falsch|ohne|0|-)$/.test(s)) return false;
  return null;
}

const impPad = n => String(n).padStart(2, '0');

/** Liefert { d: 'YYYY-MM-DD'|null, t: 'HH:MM'|null } oder null (leer) oder 'bad'. */
function impDT(c) {
  if (!impHasVal(c)) return null;
  if (c.t === 'n') {
    if (!(c.v >= 0)) return 'bad';
    const total = Math.round(c.v * 1440);
    const day = Math.floor(total / 1440), mins = total % 1440;
    const t = `${impPad(Math.floor(mins / 60))}:${impPad(mins % 60)}`;
    if (day < 1) return { d: null, t };                     // reine Uhrzeit
    const pc = XLSX.SSF.parse_date_code(day);
    if (!pc) return 'bad';
    return { d: `${pc.y}-${impPad(pc.m)}-${impPad(pc.d)}`, t: mins ? t : null };
  }
  const s = impCellText(c);
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return { d: `${y}-${impPad(m[2])}-${impPad(m[1])}`, t: m[4] ? `${impPad(m[4])}:${m[5]}` : null };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { d: `${m[1]}-${m[2]}-${m[3]}`, t: m[4] ? `${impPad(m[4])}:${m[5]}` : null };
  m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?(?:\s*Uhr)?$/.exec(s);
  if (m) return { d: null, t: `${impPad(m[1])}:${m[2]}` };
  return 'bad';
}

/** „02.07.2026 07:00–09:00 | 02.07.2026 …“ → Einträge */
function impZeitText(s) {
  const out = [];
  for (const part of s.split('|')) {
    const m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*(\d{1,2}:\d{2})?\s*[–\-]\s*(\d{1,2}:\d{2})?/.exec(part);
    if (!m) continue;
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const e = { d: `${y}-${impPad(m[2])}-${impPad(m[1])}` };
    if (m[4]) e.von = m[4].padStart(5, '0');
    if (m[5]) e.bis = m[5].padStart(5, '0');
    out.push(e);
  }
  return out;
}

/** „2,00 Kies, Sand | 5,00 Ton | 6,50 [Bohrhindernis] Findling“ → schichten-Einträge (siehe
    schichtenText in app.js, Gegenstück beim CSV-Export). Pro Schicht: Tiefe bis, optional die Art
    in eckigen Klammern (Bohrhindernis/harte Bodenschicht; ohne Klammer = Boden), dahinter die
    Bodenart(en) bzw. der Hinweis. Liefert { list } oder { bad: '<unlesbarer Teil>' }. */
function impSchichten(txt) {
  const out = [];
  for (const part of txt.split('|').map(s => s.trim()).filter(Boolean)) {
    const m = /^([\d.,]+)\s*(?:\[([^\]]+)\]\s*)?(.*)$/.exec(part);
    const bis = m && parseNum(m[1]);
    if (!m || bis === null || Number.isNaN(bis)) return { bad: part };
    const artLabel = impNorm(m[2] || '');
    const art = artLabel.includes('hindernis') ? 'hindernis' : artLabel.includes('hart') ? 'hart' : 'boden';
    out.push({ bis: rd(bis, 2), art, boden: (m[3] || '').trim() });
  }
  return { list: out };
}

/* =====================================================================
   Zuordnung & Auswertung
   ===================================================================== */
const IMP_GEOM = ['arbeitsebene', 'oberkante', 'unterkante', 'bohrlaenge', 'pfahllaenge', 'leerbohrung'];
const impCap = s => s[0].toUpperCase() + s.slice(1);

function impAutoMap(headers) {
  const used = new Set();
  const lookup = n => { for (const [key, aliases] of Object.entries(IMP_ALIASES)) if (aliases.includes(n)) return key; return null; };
  const map = headers.map(h => {
    const n = impNorm(h);
    if (!n) return '';
    // Höhen/Längen gibt es als Soll (Plan) und Ist (ausgeführt). Steht nichts dabei, gilt eine Excel-Liste als Planwerte (Soll).
    let kind = null, base = n;
    const m = /^(.*?)(soll|ist)$/.exec(n);
    if (m && IMP_GEOM.includes(lookup(m[1]) || '')) { base = m[1]; kind = m[2]; }
    let key = lookup(base);
    if (!key) return '';
    if (IMP_GEOM.includes(key) && kind !== 'ist') key = 's' + impCap(key);
    if (used.has(key)) return '';
    used.add(key);
    return key;
  });
  // Überschriften mit Zusatz in Klammern, z. B. „Y (Rechtswert)“
  headers.forEach((h, i) => {
    if (map[i]) return;
    if (!used.has('ost') && /rechtswert|easting|ostwert|l[aä]ngengrad|longitude/i.test(h)) { map[i] = 'ost'; used.add('ost'); }
    else if (!used.has('nord') && /hochwert|northing|nordwert|breitengrad|latitude/i.test(h)) { map[i] = 'nord'; used.add('nord'); }
  });
  // Nur „X“ und „Y“: Achsenbezeichnung richtet sich nach dem Koordinatensystem
  IMP.xyGuess = false;
  if (!used.has('ost') && !used.has('nord')) {
    const nx = h => impNorm(h).replace(/(koordinate|koord)$/, '');   // „Y-Koordinate“ → y
    const xi = headers.findIndex(h => nx(h) === 'x'), yi = headers.findIndex(h => nx(h) === 'y');
    if (xi >= 0 && yi >= 0 && !map[xi] && !map[yi]) {
      const nat = !!crsInfo(IMP.crs).nat;          // Landesvermessung: Y = Rechtswert, X = Hochwert
      map[nat ? yi : xi] = 'ost'; map[nat ? xi : yi] = 'nord';
      IMP.xyGuess = true;
      IMP.xyCols = { x: xi, y: yi };
    }
  }
  return map;
}

function impMergeZeiten(base, z) {
  for (const g of ZEIT_GROUPS) {
    (z[g.k] || []).forEach((e, i) => {
      const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v));
      base[g.k][i] = { ...(base[g.k][i] || {}), ...clean };
    });
  }
  return base;
}

function impReadRow(row, cols) {
  const it = { issues: [], partial: {}, z: {}, dt: {} };
  const zget = (g, i = 0) => { it.z[g] ||= []; it.z[g][i] ||= {}; return it.z[g][i]; };

  for (const c of cols) {
    const cell = row[c.i];
    if (!impHasVal(cell)) continue;
    const txt = impCellText(cell);
    const { key, def } = c;

    if (def.type === 'text') {
      it.partial[key] = key === 'bewTyp' ? protoBewTyp(txt)
        : key === 'betongute' ? txt.replace(/^([CL]\d+)\s*[-–]\s*(\d+)/i, '$1/$2')    // C25-30 → C25/30
        : txt;
    }
    else if (def.type === 'pfahlart') it.partial[key] = /^un/i.test(txt) ? 'unbewehrt' : 'bewehrt';
    else if (def.type === 'schichten') {
      const r = impSchichten(txt);
      if (r.bad) it.issues.push(`${def.label}: „${r.bad}“ nicht lesbar`);
      else it.partial[key] = r.list;
    }
    else if (def.type === 'bool') {
      const b = impBool(cell, txt);
      if (b === null) it.issues.push(`${def.label}: „${txt}“ nicht erkannt (Ja/Nein erwartet)`);
      else it.partial[key] = b;
    } else if (def.type === 'num') {
      let n = impNum(cell);
      if (n === null) continue;
      if (Number.isNaN(n)) { it.issues.push(`${def.label}: „${txt}“ ist keine Zahl`); continue; }
      if (key === 'durchmesser') {
        // Pfahl-Ø wird (ohne Einheiten-Hinweis) in Meter erwartet; „mm“/„cm“ in der Einheitenzeile
        // werden umgerechnet. Ohne Einheiten-Hinweis und unplausibel groß für Meter wird je nach
        // Größenordnung als cm oder mm gewertet (typischer Tippfehler bei Excel-Listen).
        if (/mm/i.test(c.unit)) n /= 1000;
        else if (/cm/i.test(c.unit)) n /= 100;
        else if (c.unit.trim().toLowerCase() !== 'm' && n > 3) {
          if (n > 30) { it.issues.push(`Pfahl-Ø ${txt} als mm gewertet → ${fmtInput(rd(n / 1000, def.dec))} m`); n /= 1000; }
          else { it.issues.push(`Pfahl-Ø ${txt} als cm gewertet → ${fmtInput(rd(n / 100, def.dec))} m`); n /= 100; }
        }
      }
      it.partial[key] = rd(n, def.dec);
    } else if (def.type === 'dt') {
      const v = impDT(cell);
      if (v === 'bad') it.issues.push(`${def.label}: „${txt}“ ist kein Datum`); else it.dt[key] = v;
    } else if (key.includes('_')) {
      const g = key.slice(0, key.lastIndexOf('_')), part = key.slice(key.lastIndexOf('_') + 1);
      if (part === 'text') {
        const es = impZeitText(txt);
        if (!es.length) it.issues.push(`${def.label}: „${txt}“ nicht lesbar`);
        es.forEach((e, i) => Object.assign(zget(g, i), e));
      } else {
        const v = impDT(cell);
        if (v === 'bad') { it.issues.push(`${def.label}: „${txt}“ nicht lesbar`); continue; }
        if (part === 'd' && v.d) zget(g).d = v.d;
        else if (part === 'd' && v.t) it.issues.push(`${def.label}: „${txt}“ ist kein Datum`);
        else if (part !== 'd' && v.t) zget(g)[part] = v.t;
        else if (part !== 'd') it.issues.push(`${def.label}: „${txt}“ ist keine Uhrzeit`);
      }
    }
  }

  // Beginn/Ende → Bohren, falls dort nichts steht
  const b = it.dt.beginn, e = it.dt.ende;
  if (!it.z.bohren?.[0]?.d && b && b.d) {
    const z = zget('bohren');
    z.d = b.d;
    if (b.t) z.von = b.t;
    if (e && e.t) z.bis = e.t;
    if (e && e.d && e.d !== b.d) it.issues.push('Ende liegt an einem anderen Tag als der Beginn – nur die Uhrzeit wurde übernommen');
  }
  return it;
}

function impDerive(base, old) {
  const v = { ...base };
  for (const [k, a] of Object.entries(AUTO)) {
    const given = base._given.has(k);
    if (given) continue;
    if (old) {
      const wasAuto = !isNum(old[k]) || old[k] === a.from(old);
      if (!wasAuto) continue;
    } else if (isNum(v[k])) continue;
    const r = a.from(v);
    if (isNum(r)) v[k] = r; else if (old && isNum(old[k])) v[k] = old[k];
  }
  return v;
}

function impParse() {
  const rows = IMP.grid;
  const cols = IMP.map.map((key, i) => key ? { key, i, def: IMP_DEF[key], unit: IMP.units[i] || '' } : null).filter(Boolean);
  const existing = new Map(state.piles.map(p => [String(p.nr).toLowerCase(), p]));
  const seen = new Set();
  const items = [], issues = [];
  const count = { new: 0, update: 0, skip: 0, error: 0 };
  const first = IMP.headerIdx + 1 + (IMP.unitRow ? 1 : 0);      // Zeile nach Überschrift (und Einheitenzeile)

  const fieldUse = {};
  cols.forEach(c => { (fieldUse[c.key] ||= []).push(c.i); });
  for (const [k, list] of Object.entries(fieldUse)) {
    if (list.length > 1) issues.push({ level: 'w', text: `„${IMP_DEF[k].label}“ ist mehreren Spalten zugeordnet – die letzte gewinnt.` });
  }
  if (!fieldUse.nr) return { items, count, issues: [{ level: 'e', text: 'Bitte eine Spalte der „Pfahl-Nr.“ zuordnen.' }], noNr: true };

  let last = rows.length;
  if (last - IMP_MAX_ROWS - 1 > first) { last = first + IMP_MAX_ROWS; issues.push({ level: 'w', text: `Es werden nur die ersten ${IMP_MAX_ROWS} Zeilen gelesen.` }); }

  for (let r = first; r < last; r++) {
    const row = rows[r];
    if (!row || !row.some(impHasVal)) continue;
    const it = impReadRow(row, cols);
    it.row = r + 1;
    const nr = (it.partial.nr || '').trim();
    const lc = nr.toLowerCase();
    const say = (level, text) => issues.push({ level, text: `Zeile ${it.row}: ${text}` });
    it.issues.forEach(t => say('w', t));

    if (!nr) { it.status = 'error'; say('e', 'Pfahl-Nr. fehlt – Zeile wird nicht importiert.'); }
    else if (seen.has(lc)) { it.status = 'error'; say('e', `Pfahl-Nr. „${nr}“ kommt in der Datei mehrfach vor – Zeile wird nicht importiert.`); }
    else {
      seen.add(lc);
      const old = existing.get(lc);
      if (old && IMP.mode === 'skip') it.status = 'skip';
      else {
        it.status = old ? 'update' : 'new';
        const given = new Set(Object.keys(it.partial));
        let p;
        if (old) {
          p = { ...structuredClone(old), ...it.partial };
          p.zeiten = impMergeZeiten(structuredClone(old.zeiten), it.z);
        } else {
          p = { ...emptyPile(), ...it.partial };
          p.zeiten = impMergeZeiten(emptyZeiten(), it.z);
        }
        if (!isNum(p.neigung)) p.neigung = 0;      // keine Neigung angegeben → 0°
        p._given = given;
        p = impDerive(p, old);
        delete p._given;
        it.pile = p;
        if (isNum(p.oberkante) && isNum(p.unterkante) && p.oberkante <= p.unterkante) say('w', 'Pfahl-OK (Ist) liegt nicht über der Pfahl-UK.');
        if (isNum(p.sOberkante) && isNum(p.sUnterkante) && p.sOberkante <= p.sUnterkante) say('w', 'Pfahl-OK (Soll) liegt nicht über der Pfahl-UK.');
        for (const g of ZEIT_GROUPS) for (const e of p.zeiten[g.k]) {
          if ((e.von || e.bis) && !e.d) say('w', `${g.label}: Uhrzeit ohne Datum.`);
        }
      }
    }
    it.nr = nr;
    count[it.status]++;
    items.push(it);
  }

  // Koordinaten prüfen: gültig im gewählten System? Alle in derselben Gegend?
  const geo = { n: 0, bad: 0, one: 0, first: null, far: 0 };
  if (fieldUse.ost || fieldUse.nord) {
    const pts = [];
    for (const it of items) {
      const p = it.pile;
      if (!p || !(isNum(p.ost) || isNum(p.nord))) continue;
      if (!(isNum(p.ost) && isNum(p.nord))) { geo.one++; continue; }
      const ll = toLatLon(p, IMP.crs);
      if (ll) pts.push({ nr: it.nr, ll }); else geo.bad++;
    }
    geo.n = pts.length;
    if (pts.length) {
      geo.first = pts[0];
      const med = k => { const s = pts.map(x => x.ll[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
      const center = [med(0), med(1)];
      geo.far = pts.filter(x => kmBetween(center, x.ll) > 100).length;
    }
    if (geo.bad) issues.push({ level: 'w', text: `${plural(geo.bad)}: Koordinaten liegen außerhalb des gültigen Bereichs von ${IMP.crs}. Bitte Koordinatensystem prüfen und ob Rechtswert und Hochwert vertauscht sind.` });
    if (geo.far) issues.push({ level: 'w', text: `${plural(geo.far)} liegen mehr als 100 km vom Rest entfernt – bitte Koordinaten und Koordinatensystem prüfen.` });
    if (geo.one) issues.push({ level: 'w', text: `${plural(geo.one)}: nur Rechtswert oder nur Hochwert vorhanden – Koordinaten werden nicht angezeigt.` });
  }
  return { items, count, issues, geo };
}

/* =====================================================================
   Oberfläche
   ===================================================================== */
const impDlg = $('#impDialog');

function impError(msg) { $('#impError').innerHTML = msg ? `<div class="e">${esc(msg)}</div>` : ''; }

function openImport() {
  if (!isAdmin()) return toast('Der Import ist dem Administrator vorbehalten.');
  IMP.sheets = []; IMP.grid = []; IMP.map = []; IMP.result = null; IMP.mode = 'skip';
  IMP.crs = crsInfo(state.projekt.crs).id;
  IMP.crsManual = false;
  $('#impCrs').innerHTML = CRS_LIST.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  $('#impCrs').value = IMP.crs;
  $('#impMode').value = 'skip';
  $('#impStep1').hidden = false;
  $('#impStep2').hidden = true;
  $('#impFileName').textContent = 'oder Datei hierher ziehen';
  $('#btnImpRun').disabled = true;
  $('#btnImpRun').textContent = 'Importieren';
  impError('');
  impDlg.showModal();
}

async function impLoad(file) {
  impError('');
  try {
    const sheets = await impReadFile(file);
    IMP.fileName = file.name;
    IMP.crsManual = false;
    IMP.sheets = sheets.map(s => ({ ...s, grid: s.grid || impGrid(s.ws) }));
    const usable = IMP.sheets.filter(s => s.grid.some(r => r.some(impHasVal)));
    if (!usable.length) throw new Error('Die Datei enthält keine Daten.');
    IMP.sheets = usable;
    $('#impSheet').innerHTML = usable.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
    $('#impFileTitle').textContent = file.name;
    $('#impStep1').hidden = true;
    $('#impStep2').hidden = false;
    impSelectSheet(0);
  } catch (err) {
    impError('Datei konnte nicht gelesen werden: ' + (err && err.message ? err.message : err));
  }
}

function impSelectSheet(i) {
  IMP.grid = IMP.sheets[i].grid;
  let h = IMP.grid.findIndex(r => r.filter(impHasVal).length >= 2);
  if (h < 0) h = IMP.grid.findIndex(r => r.some(impHasVal));
  IMP.headerIdx = Math.max(0, h);
  $('#impHeaderRow').value = String(IMP.headerIdx + 1);
  impBuildMap();
}

/** Zeile mit Einheiten unter den Überschriften, z. B. „[cm] [m] [müA]“ */
function impIsUnitRow(row) {
  const cells = (row || []).filter(impHasVal).map(impCellText);
  if (cells.length < 2) return false;
  const bracketed = cells.filter(t => /^\[.*\]$/.test(t)).length;
  return /^\[/.test(cells[0]) && bracketed / cells.length >= 0.5;
}

/** Sucht ein Koordinatensystem, in dem die Beispielpunkte in der Gegend liegen (zuerst Österreich, dann Mitteleuropa). */
function impDetectCrs(headers) {
  const oi = IMP.map.indexOf('ost'), ni = IMP.map.indexOf('nord');
  if (oi < 0 || ni < 0) return null;
  const pair = c => {                                   // je nach Achsenbezeichnung X/Y
    if (!IMP.xyCols) return [oi, ni];
    return c.nat ? [IMP.xyCols.y, IMP.xyCols.x] : [IMP.xyCols.x, IMP.xyCols.y];
  };
  const first = IMP.headerIdx + 1 + (IMP.unitRow ? 1 : 0);
  const sample = IMP.grid.slice(first, first + 60);
  const AT = [46.3, 49.1, 9.4, 17.3], CE = [45, 56, 5, 18];
  const inBox = (ll, b) => ll[0] >= b[0] && ll[0] <= b[1] && ll[1] >= b[2] && ll[1] <= b[3];
  const hits = [];
  for (const c of CRS_LIST) {
    const [a, b] = pair(c);
    let n = 0, at = 0, ce = 0;
    for (const row of sample) {
      const o = impNum(row[a]), no = impNum(row[b]);
      if (!isNum(o) || !isNum(no)) continue;
      n++;
      const ll = toLatLon({ ost: o, nord: no }, c.id);
      if (ll && inBox(ll, AT)) at++;
      if (ll && inBox(ll, CE)) ce++;
    }
    if (n >= 1) hits.push({ id: c.id, label: c.label, n, at: at / n, ce: ce / n });
  }
  const pick = f => hits.filter(f);
  const inAt = pick(h => h.at >= 0.9), inCe = pick(h => h.ce >= 0.9);
  const list = inAt.length ? inAt : inCe;
  return list.length ? { id: list[0].id, others: list.slice(1).map(h => h.id), austria: !!inAt.length } : null;
}

function impBuildMap() {
  const hdr = IMP.grid[IMP.headerIdx] || [];
  IMP.unitRow = impIsUnitRow(IMP.grid[IMP.headerIdx + 1]);
  const unitCells = IMP.unitRow ? IMP.grid[IMP.headerIdx + 1] : [];
  const body = IMP.grid.slice(IMP.headerIdx + 1 + (IMP.unitRow ? 1 : 0));
  const ncols = Math.max(hdr.length, ...body.slice(0, 200).map(r => r.length), 0);
  const headers = [];
  IMP.units = [];
  for (let i = 0; i < ncols; i++) {
    const h = impCellText(hdr[i]);
    headers.push(h);
    const m = /\[(.*?)\]|\((.*?)\)/.exec(h);
    const u = impCellText(unitCells[i]).replace(/^\[|\]$/g, '');
    IMP.units.push(m ? (m[1] ?? m[2] ?? '') : u);
  }
  $('#impUnitHint').textContent = IMP.unitRow ? `Zeile ${IMP.headerIdx + 2} enthält Einheiten und wird nicht als Pfahl gelesen.` : '';
  IMP.xyCols = null;
  IMP.map = impAutoMap(headers);
  IMP.crsNote = '';
  if (!IMP.crsManual) {
    const det = impDetectCrs(headers);
    if (det) {
      IMP.crs = det.id;
      $('#impCrs').value = det.id;
      if (IMP.xyGuess) { IMP.xyCols = null; IMP.map = impAutoMap(headers); }
      IMP.crsNote = `Koordinatensystem automatisch erkannt: ${crsInfo(det.id).label}.` +
        (det.others.length ? ` Ebenfalls möglich: ${det.others.map(o => o.replace('EPSG:', '')).join(', ')} – bitte anhand der Kontrolle prüfen.` : '');
    }
  }

  const opts = '<option value="">– ignorieren –</option>' + IMP_GROUPS.map(g =>
    `<optgroup label="${esc(g.label)}">${g.fields.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}</optgroup>`).join('');

  const html = [];
  for (let i = 0; i < ncols; i++) {
    const sample = body.slice(0, 200).map(r => impCellText(r[i])).find(Boolean) || '';
    if (!headers[i] && !sample) continue;
    html.push(`<div class="map-row">
      <div class="map-src"><span class="col-id">${XLSX.utils.encode_col(i)}</span><strong>${esc(headers[i] || '(ohne Überschrift)')}</strong>
        <small>${sample ? 'z. B. ' + esc(sample.slice(0, 40)) : 'leer'}</small></div>
      <select data-col="${i}" aria-label="Zielfeld für Spalte ${XLSX.utils.encode_col(i)}">${opts}</select></div>`);
  }
  $('#impMap').innerHTML = html.join('');
  $$('#impMap select').forEach(s => { s.value = IMP.map[+s.dataset.col] || ''; });
  impUpdate();
}

function impUpdate() {
  IMP.mode = $('#impMode').value;
  if (!IMP.grid.length) return;
  const res = IMP.result = impParse();
  const c = res.count;
  const chip = (n, txt, cls) => n ? `<span class="chip ${cls}">${nf0.format(n)} ${txt}</span>` : '';
  $('#impSummary').innerHTML = res.noNr ? '' :
    chip(c.new, 'neu', 'yes') + chip(c.update, 'aktualisieren', 'yes') + chip(c.skip, 'übersprungen', '') + chip(c.error, 'mit Fehler', 'bad') ||
    '<span class="sub">Keine Datenzeilen gefunden.</span>';

  const shown = res.items.slice(0, 200);
  const label = { new: 'Neu', update: 'Aktualisieren', skip: 'Übersprungen', error: 'Fehler' };
  const cell = (p, k, f) => p && isNum(p[k]) ? esc(f.format(p[k])) : '<span class="empty">–</span>';
  const cl = coordLabels(IMP.crs);
  $('#impPrev').innerHTML = shown.length ? `<table><thead><tr>
      <th>Pfahl-Nr.</th><th>Status</th><th>Zeile</th><th class="num">Pfahl-Ø [m]</th><th class="num">Arbeitsebene (Soll)</th>
      <th class="num">Pfahl-OK (Soll)</th><th class="num">Pfahl-UK (Soll)</th><th class="num">Pfahllänge (Soll) [m]</th>
      <th class="num">${esc(cl.ost.split(' ')[0])}</th><th class="num">${esc(cl.nord.split(' ')[0])}</th></tr></thead><tbody>` +
    shown.map(it => `<tr><td>${esc(it.nr || '–')}</td><td><span class="chip ${it.status === 'new' || it.status === 'update' ? 'yes' : it.status === 'error' ? 'bad' : ''}">${label[it.status]}</span></td>
      <td>${it.row}</td><td class="num">${cell(it.pile, 'durchmesser', nf2)}</td><td class="num">${cell(it.pile, 'sArbeitsebene', nf3)}</td>
      <td class="num">${cell(it.pile, 'sOberkante', nf3)}</td><td class="num">${cell(it.pile, 'sUnterkante', nf3)}</td><td class="num">${cell(it.pile, 'sPfahllaenge', nf3)}</td>
      <td class="num">${cell(it.pile, 'ost', new Intl.NumberFormat('de-DE', { minimumFractionDigits: cl.dec, maximumFractionDigits: cl.dec }))}</td>
      <td class="num">${cell(it.pile, 'nord', new Intl.NumberFormat('de-DE', { minimumFractionDigits: cl.dec, maximumFractionDigits: cl.dec }))}</td></tr>`).join('') +
    '</tbody></table>' + (res.items.length > shown.length ? `<p class="sub" style="padding:8px 12px;margin:0">… und ${res.items.length - shown.length} weitere Zeilen</p>` : '') : '';

  const list = res.issues.slice(0, 40);
  $('#impIssues').innerHTML = list.map(i => `<div class="${i.level}">${esc(i.text)}</div>`).join('') +
    (res.issues.length > list.length ? `<div class="w">… und ${res.issues.length - list.length} weitere Hinweise</div>` : '');

  // Koordinatensystem-Auswahl nur zeigen, wenn Koordinatenspalten zugeordnet sind
  const hasCoords = IMP.map.includes('ost') || IMP.map.includes('nord');
  $('#impCrsBox').hidden = !hasCoords;
  const g = res.geo;
  $('#impCrsHint').textContent = !hasCoords ? '' : [
    IMP.crsNote,
    IMP.xyGuess ? 'Die Spalten „X“/„Y“ wurden nach Vermessungsüblichkeit für dieses System zugeordnet (Y = Rechtswert, X = Hochwert bei Landesvermessung) – bitte prüfen.' : '',
    g && g.first ? `Kontrolle: „${g.first.nr}“ liegt bei ${fmtLatLon(g.first.ll)}.` : '',
    hasCoords && state.piles.some(p => isNum(p.ost)) && IMP.crs !== state.projekt.crs ? `Achtung: Das Projekt nutzt bisher ${state.projekt.crs}; bereits erfasste Koordinaten werden dann ebenfalls in ${IMP.crs} gelesen.` : '',
  ].filter(Boolean).join(' ');

  const n = c.new + c.update;
  const btn = $('#btnImpRun');
  btn.disabled = !n;
  btn.textContent = n ? `${plural(n)} importieren` : 'Importieren';
}

$('#btnImpFile').addEventListener('click', () => $('#impFile').click());
$('#btnImpOther').addEventListener('click', () => { $('#impStep1').hidden = false; $('#impStep2').hidden = true; $('#btnImpRun').disabled = true; });
$('#impFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) impLoad(f); });
$('#impSheet').addEventListener('change', e => impSelectSheet(+e.target.value));
$('#impHeaderRow').addEventListener('change', e => {
  const n = parseInt(e.target.value, 10);
  IMP.headerIdx = Number.isFinite(n) && n >= 1 && n <= IMP.grid.length ? n - 1 : IMP.headerIdx;
  e.target.value = String(IMP.headerIdx + 1);
  impBuildMap();
});
$('#impMap').addEventListener('change', e => {
  const s = e.target.closest('select[data-col]');
  if (!s) return;
  IMP.map[+s.dataset.col] = s.value;
  impUpdate();
});
$('#impMode').addEventListener('change', impUpdate);
$('#impCrs').addEventListener('change', e => {
  IMP.crs = e.target.value;
  IMP.crsManual = true;
  IMP.crsNote = '';
  if (IMP.xyGuess) impBuildMap(); else impUpdate();
});

const impDrop = $('#impDrop');
['dragenter', 'dragover'].forEach(ev => impDrop.addEventListener(ev, e => { e.preventDefault(); impDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => impDrop.addEventListener(ev, e => { e.preventDefault(); impDrop.classList.remove('over'); }));
impDrop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) impLoad(f); });

$('#impForm').addEventListener('submit', async e => {
  e.preventDefault();
  const res = IMP.result;
  if (!res) return;
  const todo = res.items.filter(i => i.status === 'new' || i.status === 'update');
  if (!todo.length) return;
  const t = Date.now();
  let added = 0, updated = 0;
  if (IMP.map.includes('ost') && IMP.map.includes('nord')) state.projekt.crs = IMP.crs;
  todo.forEach((it, k) => {
    const stamp = { updatedAt: Date.now(), updatedBy: me.name, updatedRole: 'admin' };
    if (it.status === 'new') { state.piles.push({ id: uid(), createdAt: t + k, quelle: 'import', ...it.pile, ...stamp }); added++; }
    else {
      const i = state.piles.findIndex(p => p.id === it.pile.id);
      if (i >= 0) { state.piles[i] = { ...it.pile, ...stamp }; updated++; }
    }
  });
  impDlg.close();
  const withPos = todo.some(it => toLatLon(it.pile));
  if (withPos) ui.view = 'map';                 // importierte Pfähle gleich auf der Karte zeigen
  render();
  await persist();
  toast([added && `${plural(added)} importiert`, updated && `${plural(updated)} aktualisiert`].filter(Boolean).join(', ') + (withPos ? ' – sie erscheinen auf der Karte als „noch offen“.' : '.'));
});

/* Excel-Vorlage */
$('#btnImpTemplate').addEventListener('click', () => {
  if (!window.XLSX) return toast('Excel-Bibliothek nicht geladen.');
  // Aufbau wie die Pfahlaufteilung: Überschriftenzeile, Einheitenzeile, dann ein Pfahl je Zeile (Planwerte = Soll)
  const cols = [
    ['Pfahl-Nr.', '[-]'], ['Pfahl Ø', '[m]'], ['Pfahllänge', '[m]'], ['Y-Koordinate', '[m]'], ['X-Koordinate', '[m]'],
    ['Pfahl UK', '[müA]'], ['Pfahl OK', '[müA]'], ['Arbeitsebene', '[müA]'], ['Pfahlart', 'Typ'], ['Neigung', '°'],
    ['Bew Typ', ''], ['lt. Plan Nr.:', ''], ['Bewehrung', 'kg'], ['Betongüte', ''], ['Konsistenz', ''],
  ];
  const ex1 = ['P07-01', 0.88, 18, 19164.8713, 225305.6425, 747.0499, 765.0499, 765.9669, 'bewehrt', 0, 'Block00', 'S16_02500_ZL6_301904955_KMP-G45000_SB_B', 1500, 'C25-30', 'F54'];
  const ex2 = ['P07-02', 0.88, 18, 19162.5986, 225303.4972, 747.0262, 765.0262, 765.9432, 'bewehrt', 0, 'Block00', 'S16_02500_ZL6_301904955_KMP-G45000_SB_B', 2000, 'C25-30', 'F55'];
  const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c[0]), cols.map(c => c[1]), ex1, ex2]);
  ws['!cols'] = cols.map(c => ({ wch: Math.max(12, c[0].length + 3) }));
  const hints = XLSX.utils.aoa_to_sheet([
    ['Hinweise zum Import'],
    ['Jede Zeile ist ein Pfahl. Pflichtspalte ist „Pfahl-Nr.“; alle anderen Spalten dürfen fehlen. Eine Einheitenzeile unter den Überschriften (z. B. „[cm]“) wird erkannt und nicht als Pfahl gelesen.'],
    ['Höhen und Längen ohne Zusatz gelten als Planwerte (SOLL). Ist-Werte kennzeichnen Sie mit „Ist“ in der Überschrift (z. B. „Pfahl OK Ist“).'],
    ['Bohrlänge, Pfahllänge und Leerbohrung dürfen leer bleiben – sie werden aus Arbeitsebene, OK und UK berechnet.'],
    ['Der Pfahldurchmesser wird in m erwartet. Steht „cm“ oder „mm“ in der Überschrift oder Einheitenzeile, wird umgerechnet.'],
    ['Koordinaten: Rechtswert (Ost) und Hochwert (Nord) bzw. Y und X im selben System für alle Pfähle. Das Koordinatensystem wird beim Import erkannt und kann dort geändert werden.'],
    ['Bei Spalten „X“ und „Y“: Bei Landesvermessung (Österreich MGI, Deutschland Gauß-Krüger) ist Y der Rechtswert und X der Hochwert.'],
    ['Importierte Pfähle haben noch keine Ausführungszeiten und erscheinen auf der Karte als „Noch offen“.'],
    ['Die Schichtenfolge wird nicht importiert, sie erfassen Sie im Formular des Pfahls.'],
  ]);
  hints['!cols'] = [{ wch: 150 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bohrpfähle');
  XLSX.utils.book_append_sheet(wb, hints, 'Hinweise');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(out, 'Bohrpfahl-Importvorlage.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast('Vorlage gespeichert.');
});
