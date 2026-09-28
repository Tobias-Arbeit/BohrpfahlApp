'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =====================================================================
   Konstanten
   ===================================================================== */
const LS_META = 'bohrpfahl.meta';   // Benutzername, Salt, Iterationen (unverschlüsselt)
const LS_DATA = 'bohrpfahl.data';   // verschlüsselte Daten (AES-GCM)
const SS_KEY = 'bohrpfahl.sk';      // Sitzungsschlüssel (nur solange der Tab offen ist)
const PBKDF2_ITER = 400000;
const IDLE_MS = 30 * 60 * 1000;     // automatische Sperre nach 30 Minuten Inaktivität
const APP_ID = 'bohrpfahl-verwaltung';
const DATA_VERSION = 3;

const TYPE_SUGGESTIONS = [
  'Bohrpfahl verrohrt', 'Bohrpfahl unverrohrt', 'Bohrpfahl suspensionsgestützt',
  'Schneckenbohrpfahl (CFA)', 'Verdrängungsbohrpfahl (FDP)', 'Großbohrpfahl', 'Probepfahl',
];
const SOIL_SUGGESTIONS = [
  'Sauberkeitsschicht', 'Kies / Schluff', 'Kies / Sand', 'Sand', 'Schluff', 'Ton', 'Auffüllung',
  'Holz', 'Fels / Findling, Blöcke', 'Beton',
];

/** Art einer Schicht in der Schichtenfolge (Bohrhindernis / harte Bodenschicht erscheinen im Protokoll mit Titel) */
const SCHICHT_ARTEN = [
  { k: 'boden',     label: 'Boden' },
  { k: 'hindernis', label: 'Bohrhindernis' },
  { k: 'hart',      label: 'harte Bodenschicht' },
];

/* Arbeitsvorgänge der Ausführungszeiten. growable: es gibt zu Beginn nur eine Zeile;
   sobald die letzte Zeile abgeschlossen ist (von + bis ausgefüllt), erscheint automatisch
   eine weitere (siehe zeitRowsFor / maybeGrowZeitGroup). Bewehren/Betonieren bleiben einzeilig. */
const ZEIT_GROUPS = [
  { k: 'bohren',     label: 'Bohren',              growable: true },
  { k: 'hindernis',  label: 'Bohrhindernis',       growable: true },
  { k: 'hart',       label: 'harte Bodenschicht',  growable: true },
  { k: 'bewehren',   label: 'Bewehren' },
  { k: 'betonieren', label: 'Betonieren' },
];

/* Was der Borist bei importierten bzw. vom Administrator angelegten Pfählen ergänzen darf:
   Ist-Werte, Grundwasser, Wasserauflast, Abstichmaß, Betonverbrauch IST, Bodenaufschluss, Zeiten, Bemerkung */
const BORIST_NUM = ['arbeitsebene', 'oberkante', 'unterkante', 'bohrlaenge', 'pfahllaenge', 'leerbohrung', 'gwTiefe', 'grundwasser', 'abstich', 'verbrauchIst'];
const BORIST_KEYS = [...BORIST_NUM, 'wasserauflast', 'bemerkung', 'schichten', 'zeiten', 'geraet', 'geraetInfo', 'fotos'];

/** Bohrgerät als Text („Typ · Inv.-Nr. …“); nutzt die Projektliste, sonst die gespeicherte Kopie am Pfahl */
const geraetText = (g, fallback) => {
  const d = g && (state.projekt.geraete || []).find(x => x.id === g);
  const o = d || fallback;
  return o ? [o.typ, o.inv && `Inv.-Nr. ${o.inv}`].filter(Boolean).join(' · ') : '';
};
const pickAllowed = p => Object.fromEntries(BORIST_KEYS.filter(k => k in p).map(k => [k, structuredClone(p[k])]));

/* Berechtigungen je Pfahl. quelle: 'import' | 'admin' | 'borist' (fehlt bei älteren Pfählen = 'admin') */
const canFullEdit = p => isAdmin() || p.quelle === 'borist';
const canDeleteOrCopy = p => isAdmin() || p.quelle === 'borist';
const isLocked = p => !isAdmin() && !!p.geprueft;

/* =====================================================================
   Krypto (WebCrypto: PBKDF2 → AES-GCM)
   ===================================================================== */
const te = new TextEncoder();
const td = new TextDecoder();

const toB64 = buf => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
const uid = () => [...randomBytes(12)].map(b => b.toString(16).padStart(2, '0')).join('');

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

async function seal(k, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function unseal(k, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, k, fromB64(blob.ct));
  return normalizeState(JSON.parse(td.decode(pt)));
}

/* =====================================================================
   Datenmodell & Migration
   ===================================================================== */
const emptyZeiten = () => Object.fromEntries(ZEIT_GROUPS.map(g => [g.k, [{}]]));

const defaultProjekt = () => ({
  nr: '', name: '', ort: '', titel: 'Ortbetonbohrpfähle', norm: 'nach EN 1536',
  hoehenbezug: 'm ü. A', logo: null, logoW: 0, logoH: 0,
  crs: 'EPSG:25832',   // Koordinatensystem der Pfahl-Koordinaten
  geraete: [],         // Bohrgeräte: { id, typ, inv, kommentar }
  bodenartenAktiv: null,   // für den Borist freigegebene Standard-Bodenarten (Namen); null = alle
  bodenartenCustom: [],    // zusätzliche, selbst angelegte Bodenarten: { id, name, sym }
});

/* Höhen/Längen gibt es zweimal: Soll (Plan, Präfix s…) und Ist (ausgeführt) – wie im Bohrprotokoll */
const emptyPile = () => ({
  nr: '', pfahlart: 'bewehrt', bewTyp: '', typ: '', neigung: null,
  durchmesser: null,
  ost: null, nord: null,
  sArbeitsebene: null, sOberkante: null, sUnterkante: null, sBohrlaenge: null, sPfahllaenge: null, sLeerbohrung: null,
  arbeitsebene: null, oberkante: null, unterkante: null, bohrlaenge: null, pfahllaenge: null, leerbohrung: null,
  wasserauflast: false, gwTiefe: null, grundwasser: null, abstich: null,
  schichten: [], planNr: '', masse: null,
  betongute: '', konsistenz: '', verbrauchIst: null,
  zeiten: emptyZeiten(), bemerkung: '',
  fotos: [],                         // Fotos zur Bemerkung: { id, name, data (JPEG-Data-URL), w, h }
  geraet: '', geraetInfo: null,      // Bohrgerät (id im Projekt) und Kopie von Typ/Inventarnummer für das Protokoll
});

function migratePile(p, fromVersion) {
  const q = { ...emptyPile(), ...p };
  if (fromVersion < 2) {
    if (isNum(p.durchmesser)) q.durchmesser = Math.round(p.durchmesser) / 10;       // mm → cm
    if (isNum(p.grundwasser) && isNum(p.bohrlaenge)) q.gwTiefe = Math.round((p.bohrlaenge - p.grundwasser) * 100) / 100;
    const z = emptyZeiten();
    if (p.beginn) {
      z.bohren[0] = { d: String(p.beginn).slice(0, 10), von: String(p.beginn).slice(11, 16) };
      if (p.ende) z.bohren[0].bis = String(p.ende).slice(11, 16);
    }
    q.zeiten = z;
    delete q.beginn; delete q.ende;
  }
  // mindestens eine Zeile je Arbeitsvorgang sicherstellen; nicht mehr angezeigte Arbeitsvorgänge
  // (z. B. „Entsanden“) bleiben in den Daten erhalten
  const z = emptyZeiten();
  for (const g of ZEIT_GROUPS) {
    const existing = q.zeiten?.[g.k];
    z[g.k] = (Array.isArray(existing) && existing.length ? existing : [{}]).map(e => ({ ...e }));
  }
  for (const k of Object.keys(q.zeiten || {})) if (!(k in z)) z[k] = q.zeiten[k];
  q.zeiten = z;
  if (!Array.isArray(q.fotos)) q.fotos = [];
  // Schichten: früheres Häkchen „hart“ → Art
  q.schichten = (Array.isArray(q.schichten) ? q.schichten : []).map(s => {
    const { hart, ...rest } = s;
    return { ...rest, art: s.art || (hart ? 'hart' : 'boden') };
  });
  return q;
}

function normalizeState(o) {
  const v = o.v || 1;
  const projekt = { ...defaultProjekt(), ...(typeof o.projekt === 'string' ? { name: o.projekt } : (o.projekt || {})) };
  return {
    v: DATA_VERSION,
    projekt,
    piles: Array.isArray(o.piles) ? o.piles.map(p => migratePile(p, v)) : [],
  };
}

/* =====================================================================
   Zustand & Speicher
   ===================================================================== */
let key = null;                       // CryptoKey der aktuellen Sitzung
let meta = null;                      // { v, user, salt, iter }
let state = normalizeState({});
let lastActivity = Date.now();

const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

let saveChain = Promise.resolve();
function persist() {
  saveChain = saveChain.then(async () => {
    if (!key) return;
    const blob = await seal(key, state);
    localStorage.setItem(LS_DATA, JSON.stringify(blob));
  }).catch(e => toast(e && e.name === 'QuotaExceededError'
    ? 'Speichern fehlgeschlagen: Der Speicher des Browsers ist voll. Bitte Fotos entfernen.'
    : 'Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e)));
  return saveChain;
}

/* =====================================================================
   Formatierung & Berechnung
   ===================================================================== */
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf2max = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const rd = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };
const isNum = v => typeof v === 'number' && isFinite(v);
const diff = (a, b, d = 3) => (isNum(a) && isNum(b)) ? rd(a - b, d) : null;
const fmtInput = n => String(n).replace('.', ',');
/** Zahl ohne Tausendertrennung, mit Komma – für PDF-Protokoll und CSV. */
const fmtPlain = (n, d) => isNum(n) ? n.toFixed(d).replace('.', ',') : '';
const fmtFlex = n => isNum(n) ? String(n).replace('.', ',') : '';
const hoehenbezug = () => state.projekt.hoehenbezug || 'm ü. A';

/** Liefert null (leer), NaN (ungültig) oder die Zahl. Akzeptiert Komma und Punkt. */
function parseNum(str) {
  let s = String(str ?? '').trim().replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

const pad2 = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtDT = s => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || '');
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : '';
};
const fmtDate = d => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const fmtDateShort = d => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : ''; };
const fmtDur = m => m == null ? '' : `${Math.floor(m / 60)}:${pad2(m % 60)} h`;
const fmtDurPad = m => m == null ? '' : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

/* --- Ausführungszeiten --- */
const entryStart = e => e && e.d && e.von ? Date.parse(`${e.d}T${e.von}`) : null;
const entryEnd = e => {
  if (!(e && e.d && e.bis)) return null;
  let t = Date.parse(`${e.d}T${e.bis}`);
  const s = entryStart(e);
  if (s != null && t < s) t += 86400000;             // über Mitternacht
  return t;
};
const entryMin = e => {
  const s = entryStart(e), t = entryEnd(e);
  return s != null && t != null ? Math.round((t - s) / 60000) : null;
};
const allEntries = p => ZEIT_GROUPS.flatMap(g => p.zeiten?.[g.k] || []);
function span(p) {
  const es = allEntries(p);
  const st = es.map(entryStart).filter(v => v != null);
  const en = es.map(entryEnd).filter(v => v != null);
  return { s: st.length ? Math.min(...st) : null, e: en.length ? Math.max(...en) : null };
}
function dauerMin(p) {
  const { s, e } = span(p);
  return s != null && e != null && e >= s ? Math.round((e - s) / 60000) : null;
}
function hindernisMin(p) {
  const ms = (p.zeiten?.hindernis || []).map(entryMin).filter(v => v != null);
  return ms.length ? ms.reduce((a, b) => a + b, 0) : null;
}
function zeitText(p, gk) {
  return (p.zeiten?.[gk] || []).filter(e => e.d || e.von || e.bis)
    .map(e => `${fmtDate(e.d)} ${e.von || ''}–${e.bis || ''}`.trim()).join(' | ');
}

/* --- Schichten, Beton --- */
function layerSpans(p) {
  const out = [];
  let prev = 0;
  for (const s of (p.schichten || [])) {
    if (!isNum(s.bis)) continue;
    out.push({ von: prev, bis: s.bis, boden: s.boden || '', art: s.art || (s.hart ? 'hart' : 'boden') });
    prev = s.bis;
  }
  return out;
}
function hartSumme(p) {
  const l = layerSpans(p);
  return l.length ? rd(l.filter(s => s.art === 'hart').reduce((a, s) => a + (s.bis - s.von), 0), 2) : null;
}
/** Betonverbrauch SOLL [m³] = Pfahllänge × π × r² (Durchmesser in cm); Grundlage ist die Soll-Länge, sonst die Ist-Länge */
const soll = p => {
  const len = isNum(p.sPfahllaenge) ? p.sPfahllaenge : p.pfahllaenge;
  return (isNum(len) && isNum(p.durchmesser)) ? rd(len * Math.PI * (p.durchmesser / 200) ** 2, 1) : null;
};

/* =====================================================================
   Spalten (Tabelle, Übersichts-PDF, CSV)
   t = in Tabelle/Übersichtsliste sichtbar, sonst nur im CSV
   ===================================================================== */
const COLS = [
  { k: 'nr',            label: 'Pfahl-Nr.',             unit: '',        kind: 'text', t: true },
  { k: 'pfahlart',      label: 'Pfahlart',              unit: '',        kind: 'text' },
  { k: 'bewTyp',        label: 'Bew. Typ',              unit: '',        kind: 'text' },
  { k: 'typ',           label: 'Typ',                   unit: '',        kind: 'text', t: true },
  { k: 'neigung',       label: 'Neigung',               unit: '°',       kind: 'cm' },
  { k: 'durchmesser',   label: 'Pfahl-Ø',               unit: 'cm',      kind: 'cm',   t: true },
  { k: 'ost',           label: 'Rechtswert / Ost',      unit: '@C',      kind: 'coord' },
  { k: 'nord',          label: 'Hochwert / Nord',       unit: '@C',      kind: 'coord' },
  { k: 'sArbeitsebene', label: 'Arbeitsebene Soll',     unit: '@H',      kind: 'h' },
  { k: 'sOberkante',    label: 'Pfahl-OK Soll',         unit: '@H',      kind: 'h',    t: true },
  { k: 'sUnterkante',   label: 'Pfahl-UK Soll',         unit: '@H',      kind: 'h',    t: true },
  { k: 'sBohrlaenge',   label: 'Bohrlänge Soll',        unit: 'm',       kind: 'h' },
  { k: 'sPfahllaenge',  label: 'Pfahllänge Soll',       unit: 'm',       kind: 'h',    t: true, sum: true },
  { k: 'sLeerbohrung',  label: 'Leerbohrung Soll',      unit: 'm',       kind: 'h' },
  { k: 'arbeitsebene',  label: 'Arbeitsebene Ist',      unit: '@H',      kind: 'h' },
  { k: 'oberkante',     label: 'Pfahl-OK Ist',          unit: '@H',      kind: 'h',    t: true },
  { k: 'unterkante',    label: 'Pfahl-UK Ist',          unit: '@H',      kind: 'h',    t: true },
  { k: 'bohrlaenge',    label: 'Bohrlänge Ist',         unit: 'm',       kind: 'h',    t: true, sum: true },
  { k: 'pfahllaenge',   label: 'Pfahllänge Ist',        unit: 'm',       kind: 'h',    t: true, sum: true },
  { k: 'leerbohrung',   label: 'Leerbohrung Ist',       unit: 'm',       kind: 'h' },
  { k: 'wasserauflast', label: 'Wasserauflast',         unit: '',        kind: 'bool', t: true },
  { k: 'gwTiefe',       label: 'Grundwasser ab',        unit: 'm u. Bohrebene', kind: 'm' },
  { k: 'grundwasser',   label: 'Bohren im GW',          unit: 'm',       kind: 'h',    t: true, sum: true },
  { k: 'abstich',       label: 'Abstichmaß Überbeton',  unit: 'm ab AE', kind: 'm' },
  { k: 'hartSumme',     label: 'Durchörtern harte Bodenschichten', unit: 'm', kind: 'm' },
  { k: 'planNr',        label: 'Bewehrung lt. Plan Nr.', unit: '',       kind: 'text' },
  { k: 'masse',         label: 'Bewehrung Masse',       unit: 'kg',      kind: 'm' },
  { k: 'betongute',     label: 'Betongüte',             unit: '',        kind: 'text' },
  { k: 'konsistenz',    label: 'Konsistenz',            unit: '',        kind: 'text' },
  { k: 'verbrauchSoll', label: 'Verbrauch SOLL',        unit: 'm³',      kind: 'm1' },
  { k: 'verbrauchIst',  label: 'Verbrauch IST',         unit: 'm³',      kind: 'm1',   t: true, sum: true },
  { k: 'beginn',        label: 'Beginn',                unit: '',        kind: 'dt',   t: true },
  { k: 'ende',          label: 'Ende',                  unit: '',        kind: 'dt',   t: true },
  { k: 'dauer',         label: 'Dauer',                 unit: 'h:mm',    kind: 'dur',  t: true, sum: true },
  { k: 'hindernisDauer', label: 'Durchörtern Bohrhindernisse', unit: 'h:mm', kind: 'dur' },
  ...ZEIT_GROUPS.map(g => ({ k: 'z_' + g.k, label: g.label, unit: 'Datum von–bis', kind: 'text' })),
  { k: 'geraet',        label: 'Bohrgerät',             unit: '',        kind: 'text' },
  { k: 'status',        label: 'Ausführungsstand',      unit: '',        kind: 'status', t: true },
  { k: 'geprueft',      label: 'Geprüft von / am',      unit: '',        kind: 'text' },
  { k: 'bemerkung',     label: 'Bemerkung',             unit: '',        kind: 'text' },
];
const TCOLS = COLS.filter(c => c.t);
/* Kompakte Tabelle für den Borist: weniger Spalten, dafür der Bewehrungstyp dabei (sonst nur im CSV). */
const BORIST_TABLE_KEYS = ['nr', 'bewTyp', 'typ', 'durchmesser', 'pfahllaenge', 'wasserauflast', 'verbrauchIst', 'status'];
const tableCols = () => isAdmin() ? TCOLS : COLS.filter(c => BORIST_TABLE_KEYS.includes(c.k));
const unitOf = c => c.unit === '@H' ? hoehenbezug() : c.unit === '@C' ? coordLabels().unit : c.unit;

function getVal(p, k) {
  switch (k) {
    case 'dauer': return dauerMin(p);
    case 'beginn': { const s = span(p).s; return s == null ? null : toLocalInput(new Date(s)); }
    case 'ende': { const e = span(p).e; return e == null ? null : toLocalInput(new Date(e)); }
    case 'verbrauchSoll': return soll(p);
    case 'hartSumme': return hartSumme(p);
    case 'hindernisDauer': return hindernisMin(p);
    case 'geraet': return geraetText(p.geraet, p.geraetInfo);
    case 'status': return STATUS[pileStatus(p)].label;
    case 'geprueft': return p.geprueft ? `${p.geprueft.von}, ${fmtDate(String(p.geprueft.am).slice(0, 10))}` : '';
    default: return k.startsWith('z_') ? zeitText(p, k.slice(2)) : p[k];
  }
}

function cellText(p, c) {
  const v = getVal(p, c.k);
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
  switch (c.kind) {
    case 'cm': return nf1.format(v);
    case 'h': return nf3.format(v);
    case 'm': return nf2.format(v);
    case 'm1': return nf2max.format(v);
    case 'status': return String(v);
    case 'coord': return nfCoord(v);
    case 'bool': return v ? 'Ja' : 'Nein';
    case 'dt': return fmtDT(v);
    case 'dur': return fmtDur(v);
    default: return String(v);
  }
}

function totals(list) {
  const t = {};
  for (const c of TCOLS) {
    if (!c.sum) continue;
    t[c.k] = list.reduce((s, p) => { const v = getVal(p, c.k); return isNum(v) ? s + v : s; }, 0);
  }
  return t;
}
const totalText = (c, v) => c.kind === 'dur' ? fmtDur(v) : c.kind === 'h' ? nf3.format(rd(v, 3)) : nf2.format(rd(v, 2));
const plural = n => `${nf0.format(n)} ${n === 1 ? 'Pfahl' : 'Pfähle'}`;

/* =====================================================================
   Toast
   ===================================================================== */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

/* =====================================================================
   Sperrbildschirm / Anmeldung
   ===================================================================== */
const lockEl = $('#lock');
const lockForm = $('#lockForm');
let failCount = 0;

function lockError(msg) {
  const e = $('#lockError');
  e.textContent = msg || '';
  e.hidden = !msg;
}

function showLock() {
  meta = readJSON(LS_META);
  const setup = !(meta && (meta.users || meta.salt) && readJSON(LS_DATA));
  if (setup) meta = null;
  lockEl.classList.toggle('setup', setup);
  $('#lPass').autocomplete = setup ? 'new-password' : 'current-password';
  lockForm.reset();
  lockError('');
  $('#app').hidden = true;
  lockEl.hidden = false;
  if (!window.crypto || !crypto.subtle) {
    lockError('Dieser Browser stellt keine Verschlüsselung bereit. Bitte die Datei direkt vom Rechner öffnen oder über https aufrufen.');
    $('#lockSubmit').disabled = true;
    return;
  }
  try { localStorage.setItem('bohrpfahl.test', '1'); localStorage.removeItem('bohrpfahl.test'); }
  catch { lockError('Der Browser-Speicher ist nicht verfügbar (privater Modus?). Daten könnten nicht gesichert werden.'); $('#lockSubmit').disabled = true; return; }
  $('#lockSubmit').disabled = false;
  setTimeout(() => $('#lUser').focus(), 0);
}

/* ---------------------------------------------------------------------
   Benutzer und Schlüssel
   Alle Daten sind mit einem zufälligen Datenschlüssel (AES-256) verschlüsselt. Jeder Benutzer hat
   eine eigene Hülle dieses Schlüssels, die nur sein Passwort öffnet. meta = { v: 2, users: [...] }.
   Ältere Sicherungen/Daten (v1: ein Benutzer, Schlüssel direkt aus dem Passwort) werden beim
   ersten Login automatisch umgestellt; der bisherige Benutzer wird Administrator.
   --------------------------------------------------------------------- */
const ROLES = { admin: 'Administrator', borist: 'Borist' };
let me = null;                                             // { id, name, role }
const isAdmin = () => !!me && me.role === 'admin';
const userList = () => (meta && Array.isArray(meta.users)) ? meta.users : [];
const findUser = name => userList().find(u => u.name.toLowerCase() === String(name).trim().toLowerCase());

async function wrapMaster(master, userKey) {
  const raw = await crypto.subtle.exportKey('raw', master);
  const iv = randomBytes(12);
  return { iv: toB64(iv), ct: toB64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, userKey, raw)) };
}
async function unwrapMaster(userKey, wk) {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wk.iv) }, userKey, fromB64(wk.ct));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}
async function newUserRecord(name, role, password, master) {
  const salt = randomBytes(16);
  const uk = await deriveKey(password, salt, PBKDF2_ITER);
  return { id: uid(), name, role, salt: toB64(salt), iter: PBKDF2_ITER, wk: await wrapMaster(master, uk) };
}
const saveMeta = () => localStorage.setItem(LS_META, JSON.stringify(meta));

async function startSession() {
  sessionStorage.setItem(SS_KEY, JSON.stringify({ k: toB64(await crypto.subtle.exportKey('raw', key)), u: me.id }));
  showApp();
}

lockForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#lockSubmit');
  const user = $('#lUser').value.trim();
  const pass = $('#lPass').value;
  lockError('');

  if (lockEl.classList.contains('setup')) {
    if (!user) return lockError('Bitte einen Benutzernamen eingeben.');
    if (pass.length < 8) return lockError('Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (pass !== $('#lPass2').value) return lockError('Die Passwörter stimmen nicht überein.');
    btn.disabled = true;
    try {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const rec = await newUserRecord(user, 'admin', pass, key);
      meta = { v: 2, users: [rec] };
      me = { id: rec.id, name: rec.name, role: rec.role };
      state = normalizeState({});
      saveMeta();
      await persist();
      await startSession();
    } catch (err) {
      key = null; me = null;
      lockError('Einrichtung fehlgeschlagen: ' + err.message);
    }
    btn.disabled = false;
    return;
  }

  btn.disabled = true;
  let ok = false;
  try {
    const legacy = !meta.users;
    const u = legacy ? { id: null, name: meta.user, role: 'admin', salt: meta.salt, iter: meta.iter } : findUser(user);
    if (u) {
      const uk = await deriveKey(pass, fromB64(u.salt), u.iter);
      const master = legacy ? uk : await unwrapMaster(uk, u.wk);
      const data = await unseal(master, readJSON(LS_DATA));
      if (!legacy || user.toLowerCase() === String(u.name).toLowerCase()) {
        if (legacy) {                                        // Umstellung v1 → v2: bisheriger Schlüssel wird zum Datenschlüssel
          u.id = uid();
          meta = { v: 2, users: [{ id: u.id, name: u.name, role: 'admin', salt: u.salt, iter: u.iter, wk: await wrapMaster(master, uk) }] };
          saveMeta();
        }
        key = master; state = data; me = { id: u.id, name: u.name, role: u.role }; ok = true;
      }
    } else {
      await deriveKey(pass, randomBytes(16), PBKDF2_ITER);   // gleiche Wartezeit wie bei falschem Passwort
    }
  } catch { /* falsches Passwort */ }

  if (ok) {
    failCount = 0;
    await startSession();
    btn.disabled = false;
  } else {
    failCount++;
    const wait = Math.min(1000 * 2 ** (failCount - 1), 30000);
    lockError('Benutzername oder Passwort ist falsch.');
    $('#lPass').value = '';
    setTimeout(() => { btn.disabled = false; $('#lPass').focus(); }, wait);
  }
});

$('#lockReset').addEventListener('click', () => {
  if (!confirm('ALLE gespeicherten Bohrpfahl-Daten und die Zugangsdaten auf diesem Gerät werden unwiderruflich gelöscht.\n\nFortfahren?')) return;
  if (!confirm('Wirklich alles löschen? Das kann nicht rückgängig gemacht werden.')) return;
  localStorage.removeItem(LS_META);
  localStorage.removeItem(LS_DATA);
  sessionStorage.removeItem(SS_KEY);
  showLock();
});

function lock() {
  key = null;
  me = null;
  state = normalizeState({});
  sessionStorage.removeItem(SS_KEY);
  $$('dialog[open]').forEach(d => d.close());
  closeMenus();
  // Angezeigte Daten aus dem DOM entfernen
  $('#tableWrap').innerHTML = '';
  $('#pageTitleText').textContent = 'Pfähle';
  $('#projektSub').textContent = '';
  $('#count').textContent = '';
  ui.q = ''; ui.typ = ''; ui.status = ''; ui.view = 'table';
  $('#q').value = ''; $('#statusFilter').value = '';
  clearMap();
  showLock();
}

/* Automatische Sperre bei Inaktivität */
['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(ev =>
  addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
const idleCheck = () => { if (key && Date.now() - lastActivity > IDLE_MS) lock(); };
setInterval(idleCheck, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) idleCheck(); });

/* Änderungen aus einem anderen Tab übernehmen */
addEventListener('storage', async e => {
  if (!key || (e.key !== LS_DATA && e.key !== LS_META)) return;
  try {
    meta = readJSON(LS_META);
    const u = userList().find(x => x.id === me.id);
    if (!u) return lock();                                   // Benutzer wurde gelöscht
    me = { id: u.id, name: u.name, role: u.role };
    state = await unseal(key, readJSON(LS_DATA));
    applyRole();
    render();
  } catch { lock(); }
});

/* =====================================================================
   Anwendung
   ===================================================================== */
const ui = { q: '', typ: '', status: '', sort: { k: 'nr', dir: 1 }, view: 'table' };

function setView(v) { ui.view = v; render(); }
$$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

/** Bedienelemente je nach Rolle ein-/ausblenden (data-admin = nur Administrator, data-borist = nur Borist) */
function applyRole() {
  document.body.classList.toggle('is-borist', !isAdmin());
  if (!isAdmin() && ui.view === 'stats') ui.view = 'table';
  $$('[data-admin]').forEach(el => { el.hidden = !isAdmin(); });
  $$('[data-borist]').forEach(el => { el.hidden = isAdmin(); });
  $('#whoami').textContent = me ? `${me.name} · ${ROLES[me.role]}` : '';
}

function showApp() {
  lockEl.hidden = true;
  $('#app').hidden = false;
  lastActivity = Date.now();
  applyRole();
  render();
}

function visiblePiles() {
  const q = ui.q.trim().toLowerCase();
  const list = state.piles.filter(p =>
    (!q || `${p.nr} ${p.typ}`.toLowerCase().includes(q)) && (!ui.typ || p.typ === ui.typ) && (!ui.status || statusMatches(p, ui.status)));
  const col = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const { k, dir } = ui.sort;
  list.sort((a, b) => {
    let va = getVal(a, k), vb = getVal(b, k);
    const na = va == null || va === '', nb = vb == null || vb === '';
    if (na || nb) return na === nb ? 0 : (na ? 1 : -1);   // Leere immer ans Ende
    if (typeof va === 'boolean') { va = +va; vb = +vb; }
    const c = (typeof va === 'string') ? col.compare(va, vb) : va - vb;
    return c * dir || col.compare(a.nr, b.nr);
  });
  return list;
}

const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  del: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  pdf: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
  rm: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  pin: svg('<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
  cam: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
};


/** PDF-Protokoll eines Pfahls; hat er Fotos, wird gefragt: mit oder ohne Fotoseiten */
function pdfProtokoll(p, anchor) {
  const n = (p.fotos || []).length;
  if (!n) return exportProtokolle([p]);
  $$('.foto-ask').forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'menu foto-ask';
  m.innerHTML = `<button type="button" data-f="1">Mit Fotos (${n})</button><button type="button" data-f="0">Ohne Fotos</button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.cssText = `position:fixed;right:auto;z-index:3000;top:${Math.round(r.bottom + 4)}px;left:${Math.round(Math.max(8, Math.min(r.left, innerWidth - 240)))}px`;
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  m.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation(); close();
    exportProtokolle([p], { fotos: b.dataset.f === '1' });
  });
  setTimeout(() => document.addEventListener('click', close), 0);
}

const colClass = c => ['cm', 'h', 'm', 'm1', 'dur', 'coord'].includes(c.kind) ? 'num' : c.kind === 'bool' ? 'mid' : '';

function renderProjekt() {
  const pr = state.projekt;
  const parts = [pr.name, pr.nr && `Baustelle Nr. ${pr.nr}`, pr.ort].filter(Boolean);
  $('#projektSub').textContent = parts.length ? parts.join(' · ') : (isAdmin() ? 'Projektdaten unter „Projektdaten“ festlegen' : '');
  $$('[data-hb]').forEach(s => { s.textContent = hoehenbezug(); });
}

/** Seitentitel wie im Vorbild: „Pfähle (295)“ bzw. „Karte (12)“ */
function renderTitle(n) {
  $('#pageTitleText').textContent = ui.view === 'stats' ? 'Auswertung' : `${ui.view === 'map' ? 'Karte' : 'Pfähle'} (${nf0.format(n)})`;
}

function render() {
  renderProjekt();
  const used = [...new Set(state.piles.map(p => p.typ).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  if (ui.typ && !used.includes(ui.typ)) ui.typ = '';
  $('#typFilter').innerHTML = '<option value="">Alle Typen</option>' +
    used.map(t => `<option value="${esc(t)}"${t === ui.typ ? ' selected' : ''}>${esc(t)}</option>`).join('');
  $('#typList').innerHTML = [...new Set([...TYPE_SUGGESTIONS, ...used])].map(t => `<option value="${esc(t)}">`).join('');

  const list = visiblePiles();
  const wrap = $('#tableWrap');
  const count = $('#count');
  const countText = list.length === state.piles.length ? '' : `${nf0.format(list.length)} von ${nf0.format(state.piles.length)} Pfählen (gefiltert)`;
  renderTitle(list.length);

  wrap.hidden = ui.view !== 'table';
  $('#mapView').hidden = ui.view !== 'map';
  $('#statsView').hidden = ui.view !== 'stats';
  $('.toolbar').hidden = ui.view === 'stats';
  count.hidden = ui.view === 'stats';
  $$('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === ui.view)));
  if (ui.view === 'stats') { renderStats(); return; }
  if (ui.view === 'map') {
    count.textContent = state.piles.length ? countText : '';
    renderMap(list);
    return;
  }

  if (!state.piles.length) {
    count.textContent = '';
    wrap.innerHTML = `<div class="placeholder"><h2>Noch keine Bohrpfähle erfasst</h2>
      <p>${isAdmin() ? 'Legen Sie den ersten Pfahl über „Neuer Pfahl“ an oder importieren Sie eine Excel-Liste.' : 'Der Administrator muss zuerst die Pfähle importieren. Eine Rückmeldung oder Sicherung erhalten Sie von ihm.'}</p>
      ${isAdmin() ? '<p><button type="button" class="btn" data-imp>Aus Excel importieren …</button></p>' : ''}</div>`;
    return;
  }
  count.textContent = countText;

  if (!list.length) {
    wrap.innerHTML = `<div class="placeholder"><h2>Keine Treffer</h2><p>Suche oder Filter anpassen.</p></div>`;
    return;
  }

  const cols = tableCols();
  const head = cols.map(c => {
    const sorted = ui.sort.k === c.k ? (ui.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
    const u = unitOf(c);
    return `<th class="${colClass(c)}" aria-sort="${sorted}"><button type="button" class="sort" data-sort="${c.k}">` +
      `<span class="lbl">${esc(c.label)}</span>${u ? `<span class="u">[${esc(u)}]</span>` : ''}</button></th>`;
  }).join('') + '<th></th>';

  const rows = list.map(p => '<tr data-id="' + esc(p.id) + '">' + cols.map(c => {
    const t = cellText(p, c);
    if (c.kind === 'bool') return `<td class="mid"><span class="chip${p.wasserauflast ? ' yes' : ''}">${t}</span></td>`;
    if (c.kind === 'status') return `<td><span class="chip st-${pileStatus(p)}">${esc(t)}</span></td>`;
    if (!t) return `<td class="${colClass(c)} empty">–</td>`;
    return `<td class="${colClass(c)}">${esc(t)}</td>`;
  }).join('') + `<td class="actions">
      <button class="icon-btn" type="button" data-act="edit" title="Bearbeiten" aria-label="Pfahl ${esc(p.nr)} bearbeiten">${ICON.edit}</button>
      ${toLatLon(p) ? `<button class="icon-btn" type="button" data-act="map" title="Auf Karte zeigen" aria-label="Pfahl ${esc(p.nr)} auf Karte zeigen">${ICON.pin}</button>` : ''}
      ${(p.fotos || []).length ? `<span class="foto-badge" title="${p.fotos.length} Foto(s) angehängt" role="img" aria-label="${p.fotos.length} Fotos angehängt">${ICON.cam}<b>${p.fotos.length}</b></span>` : '<span class="foto-slot"></span>'}
      <button class="icon-btn" type="button" data-act="pdf" title="Bohrprotokoll (PDF)" aria-label="Bohrprotokoll für Pfahl ${esc(p.nr)} als PDF">${ICON.pdf}</button>
      ${p.geprueft ? `<span class="pruef-badge" title="Geprüft von ${esc(p.geprueft.von)} am ${esc(fmtDate(String(p.geprueft.am).slice(0, 10)))}" role="img" aria-label="Geprüft">${ICON.check}</span>` : '<span class="pruef-slot"></span>'}
      ${canDeleteOrCopy(p) ? `<button class="icon-btn danger" type="button" data-act="del" title="Löschen" aria-label="Pfahl ${esc(p.nr)} löschen">${ICON.del}</button>` : ''}
    </td></tr>`).join('');

  const t = totals(list);
  const foot = '<tr>' + cols.map((c, i) => {
    if (i === 0) return '<td>Summe</td>';
    return `<td class="${colClass(c)}">${c.sum ? esc(totalText(c, t[c.k])) : ''}</td>`;
  }).join('') + '<td></td></tr>';

  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>`;
}

/* Tabelle: Sortierung, Zeilenaktionen */
$('#tableWrap').addEventListener('click', e => {
  if (e.target.closest('[data-imp]')) return openImport();
  const s = e.target.closest('[data-sort]');
  if (s) {
    const k = s.dataset.sort;
    ui.sort = ui.sort.k === k ? { k, dir: -ui.sort.dir } : { k, dir: 1 };
    return render();
  }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act || 'edit';
  const p = state.piles.find(x => x.id === id);
  if (!p) return;
  if (act === 'edit') openPile({ id });
  else if (act === 'pdf') pdfProtokoll(p, e.target.closest('[data-act]'));
  else if (act === 'map') { setView('map'); focusPile(p.id); }
  else if (act === 'del' && !canDeleteOrCopy(p)) toast('Importierte Pfähle können Sie nicht löschen.');
  else if (act === 'del' && confirm(`Pfahl „${p.nr}“ wirklich löschen?`)) {
    state.piles = state.piles.filter(x => x.id !== id);
    persist();
    render();
    toast(`Pfahl „${p.nr}“ gelöscht.`);
  }
});

$('#q').addEventListener('input', e => { ui.q = e.target.value; render(); });
$('#typFilter').addEventListener('change', e => { ui.typ = e.target.value; render(); });
$('#statusFilter').addEventListener('change', e => { ui.status = e.target.value; render(); });

/** Filter „Ausgeführt“ zählt geprüfte Pfähle mit (sie bleiben ausgeführt); „zupruefen“ = ausgeführt, noch nicht geprüft */
function statusMatches(p, f) {
  const s = pileStatus(p);
  if (f === 'fertig') return s === 'fertig' || s === 'geprueft';
  if (f === 'zupruefen') return s === 'fertig';
  return s === f;
}

/* Reiter, die Dialoge öffnen (Import, Projektdaten, Benutzer, Mein Konto) */
$$('[data-nav]').forEach(b => b.addEventListener('click', () => {
  const act = { import: () => openImport(), projekt: () => openProjekt(), users: () => openUsers(), konto: () => openPassword() }[b.dataset.nav];
  if (act) act();
}));
$('#btnNew').addEventListener('click', () => openPile());
$('#btnLock').addEventListener('click', lock);
$('#btnRueck').addEventListener('click', () => exportRueckmeldung());

/* Menüs (PDF, Mehr) */
function closeMenus() {
  $$('.menu:not(.foto-ask)').forEach(m => { m.hidden = true; });
  $$('[data-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
$$('[data-menu]').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  const m = $('#' + b.dataset.menu);
  const open = m.hidden;
  closeMenus();
  m.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
}));
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
$$('.menu').forEach(m => m.addEventListener('click', e => {
  if (e.target.closest('button')) closeMenus();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  closeMenus();
  if (act === 'backup') exportBackup();
  else if (act === 'restore') { if (isAdmin()) $('#restoreFile').click(); }
  else if (act === 'password') openPassword();
  else if (act === 'users') openUsers();
  else if (act === 'rueck-export') exportRueckmeldung();
  else if (act === 'rueck-import') { if (isAdmin()) rueckInput.click(); }
  else if (act === 'pdf-proto') exportProtokolle(visiblePiles());
  else if (act === 'pdf-proto-nofoto') exportProtokolle(visiblePiles(), { fotos: false });
  else if (act === 'pdf-list') exportPdf();
}));

/* Dialoge schließen */
document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

/* =====================================================================
   Pfahl erfassen / bearbeiten
   ===================================================================== */
const pileDlg = $('#pileDialog');
const form = $('#pileForm');

/* Zahlenfelder mit Nachkommastellen */
/* (s… = Soll/Plan, ohne Präfix = Ist/ausgeführt) */
const NUM_FIELDS = {
  durchmesser: 1, neigung: 1,
  sArbeitsebene: 3, sOberkante: 3, sUnterkante: 3, sBohrlaenge: 3, sPfahllaenge: 3, sLeerbohrung: 3,
  arbeitsebene: 3, oberkante: 3, unterkante: 3, bohrlaenge: 3, pfahllaenge: 3, leerbohrung: 3,
  gwTiefe: 2, grundwasser: 3, abstich: 2,
  masse: 2, verbrauchIst: 2, ost: 8, nord: 8,
};
const TEXT_FIELDS = ['nr', 'bewTyp', 'typ', 'planNr', 'betongute', 'konsistenz', 'bemerkung'];
const LABEL = {
  durchmesser: 'Pfahl-Ø', neigung: 'Neigung',
  sArbeitsebene: 'Arbeitsebene (Soll)', sOberkante: 'Pfahl-OK (Soll)', sUnterkante: 'Pfahl-UK (Soll)',
  sBohrlaenge: 'Bohrlänge (Soll)', sPfahllaenge: 'Pfahllänge (Soll)', sLeerbohrung: 'Leerbohrung (Soll)',
  arbeitsebene: 'Arbeitsebene (Ist)', oberkante: 'Pfahl-OK (Ist)', unterkante: 'Pfahl-UK (Ist)',
  bohrlaenge: 'Bohrlänge (Ist)', pfahllaenge: 'Pfahllänge (Ist)', leerbohrung: 'Leerbohrung (Ist)',
  gwTiefe: 'Grundwasser ab', grundwasser: 'Bohren im GW', abstich: 'Abstichmaß Überbeton',
  masse: 'Masse', verbrauchIst: 'Verbrauch IST', ost: 'Rechtswert/Ost', nord: 'Hochwert/Nord',
};

/** Beschriftung und Einheit der Koordinatenfelder passend zum Koordinatensystem des Projekts */
function updateCoordLabels() {
  const cl = coordLabels();
  $$('[data-coord-label]').forEach(s => { s.textContent = cl[s.dataset.coordLabel]; });
  $$('[data-coord-unit]').forEach(s => { s.textContent = cl.unit; });
}
/* Berechnete Felder: werden automatisch befüllt, solange sie nicht von Hand überschrieben wurden.
   Reihenfolge ist wichtig (Bohren im GW nutzt die Bohrlänge). */
const AUTO = {
  sBohrlaenge:  { from: v => diff(v.sArbeitsebene, v.sUnterkante), hint: 'Arbeitsebene − Pfahl-UK' },
  sPfahllaenge: { from: v => diff(v.sOberkante, v.sUnterkante),    hint: 'Pfahl-OK − Pfahl-UK' },
  sLeerbohrung: { from: v => diff(v.sArbeitsebene, v.sOberkante),  hint: 'Arbeitsebene − Pfahl-OK' },
  bohrlaenge:   { from: v => diff(v.arbeitsebene, v.unterkante),   hint: 'Arbeitsebene − Pfahl-UK' },
  pfahllaenge:  { from: v => diff(v.oberkante, v.unterkante),      hint: 'Pfahl-OK − Pfahl-UK' },
  leerbohrung:  { from: v => diff(v.arbeitsebene, v.oberkante),    hint: 'Arbeitsebene − Pfahl-OK' },
  grundwasser:  { from: v => {
                    const bl = isNum(v.bohrlaenge) ? v.bohrlaenge : v.sBohrlaenge;
                    return (isNum(v.gwTiefe) && isNum(bl)) ? rd(Math.max(0, bl - v.gwTiefe), 3) : null;
                  }, hint: 'Bohrlänge − Grundwasser ab' },
};
let editing = null;
let autoOn = {};

function nextNr(nr) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(nr || '');
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') + m[3] : '';
}
function readNums() {
  const v = {};
  for (const [k, d] of Object.entries(NUM_FIELDS)) {
    const n = parseNum(form.elements[k].value);
    v[k] = (n === null || Number.isNaN(n)) ? n : rd(n, d);
  }
  return v;
}

function readSchichten() {
  return $$('.schicht', form).map(r => {
    const n = parseNum($('[data-s=bis]', r).value);
    const art = $('[data-s=art]', r).value || 'boden';
    return {
      bis: n === null ? null : (Number.isNaN(n) ? NaN : rd(n, 2)),
      boden: (art === 'boden' ? $('[data-s=boden]', r).value : $('[data-s=hinweis]', r).value).trim(),
      art,
    };
  }).filter(s => !(s.bis === null && !s.boden));
}

function readZeiten() {
  const z = {};
  for (const g of ZEIT_GROUPS) {
    z[g.k] = $$(`.zeile[data-g="${g.k}"]`, form).map(r => {
      const e = {};
      for (const f of ['d', 'von', 'bis']) { const v = $(`[data-z=${f}]`, r).value; if (v) e[f] = v; }
      return e;
    });
  }
  return z;
}

function readPile() {
  const e = form.elements;
  const p = { pfahlart: e.pfahlart.value, wasserauflast: e.wasserauflast.value === 'ja', ...readNums() };
  for (const k of TEXT_FIELDS) p[k] = e[k].value.trim();
  p.schichten = readSchichten();
  p.zeiten = readZeiten();
  p.fotos = curFotos.slice();
  const opt = e.geraet.selectedOptions[0];
  p.geraet = e.geraet.value;
  p.geraetInfo = p.geraet && opt ? { typ: opt.dataset.typ || '', inv: opt.dataset.inv || '', kommentar: opt.dataset.kommentar || '' } : null;
  return p;
}

/** Auswahl der Bohrgeräte im Pfahlformular (Liste aus den Projektdaten); ein gelöschtes Gerät bleibt am Pfahl erhalten */
function fillGeraetSelect(p) {
  const list = state.projekt.geraete || [];
  const attrs = d => `data-typ="${esc(d.typ || '')}" data-inv="${esc(d.inv || '')}" data-kommentar="${esc(d.kommentar || '')}"`;
  const opts = ['<option value="">– kein Gerät gewählt –</option>',
    ...list.map(d => `<option value="${esc(d.id)}" ${attrs(d)}${p.geraet === d.id ? ' selected' : ''}>${esc(geraetText(d.id))}${d.kommentar ? ` (${esc(d.kommentar)})` : ''}</option>`)];
  if (p.geraet && !list.some(d => d.id === p.geraet) && p.geraetInfo) {
    opts.push(`<option value="${esc(p.geraet)}" ${attrs(p.geraetInfo)} selected>${esc(geraetText(null, p.geraetInfo))} (nicht mehr im Projekt)</option>`);
  }
  $('#f_geraet').innerHTML = opts.join('');
  $('#geraetHint').textContent = list.length ? '' : 'Noch keine Geräte angelegt – der Administrator legt sie unter „Projektdaten“ an.';
}

/** Welche Bodenarten in einem (evtl. kommagetrennten) Text stecken, in Standard-Reihenfolge
    (Standardliste zuerst, dann zusätzliche Bodenarten). */
function soilsIn(cur) {
  const parts = String(cur ?? '').split(',').map(normSoil).filter(Boolean);
  return allSoils().filter(s => parts.includes(normSoil(s.name)));
}
/** Checkboxen für mehrere Bodenbestandteile (siehe schichtRowHTML). Admin sieht alle Bodenarten,
    der Borist nur die in den Projektdaten freigegebenen; bereits gesetzte, inzwischen nicht mehr
    freigegebene Bodenarten bleiben zusätzlich sichtbar, damit keine Angaben stillschweigend
    verschwinden. Das erste angehakte gilt für Grafik/Protokoll als Hauptanteil (soilOf). */
const soilChecksHtml = cur => {
  const gewaehlt = soilsIn(cur);
  const checked = new Set(gewaehlt.map(s => s.name));
  const verfuegbar = isAdmin() ? allSoils() : enabledSoils();
  const fehlend = gewaehlt.filter(s => !verfuegbar.some(v => v.name === s.name));
  return [...verfuegbar, ...fehlend].map(s => `<label class="soil-chk" title="${esc(s.name)}">
    <input type="checkbox" data-soil="${esc(s.name)}"${checked.has(s.name) ? ' checked' : ''}>
    <span>${esc(s.sym)}</span></label>`).join('');
};

const schichtRowHTML = s => {
  const art = s.art || (s.hart ? 'hart' : 'boden');
  const bodenCur = art === 'boden' ? s.boden : '';
  const bodenHtml = `<input type="hidden" data-s="boden" value="${esc(bodenCur || '')}">
     <div class="soil-checks" role="group" aria-label="Bodenart (mehrere möglich)"${art === 'boden' ? '' : ' hidden'}>${soilChecksHtml(bodenCur)}</div>`;
  return `<div class="schicht">
  <div class="field"><input type="text" inputmode="decimal" data-s="bis" placeholder="bis Tiefe [m]" aria-label="Schicht bis Tiefe in m unter Bohrebene" value="${s.bis != null && !Number.isNaN(s.bis) ? esc(fmtInput(s.bis)) : ''}"></div>
  <div class="soil-cell"><i class="sw" aria-hidden="true"></i>
    ${bodenHtml}
    <input type="text" data-s="hinweis" placeholder="Hinweis (z. B. Holz, Findling)" aria-label="Hinweis zum Hindernis bzw. zur harten Schicht" maxlength="60"${art === 'boden' ? ' hidden' : ''} value="${esc(art === 'boden' ? '' : (s.boden || ''))}">
  </div>
  <select data-s="art" aria-label="Art der Schicht">${SCHICHT_ARTEN.map(a => `<option value="${a.k}"${art === a.k ? ' selected' : ''}>${a.label}</option>`).join('')}</select>
  <button type="button" class="icon-btn danger" data-rm title="Schicht entfernen" aria-label="Schicht entfernen">${ICON.rm}</button>
</div>`;
};

/* Zu Beginn nur eine Zeile je Arbeitsvorgang; bei "growable"-Vorgängen (Bohren, Bohrhindernis,
   harte Bodenschicht) kommt automatisch eine weitere leere Zeile dazu, sobald die letzte
   abgeschlossen ist (von + bis ausgefüllt) — siehe auch maybeGrowZeitGroup. */
function zeitRowsFor(g, entries) {
  const list = (entries && entries.length ? entries : [{}]).map(e => e || {});
  if (!g.growable) return [list[0] || {}];
  const last = list[list.length - 1];
  return (last.von && last.bis) ? [...list, {}] : list;
}

function buildZeitRows(z) {
  $('#zeitRows').innerHTML = ZEIT_GROUPS.map(g =>
    zeitRowsFor(g, z?.[g.k]).map((e, i) => zeitZeileBorist(g, i, e)).join('')
  ).join('');
}

/** Legt bei Bedarf die nächste leere Zeile an, wenn die aktuell letzte Zeile einer growable-Kategorie
    gerade abgeschlossen wurde (von + bis beide ausgefüllt). */
function maybeGrowZeitGroup(row) {
  const g = ZEIT_GROUPS.find(x => x.k === row.dataset.g);
  if (!g || !g.growable) return;
  const rows = $$(`.zeile[data-g="${g.k}"]`, form);
  if (row !== rows[rows.length - 1]) return;
  const e = readZeileZeit(row);
  if (!(e.von && e.bis)) return;
  const i = rows.length;
  row.insertAdjacentHTML('afterend', zeitZeileBorist(g, i, {}));
}

/* Zeit-Zeile mit Start-/Stopp-Button (für Admin und Borist gleich). Datum/Uhrzeit erscheinen erst
   nach dem Start, klein, mit einem Bearbeiten-Button für die manuelle Korrektur (z. B. wenn das
   Tippen vergessen wurde). */
const zeitZustand = e => !e.von ? 'leer' : !e.bis ? 'laeuft' : 'fertig';
const zeitAnzeigeText = e => e.von ? `${e.d ? fmtDateShort(e.d) + ', ' : ''}${e.von}${e.bis ? '–' + e.bis : ' …'} Uhr` : '';
const readZeileZeit = row => ({ d: $('[data-z=d]', row).value, von: $('[data-z=von]', row).value, bis: $('[data-z=bis]', row).value });
function setZeitZustand(row) {
  const e = readZeileZeit(row);
  row.dataset.zstate = zeitZustand(e);
  $('[data-anzeige]', row).textContent = zeitAnzeigeText(e);
}

function zeitZeileBorist(g, i, e) {
  return `<div class="zeile zeile-borist" data-g="${g.k}" data-i="${i}" data-zstate="${zeitZustand(e)}">
    <span class="zl${i ? ' more' : ''}">${esc(g.label)}${i ? ' (weiterer)' : ''}</span>
    <input type="date" data-z="d" aria-label="${esc(g.label)} Datum" value="${esc(e.d || '')}">
    <input type="time" data-z="von" aria-label="${esc(g.label)} von" value="${esc(e.von || '')}">
    <input type="time" data-z="bis" aria-label="${esc(g.label)} bis" value="${esc(e.bis || '')}">
    <span class="zeit-anzeige" data-anzeige>${esc(zeitAnzeigeText(e))}</span>
    <button type="button" class="btn small" data-start>▶ Start</button>
    <button type="button" class="btn small danger" data-stop>■ Stopp</button>
    <button type="button" class="icon-btn" data-edit-zeit title="Zeit bearbeiten" aria-label="${esc(g.label)}: Zeit bearbeiten">${ICON.edit}</button>
  </div>`;
}

/* Der Bodenaufschluss beginnt bei 0,00 (Arbeitsebene) und endet bei der Pfahl-UK: Die letzte Tiefe wird aus der
   Bohrlänge übernommen (Ist, sonst Soll) und folgt Änderungen, solange sie nicht überschrieben wurde. */
let autoEnd = true;
function endRef() {
  const ist = parseNum(form.elements.bohrlaenge.value), sol = parseNum(form.elements.sBohrlaenge.value);
  return isNum(ist) ? { val: ist, src: 'Ist' } : isNum(sol) ? { val: sol, src: 'Soll' } : { val: null, src: '' };
}
function syncEndRow() {
  const rows = $$('.schicht', form);
  const ref = endRef();
  if (rows.length && autoEnd && ref.val != null) $('[data-s=bis]', rows.at(-1)).value = fmtInput(rd(ref.val, 2).toFixed(2));
  // feste Start-/Endzeile und Darstellung der Zeilen
  const hb = hoehenbezug();
  const ae = parseNum(form.elements.arbeitsebene.value), aes = parseNum(form.elements.sArbeitsebene.value);
  const aeV = isNum(ae) ? ae : aes;
  $('#aeLabel').textContent = isNum(aeV) ? `= ${fmtPlain(aeV, 3)} ${hb}` : '';
  const uk = isNum(parseNum(form.elements.bohrlaenge.value)) ? parseNum(form.elements.unterkante.value) : parseNum(form.elements.sUnterkante.value);
  $('#endDepth').textContent = ref.val != null ? `${fmtPlain(rd(ref.val, 2), 2)} m` : '–';
  $('#ukLabel').textContent = ref.val != null ? `Bohrlänge ${ref.src}${isNum(uk) ? ` · ${fmtPlain(uk, 3)} ${hb}` : ''}` : 'Bohrlänge bzw. Höhen (Soll) eintragen';
  rows.forEach((r, i) => {
    const art = $('[data-s=art]', r).value;
    $('[data-s=boden]', r).hidden = art !== 'boden';
    const sc = $('.soil-checks', r);
    if (sc) sc.hidden = art !== 'boden';
    $('[data-s=hinweis]', r).hidden = art === 'boden';
    $('.sw', r).innerHTML = soilSwatch(art, art === 'boden' ? $('[data-s=boden]', r).value : '');
    const bis = $('[data-s=bis]', r);
    bis.classList.toggle('auto', autoEnd && i === rows.length - 1 && ref.val != null);
    bis.title = i === rows.length - 1 ? 'Letzte Tiefe = Pfahl-Unterkante (automatisch, überschreibbar)' : '';
  });
}

function recalc() {
  const v = readNums();
  for (const [k, a] of Object.entries(AUTO)) {
    if (autoOn[k]) {
      const r = a.from(v);
      form.elements[k].value = r == null ? '' : fmtInput(r.toFixed(3));
      v[k] = r;
    }
  }
  $$('[data-auto-hint]').forEach(h => {
    const k = h.dataset.autoHint;
    h.textContent = autoOn[k] ? 'automatisch: ' + AUTO[k].hint : 'manuell – Feld leeren für Automatik';
  });
  syncEndRow();
  const p = readPile();
  $('#pileGraphic').innerHTML = pileGraphicSvg(p);
  const ll = toLatLon(p);
  $('#geoHint').innerHTML = ll ? `${nf5.format(ll[0])}° N<br>${nf5.format(ll[1])}° O` : '–';
  const s = soll(p);
  $('#sollOut').textContent = s == null ? '–' : fmtFlex(s);
  const h = hartSumme(p);
  $('#hartOut').textContent = h == null ? '–' : `${fmtPlain(h, 2)} m`;
  const sp = span(p), dm = dauerMin(p), hm = hindernisMin(p);
  $('#spanOut').textContent = sp.s == null || sp.e == null ? '–' : `${fmtDT(toLocalInput(new Date(sp.s)))} – ${fmtDT(toLocalInput(new Date(sp.e)))}`;
  $('#dauerOut').textContent = dm == null ? '–' : fmtDur(dm);
  $('#hindOut').textContent = hm == null ? '–' : fmtDurPad(hm) + ' h';
  validate(false);
  updateRequired();
}

/** Prüft das Formular. Fehler blockieren das Speichern, Hinweise nicht. */
function validate(strict) {
  const p = readPile();
  const errs = [], warns = [], bad = new Set();

  for (const k of Object.keys(NUM_FIELDS)) {
    if (Number.isNaN(p[k])) { errs.push(`${LABEL[k]}: keine gültige Zahl.`); bad.add(k); }
  }
  if (strict && !p.nr) { errs.push('Die Pfahl-Nr. fehlt.'); bad.add('nr'); }
  if (p.nr && state.piles.some(o => o.id !== editing && String(o.nr).toLowerCase() === p.nr.toLowerCase())) {
    errs.push(`Die Pfahl-Nr. „${p.nr}“ ist bereits vergeben.`); bad.add('nr');
  }
  if (isNum(p.durchmesser) && p.durchmesser <= 0) { errs.push('Der Pfahldurchmesser muss größer als 0 sein.'); bad.add('durchmesser'); }
  if (isNum(p.durchmesser) && p.durchmesser > 300) warns.push('Pfahl-Ø ist größer als 300 cm – bitte Einheit prüfen (Eingabe in cm).');

  // Höhen und Längen: Soll und Ist getrennt prüfen
  for (const [pre, tag] of [['s', 'Soll'], ['', 'Ist']]) {
    const K = n => pre ? 's' + n[0].toUpperCase() + n.slice(1) : n;
    const ok = p[K('oberkante')], uk = p[K('unterkante')], pl = p[K('pfahllaenge')], bl = p[K('bohrlaenge')], lb = p[K('leerbohrung')];
    const okUk = isNum(ok) && isNum(uk) && ok <= uk;
    if (okUk) { errs.push(`Pfahl-OK muss über Pfahl-UK liegen (${tag}).`); bad.add(K('oberkante')); bad.add(K('unterkante')); }
    if (!okUk && isNum(pl) && pl <= 0) { errs.push(`Die Pfahllänge (${tag}) muss größer als 0 sein.`); bad.add(K('pfahllaenge')); }
    if (isNum(bl) && bl <= 0) { errs.push(`Die Bohrlänge (${tag}) muss größer als 0 sein.`); bad.add(K('bohrlaenge')); }
    if (isNum(lb) && lb < 0) warns.push(`Leerbohrung (${tag}) ist negativ – die Pfahl-OK liegt über der Arbeitsebene.`);
    if (isNum(bl) && isNum(pl) && isNum(lb) && Math.abs(bl - (pl + lb)) > 0.0011) warns.push(`Bohrlänge weicht von Pfahllänge + Leerbohrung ab (${tag}).`);
  }
  if (isNum(p.grundwasser) && p.grundwasser < 0) { errs.push('Bohren im GW darf nicht negativ sein.'); bad.add('grundwasser'); }
  if (isNum(p.gwTiefe) && p.gwTiefe < 0) { errs.push('Grundwasser ab: Tiefe darf nicht negativ sein.'); bad.add('gwTiefe'); }

  const hasO = p.ost !== null && !Number.isNaN(p.ost), hasN = p.nord !== null && !Number.isNaN(p.nord);
  if (hasO !== hasN && !Number.isNaN(p.ost) && !Number.isNaN(p.nord)) { errs.push('Rechtswert und Hochwert müssen beide angegeben werden.'); bad.add('ost'); bad.add('nord'); }
  if (isNum(p.ost) && isNum(p.nord) && !toLatLon(p)) {
    warns.push(`Die Koordinaten liegen außerhalb des gültigen Bereichs von ${crsInfo(state.projekt.crs).id} – bitte Koordinatensystem (Projektdaten) und Werte prüfen.`);
  }

  const blAny = isNum(p.bohrlaenge) ? p.bohrlaenge : p.sBohrlaenge;
  if (isNum(p.grundwasser) && isNum(blAny) && p.grundwasser > blAny) warns.push('Bohren im GW ist größer als die Bohrlänge.');

  // Schichten
  let prev = 0;
  p.schichten.forEach((s, i) => {
    if (s.bis === null) errs.push(`Schicht ${i + 1}: Tiefe fehlt.`);
    else if (Number.isNaN(s.bis)) errs.push(`Schicht ${i + 1}: Tiefe ist keine gültige Zahl.`);
    else { if (s.bis <= prev) errs.push(`Schicht ${i + 1}: Tiefe muss größer als ${fmtPlain(prev, 2)} m sein.`); prev = s.bis; }
  });
  const last = layerSpans(p).at(-1);
  if (last && isNum(blAny) && Math.abs(last.bis - blAny) > 0.011) warns.push(`Letzte Schicht endet bei ${fmtPlain(last.bis, 2)} m, die Bohrlänge beträgt ${fmtPlain(blAny, 2)} m.`);

  // Zeiten
  for (const g of ZEIT_GROUPS) {
    p.zeiten[g.k].forEach(e => {
      if ((e.von || e.bis) && !e.d) errs.push(`${g.label}: Datum fehlt.`);
      else if (e.von && e.bis && e.bis < e.von) warns.push(`${g.label}: Ende (${e.bis}) liegt vor Beginn (${e.von}) – wird als nächster Tag gewertet.`);
    });
  }

  $('#formMsgs').innerHTML = errs.map(m => `<div class="e">${esc(m)}</div>`).join('') + warns.map(m => `<div class="w">${esc(m)}</div>`).join('');
  for (const k of [...Object.keys(NUM_FIELDS), 'nr', 'ende']) { const el = form.elements[k]; if (el) el.closest('.field').classList.toggle('invalid', bad.has(k)); }
  if (strict && errs.length) $('#formMsgs').scrollIntoView({ block: 'nearest' });
  return errs.length === 0;
}

function openPile({ id = null, base = null } = {}) {
  editing = id;
  let p = base ? { ...emptyPile(), ...base } : emptyPile();
  if (id) p = state.piles.find(x => x.id === id) || p;
  else if (!base) {
    const last = state.piles.reduce((a, b) => (!a || (b.createdAt || 0) >= (a.createdAt || 0)) ? b : a, null);
    p = { ...p, nr: last ? nextNr(last.nr) : '' };
  }

  form.reset();
  const e = form.elements;
  for (const k of TEXT_FIELDS) e[k].value = p[k] || '';
  for (const k of Object.keys(NUM_FIELDS)) e[k].value = isNum(p[k]) ? fmtInput(p[k]) : '';
  e.pfahlart.value = p.pfahlart || 'bewehrt';
  e.wasserauflast.value = p.wasserauflast ? 'ja' : 'nein';

  const layers = (p.schichten && p.schichten.length) ? p.schichten : [{}];
  $('#schichtRows').innerHTML = layers.map(schichtRowHTML).join('');
  buildZeitRows(p.zeiten);
  // letzte Tiefe folgt der Soll-UK, wenn sie leer ist oder schon damit übereinstimmt
  const lastBis = layers.at(-1).bis;
  const refBL = isNum(p.bohrlaenge) ? p.bohrlaenge : p.sBohrlaenge;
  autoEnd = !isNum(lastBis) || (isNum(refBL) && Math.abs(lastBis - rd(refBL, 2)) < 0.006);

  autoOn = {};
  for (const [k, a] of Object.entries(AUTO)) autoOn[k] = !isNum(p[k]) || p[k] === a.from(p);

  editingGeprueft = p.geprueft || null;
  curFotos = structuredClone(p.fotos || []);
  $('#fotoHint').textContent = 'Die Fotos werden verkleinert gespeichert und erscheinen im PDF auf einer eigenen Seite nach dem Protokoll.';
  fillGeraetSelect(p);
  $('#pileTitle').textContent = id ? `Pfahl ${p.nr || ''} bearbeiten` : 'Neuer Pfahl';
  $$('[data-hb]').forEach(s => { s.textContent = hoehenbezug(); });
  updateCoordLabels();
  recalc();
  applyPileLock(p, !id);
  renderFotos();
  updateRequired();
  updatePruefBox();
  $('#formMsgs').innerHTML = '';
  $$('.field.invalid', form).forEach(f => f.classList.remove('invalid'));
  pileDlg.showModal();
  $('.dlg-body', pileDlg).scrollTop = 0;
  e.nr.focus();
  e.nr.select();
}

/* --- Rollen: was in diesem Pfahl bearbeitbar ist --- */
let editingGeprueft = null;

function applyPileLock(p, isNew) {
  const full = isNew || canFullEdit(p);
  const locked = !isNew && isLocked(p);
  const open = new Set([...BORIST_NUM, 'wasserauflast', 'bemerkung', 'geraet']);
  for (const el of form.elements) if (el.name) el.disabled = locked || (!full && !open.has(el.name));
  $$('#schichtRows input, #schichtRows select, #schichtRows button, #zeitRows input, #zeitRows button, #btnAddSchicht, #btnCopySoll').forEach(el => { el.disabled = locked; });
  $('#btnSave').hidden = locked;
  const note = $('#roleNote');
  note.hidden = !(locked || !full);
  note.textContent = locked
    ? 'Dieser Pfahl wurde vom Administrator geprüft und ist gesperrt.'
    : 'Sie können Ist-Werte, Bodenaufschluss, Grundwasser, Wasserauflast, Abstichmaß, Betonverbrauch IST, Ausführungszeiten, Bemerkung und Fotos ergänzen (gelb markierte Pflichtfelder müssen ausgefüllt sein). Planwerte und Stammdaten sind gesperrt.';
  // Kompaktes Formular für den Admin immer, für den Borist außer bei eigenen/neuen Pfählen
  // (dort sieht auch der Borist weiterhin das vollständige, unkompaktierte Formular).
  pileDlg.classList.toggle('kompakt', isAdmin() || !full);
  fillGrunddaten(p);
}

/** Kurzreferenz oben im kompakten Formular: Nr., Soll-Maße, Betongüte, Verbrauch Soll. */
function fillGrunddaten(p) {
  $('#gdNr').textContent = p.nr || '–';
  $('#gdBohrlaenge').textContent = isNum(p.sBohrlaenge) ? `${nf3.format(p.sBohrlaenge)} m` : '–';
  $('#gdPfahllaenge').textContent = isNum(p.sPfahllaenge) ? `${nf3.format(p.sPfahllaenge)} m` : '–';
  $('#gdNeigung').textContent = isNum(p.neigung) ? `${nf1.format(p.neigung)}°` : '–';
  $('#gdDurchmesser').textContent = isNum(p.durchmesser) ? `${nf1.format(p.durchmesser)} cm` : '–';
  $('#gdBetongute').textContent = p.betongute || '–';
  const s = soll(p);
  $('#gdSoll').textContent = s == null ? '–' : `${fmtFlex(s)} m³`;
}

/* --- Pflichtfelder des Borists ---
   Ohne diese Angaben kann der Borist einen Pfahl nicht speichern; leere Pflichtfelder sind gelb markiert.
   Arbeitsebene/Pfahl-OK/-UK/Bohrlänge/Pfahllänge/Leerbohrung sind für den Borist bei fremden Pfählen
   nicht mehr zugänglich (siehe "i"-Panel-Entfernung in pile-dialog.html) und deshalb nicht mehr Pflicht.
   Nicht verlangt: Grundwasser, Bohren im GW, Abstichmaß, Bohrhindernis/harte Schicht (Zeiten), Bemerkung, Fotos. */
const REQ_NUM = ['verbrauchIst'];
const empty = el => !el.value || !String(el.value).trim();

function requiredEls() {
  const e = form.elements, out = [];
  for (const k of REQ_NUM) out.push({ el: e[k], label: LABEL[k] });
  out.push({ el: e.geraet, label: 'Bohrgerät' });
  $$('#schichtRows .schicht').forEach((r, i) => {
    out.push({ el: $('[data-s=bis]', r), label: `Bodenaufschluss, Schicht ${i + 1}: Tiefe` });
    const b = $('[data-s=boden]', r);
    if (!b.hidden) out.push({ el: b, label: `Bodenaufschluss, Schicht ${i + 1}: Bodenart` });
  });
  for (const g of ZEIT_GROUPS) {
    if (g.k === 'bewehren' && e.pfahlart.value !== 'bewehrt') continue;
    if (!['bohren', 'bewehren', 'betonieren'].includes(g.k)) continue;
    const row = $(`.zeile[data-g=${g.k}][data-i="0"]`, form);
    for (const [f, n] of [['d', 'Datum'], ['von', 'von'], ['bis', 'bis']]) out.push({ el: $(`[data-z=${f}]`, row), label: `${g.label}: ${n}` });
  }
  return out;
}

/** Markiert leere Pflichtfelder (nur Borist) und schaltet „Speichern“ entsprechend; liefert die fehlenden Angaben */
function updateRequired() {
  $$('.need', form).forEach(el => el.classList.remove('need'));
  const note = $('#reqNote'), btn = $('#btnSave');
  if (isAdmin() || btn.hidden) { note.hidden = true; btn.disabled = false; btn.textContent = 'Speichern'; return []; }
  const missing = requiredEls().filter(r => !r.el.disabled && empty(r.el));
  missing.forEach(r => r.el.classList.add('need'));
  note.hidden = false;
  note.classList.toggle('done', !missing.length);
  note.innerHTML = missing.length
    ? `<strong>Pflichtfelder:</strong> Speichern ist erst möglich, wenn alle <strong>gelb markierten Felder</strong> ausgefüllt sind. Noch offen: <strong>${missing.length}</strong>.`
    : '<strong>Alle Pflichtfelder sind ausgefüllt.</strong> Der Pfahl kann gespeichert werden.';
  btn.disabled = missing.length > 0;
  btn.textContent = missing.length ? `Speichern (${missing.length} Pflichtfelder offen)` : 'Speichern';
  return missing;
}

/* --- Fotos zur Bemerkung (verkleinert als JPEG im Pfahl gespeichert) --- */
let curFotos = [];
const FOTO_MAX = 8, FOTO_PX = 1280, DATA_LIMIT = 3400000;   // Browser-Speicher (localStorage) ist auf ca. 5 MB begrenzt

function renderFotos() {
  const locked = $('#btnSave').hidden;
  $('#fotoList').innerHTML = curFotos.map((f, i) => `<div class="foto-item">
    <img src="${f.data}" alt="Foto ${i + 1}"><span>${esc(f.name || 'Foto ' + (i + 1))}</span>
    ${locked ? '' : `<button type="button" class="icon-btn" data-foto-rm="${i}" title="Foto entfernen" aria-label="Foto ${i + 1} entfernen">${ICON.rm}</button>`}</div>`).join('');
  $('#btnAddFoto').disabled = locked || curFotos.length >= FOTO_MAX;
}

async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Bild nicht lesbar')); i.src = url; });
    const k = Math.min(1, FOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { id: uid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60), data: c.toDataURL('image/jpeg', 0.7), w, h };
  } finally { URL.revokeObjectURL(url); }
}

$('#btnAddFoto').addEventListener('click', () => $('#fotoFile').click());
$('#fotoFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  const msgs = [];
  for (const f of files) {
    if (curFotos.length >= FOTO_MAX) { msgs.push(`Höchstens ${FOTO_MAX} Fotos je Pfahl.`); break; }
    if (!/^image\//.test(f.type)) { msgs.push(`„${f.name}“ ist kein Bild.`); continue; }
    try {
      const foto = await shrinkImage(f);
      const used = JSON.stringify(state).length + curFotos.reduce((s, x) => s + x.data.length, 0);
      if (used + foto.data.length > DATA_LIMIT) { msgs.push('Der Speicher des Browsers ist fast voll – dieses Foto wurde nicht hinzugefügt. Bitte Fotos entfernen oder nach dem Export beim Administrator löschen.'); break; }
      curFotos.push(foto);
    } catch (err) { msgs.push(`„${f.name}“: ${err.message}`); }
  }
  renderFotos();
  $('#fotoHint').textContent = msgs.join(' ') || 'Die Fotos werden verkleinert gespeichert und erscheinen im PDF auf einer eigenen Seite nach dem Protokoll.';
});
$('#fotoList').addEventListener('click', e => {
  const b = e.target.closest('[data-foto-rm]');
  if (!b) return;
  curFotos.splice(+b.dataset.fotoRm, 1);
  renderFotos();
});

function updatePruefBox() {
  const g = editingGeprueft;
  $('#pruefBox').hidden = !(isAdmin() || g);
  $('#pruefText').textContent = g ? `Geprüft von ${g.von} am ${fmtDate(String(g.am).slice(0, 10))}` : 'Noch nicht geprüft';
  $('#btnPruef').textContent = g ? 'Prüfung zurücknehmen' : 'Als geprüft markieren';
}

$('#btnPruef').addEventListener('click', () => {
  if (!isAdmin()) return;
  if (editingGeprueft) editingGeprueft = null;
  else {
    if (pileStatus(readPile()) !== 'fertig' && !confirm('Dieser Pfahl ist noch nicht als ausgeführt erfasst (Betonieren mit Ende fehlt).\n\nTrotzdem als geprüft markieren?')) return;
    editingGeprueft = { am: new Date().toISOString(), von: me.name };
  }
  updatePruefBox();
});

form.addEventListener('input', e => {
  if (e.target.name in AUTO) autoOn[e.target.name] = e.target.value.trim() === '';
  if (e.target === $$('.schicht [data-s=bis]', form).at(-1)) autoEnd = e.target.value.trim() === '';
  recalc();
});
/* Borist-Checkboxen (mehrere Bodenarten je Schicht) im gemeinsamen Feld data-s=boden zusammenführen,
   in SOILS-Reihenfolge (die erste zählt in Grafik/Protokoll als Hauptanteil, siehe soilOf). Läuft vor dem
   generischen recalc-Listener, damit der zusammengeführte Wert schon beim Neuzeichnen vorliegt. */
form.addEventListener('change', e => {
  const chk = e.target.closest('[data-soil]');
  if (!chk) return;
  const row = chk.closest('.schicht');
  const checked = new Set($$('.soil-checks input[data-soil]', row).filter(i => i.checked).map(i => i.dataset.soil));
  $('[data-s=boden]', row).value = allSoils().filter(s => checked.has(s.name)).map(s => s.name).join(', ');
});
// Manuelle Eingabe von Datum/Uhrzeit (Admin) kann eine growable-Zeile ebenfalls abschließen
form.addEventListener('change', e => {
  const zeile = e.target.closest('[data-z]')?.closest('.zeile');
  if (zeile) maybeGrowZeitGroup(zeile);
});
form.addEventListener('change', recalc);

form.addEventListener('click', e => {
  if (e.target.closest('#btnCopySoll')) {
    // Planhöhen als Ist-Höhen übernehmen (Längen werden daraus berechnet)
    for (const k of ['arbeitsebene', 'oberkante', 'unterkante']) form.elements[k].value = form.elements['s' + k[0].toUpperCase() + k.slice(1)].value;
    for (const k of ['bohrlaenge', 'pfahllaenge', 'leerbohrung']) autoOn[k] = true;
    return recalc();
  }
  if (e.target.closest('#btnAddSchicht')) {
    // neue Schicht vor die letzte Zeile setzen: die letzte bleibt die Endtiefe (Soll-UK)
    const rows = $$('.schicht', form);
    if (rows.length) rows.at(-1).insertAdjacentHTML('beforebegin', schichtRowHTML({}));
    else $('#schichtRows').insertAdjacentHTML('beforeend', schichtRowHTML({}));
    const now = $$('.schicht', form);
    $('[data-s=bis]', now.length > 1 ? now.at(-2) : now[0]).focus();
    return recalc();
  }
  const infoToggle = e.target.closest('[data-info-toggle]');
  if (infoToggle) {
    $(`[data-info-panel="${infoToggle.dataset.infoToggle}"]`, form)?.classList.add('offen');
    return;
  }
  const infoClose = e.target.closest('[data-info-close]');
  if (infoClose) {
    infoClose.closest('.info-panel').classList.remove('offen');
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const row = rm.closest('.schicht');
    const wasLast = row === $$('.schicht', form).at(-1);
    row.remove();
    if (!$$('.schicht', form).length) $('#schichtRows').innerHTML = schichtRowHTML({});
    if (wasLast) autoEnd = true;
    return recalc();
  }
  const startBtn = e.target.closest('[data-start]');
  if (startBtn) {
    const row = startBtn.closest('.zeile');
    const d = new Date();
    $('[data-z=d]', row).value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    $('[data-z=von]', row).value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    setZeitZustand(row);
    return recalc();
  }
  const stopBtn = e.target.closest('[data-stop]');
  if (stopBtn) {
    const row = stopBtn.closest('.zeile');
    const d = new Date();
    $('[data-z=bis]', row).value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    setZeitZustand(row);
    maybeGrowZeitGroup(row);
    return recalc();
  }
  const editZeitBtn = e.target.closest('[data-edit-zeit]');
  if (editZeitBtn) {
    const row = editZeitBtn.closest('.zeile');
    if (row.dataset.zstate === 'bearbeiten') {
      setZeitZustand(row);
      maybeGrowZeitGroup(row);
      editZeitBtn.innerHTML = ICON.edit;
      editZeitBtn.title = editZeitBtn.ariaLabel = 'Zeit bearbeiten';
    } else {
      row.dataset.zstate = 'bearbeiten';
      editZeitBtn.innerHTML = ICON.check;
      editZeitBtn.title = editZeitBtn.ariaLabel = 'Fertig';
    }
    return;
  }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validate(true)) return;
  if (!isAdmin()) {
    const missing = updateRequired();
    if (missing.length) return toast(`Bitte alle Pflichtfelder ausfüllen (${missing.length} offen).`);
  }
  const p = readPile();
  const stamp = { updatedAt: Date.now(), updatedBy: me.name, updatedRole: me.role };
  if (editing) {
    const i = state.piles.findIndex(x => x.id === editing);
    if (i >= 0) {
      const old = state.piles[i];
      if (isLocked(old)) return toast('Dieser Pfahl ist geprüft und gesperrt.');
      // Rechte auch hier durchsetzen: der Borist übernimmt nur die ihm erlaubten Felder
      const upd = canFullEdit(old) ? p : pickAllowed(p);
      state.piles[i] = { ...old, ...upd, ...stamp, ...(isAdmin() ? { geprueft: editingGeprueft } : {}) };
    }
  } else {
    state.piles.push({ id: uid(), createdAt: Date.now(), quelle: isAdmin() ? 'admin' : 'borist', ...p, ...stamp, ...(isAdmin() && editingGeprueft ? { geprueft: editingGeprueft } : {}) });
  }
  pileDlg.close();
  render();
  await persist();
  toast(`Pfahl „${p.nr}“ gespeichert.`);
});

/* =====================================================================
   Projektdaten
   ===================================================================== */
const projDlg = $('#projDialog');
const projForm = $('#projForm');
let projLogo = null;   // { data, w, h } | null

function showLogoPreview() {
  $('#logoPrev').innerHTML = projLogo ? `<img alt="Logo" src="${projLogo.data}">` : 'kein Logo';
  $('#btnLogoRm').disabled = !projLogo;
}

const gerRowHTML = d => `<div class="ger-row" data-id="${esc(d.id || '')}">
  <input type="text" data-g="typ" maxlength="60" placeholder="Gerätetyp (z. B. Bauer BG 28)" aria-label="Gerätetyp" value="${esc(d.typ || '')}">
  <input type="text" data-g="inv" maxlength="30" placeholder="Inventar-Nr." aria-label="Inventarnummer" value="${esc(d.inv || '')}">
  <input type="text" data-g="kommentar" maxlength="120" placeholder="Kommentar" aria-label="Kommentar" value="${esc(d.kommentar || '')}">
  <button type="button" class="icon-btn danger" data-grm title="Gerät entfernen" aria-label="Gerät entfernen">${ICON.rm}</button>
</div>`;

$('#btnAddGeraet').addEventListener('click', () => {
  $('#gerRows').insertAdjacentHTML('beforeend', gerRowHTML({}));
  $$('#gerRows [data-g=typ]').at(-1).focus();
});
$('#gerRows').addEventListener('click', e => { const b = e.target.closest('[data-grm]'); if (b) b.closest('.ger-row').remove(); });

/** Checkboxen der Standard-Bodenarten (Vorauswahl für den Borist) */
function bodenartRowsHTML(aktiv) {
  const set = Array.isArray(aktiv) ? new Set(aktiv) : null;   // null = alle aktiv (noch nicht eingeschränkt)
  return SOILS.map(s => `<label>
    <input type="checkbox" data-ba="${esc(s.name)}"${!set || set.has(s.name) ? ' checked' : ''}>
    ${esc(soilLabel(s))}
  </label>`).join('');
}
const bodenartCustomRowHTML = c => `<div class="boden-custom-row" data-id="${esc(c.id || '')}">
  <input type="text" data-bc="name" maxlength="60" placeholder="Name (z. B. Bauschutt)" aria-label="Name der Bodenart" value="${esc(c.name || '')}">
  <input type="text" data-bc="sym" maxlength="6" placeholder="Kürzel" aria-label="Kürzel" value="${esc(c.sym || '')}">
  <button type="button" class="icon-btn danger" data-bcrm title="Bodenart entfernen" aria-label="Bodenart entfernen">${ICON.rm}</button>
</div>`;
$('#btnAddBodenart').addEventListener('click', () => {
  $('#bodenartCustomRows').insertAdjacentHTML('beforeend', bodenartCustomRowHTML({}));
  $$('#bodenartCustomRows [data-bc=name]').at(-1).focus();
});
$('#bodenartCustomRows').addEventListener('click', e => { const b = e.target.closest('[data-bcrm]'); if (b) b.closest('.boden-custom-row').remove(); });

function openProjekt() {
  const pr = state.projekt;
  $('#pj_nr').value = pr.nr; $('#pj_name').value = pr.name; $('#pj_ort').value = pr.ort;
  $('#pj_titel').value = pr.titel; $('#pj_norm').value = pr.norm; $('#pj_hb').value = pr.hoehenbezug;
  projLogo = pr.logo ? { data: pr.logo, w: pr.logoW, h: pr.logoH } : null;
  $('#pj_crs').innerHTML = CRS_LIST.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  $('#pj_crs').value = crsInfo(pr.crs).id;
  const ger = (pr.geraete && pr.geraete.length) ? pr.geraete : [{}, {}];      // Vorschlag: zwei leere Zeilen
  $('#gerRows').innerHTML = ger.map(gerRowHTML).join('');
  $('#bodenartRows').innerHTML = bodenartRowsHTML(pr.bodenartenAktiv);
  $('#bodenartCustomRows').innerHTML = (pr.bodenartenCustom || []).map(bodenartCustomRowHTML).join('');
  $('#projMsgs').innerHTML = '';
  showLogoPreview();
  projDlg.showModal();
  $('#pj_name').focus();
}

function loadLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 500 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}

$('#btnLogo').addEventListener('click', () => $('#logoFile').click());
$('#btnLogoRm').addEventListener('click', () => { projLogo = null; showLogoPreview(); });
$('#logoFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { projLogo = await loadLogo(f); showLogoPreview(); $('#projMsgs').innerHTML = ''; }
  catch (err) { $('#projMsgs').innerHTML = `<div class="e">${esc(err.message)}</div>`; }
});

projForm.addEventListener('submit', async e => {
  e.preventDefault();
  const d = defaultProjekt();
  const geraete = $$('#gerRows .ger-row').map(r => ({
    id: r.dataset.id || uid(),
    typ: $('[data-g=typ]', r).value.trim(), inv: $('[data-g=inv]', r).value.trim(), kommentar: $('[data-g=kommentar]', r).value.trim(),
  })).filter(g => g.typ || g.inv);
  const bodenartenAktivGewaehlt = $$('#bodenartRows [data-ba]').filter(i => i.checked).map(i => i.dataset.ba);
  const bodenartenAktiv = bodenartenAktivGewaehlt.length === SOILS.length ? null : bodenartenAktivGewaehlt;
  const bodenartenCustom = $$('#bodenartCustomRows .boden-custom-row').map(r => ({
    id: r.dataset.id || uid(),
    name: $('[data-bc=name]', r).value.trim(), sym: $('[data-bc=sym]', r).value.trim(),
  })).filter(c => c.name);
  state.projekt = {
    geraete, bodenartenAktiv, bodenartenCustom,
    nr: $('#pj_nr').value.trim(), name: $('#pj_name').value.trim(), ort: $('#pj_ort').value.trim(),
    titel: $('#pj_titel').value.trim() || d.titel, norm: $('#pj_norm').value.trim(),
    hoehenbezug: $('#pj_hb').value.trim() || d.hoehenbezug,
    crs: $('#pj_crs').value || d.crs,
    logo: projLogo ? projLogo.data : null, logoW: projLogo ? projLogo.w : 0, logoH: projLogo ? projLogo.h : 0,
  };
  projDlg.close();
  render();
  await persist();
  toast('Projektdaten gespeichert.');
});

/* =====================================================================
   Export: CSV & PDF (Übersichtsliste). Das Bohrprotokoll steht in protokoll.js
   ===================================================================== */
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileBase(prefix = 'Bohrpfaehle') {
  const proj = (state.projekt.name || '').trim().replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${prefix}${proj ? '_' + proj : ''}_${new Date().toISOString().slice(0, 10)}`;
}

function filterText() {
  const parts = [];
  if (ui.q.trim()) parts.push(`Suche „${ui.q.trim()}“`);
  if (ui.typ) parts.push(`Typ „${ui.typ}“`);
  return parts.join(', ');
}

function exportCsv() {
  const list = visiblePiles();
  if (!list.length) return toast('Keine Daten zum Exportieren.');
  const cell = (v, textKind) => {
    let s = String(v ?? '');
    if (textKind && /^[=+\-@\t\r]/.test(s)) s = "'" + s;      // Schutz vor Formel-Injektion in Excel
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const digits = { cm: 1, h: 3, m: 2 };
  const csvVal = (p, c) => {
    const v = getVal(p, c.k);
    if (v == null || v === '') return '';
    if (c.kind === 'cm') return fmtFlex(v);
    if (c.kind === 'coord') return fmtPlain(v, coordLabels().dec);
    if (c.kind === 'm1') return fmtFlex(v);
    if (c.kind === 'h' || c.kind === 'm') return fmtPlain(v, digits[c.kind]);
    return cellText(p, c).replace(/ h$/, '');
  };
  const lines = [COLS.map(c => { const u = unitOf(c); return cell(c.label + (u ? ` [${u}]` : '')); }).join(';')];
  for (const p of list) lines.push(COLS.map(c => cell(csvVal(p, c), c.kind === 'text')).join(';'));
  download('﻿' + lines.join('\r\n') + '\r\n', fileBase() + '.csv', 'text/csv;charset=utf-8');
  toast(`CSV exportiert: ${plural(list.length)}.`);
}

function exportPdf() {
  const list = visiblePiles();
  if (!list.length) return toast('Keine Daten zum Exportieren.');
  if (!window.jspdf) return toast('PDF-Bibliothek nicht geladen.');
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const stand = `${fmtDT(toLocalInput(new Date()))} Uhr`;
  const filt = filterText();
  const pr = state.projekt;

  const head = [TCOLS.map(c => { const u = unitOf(c); return c.label + (u ? `\n[${u}]` : ''); })];
  const body = list.map(p => TCOLS.map(c => cellText(p, c) || '-'));
  const t = totals(list);
  const foot = [TCOLS.map((c, i) => i === 0 ? 'Summe' : (c.sum ? totalText(c, t[c.k]) : ''))];

  const columnStyles = {};
  TCOLS.forEach((c, i) => {
    const s = {};
    if (colClass(c) === 'num') s.halign = 'right';
    if (c.kind === 'bool') s.halign = 'center';
    if (c.k === 'nr') s.fontStyle = 'bold';
    columnStyles[i] = s;
  });

  doc.autoTable({
    head, body, foot,
    startY: 30,
    margin: { top: 30, left: 10, right: 10, bottom: 14 },
    theme: 'grid',
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.4, lineColor: [204, 209, 216], lineWidth: 0.1, textColor: [27, 36, 48], valign: 'middle' },
    headStyles: { fillColor: [52, 64, 80], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [232, 235, 239], textColor: [27, 36, 48], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles,
    didDrawPage: () => {
      doc.setTextColor(27, 36, 48);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text('Bohrpfähle – Übersicht', 10, 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const sub = [pr.nr && `Baustelle Nr. ${pr.nr}`, pr.name, pr.ort].filter(Boolean).join(' · ');
      if (sub) doc.text(sub, 10, 19);
      doc.text(`${plural(list.length)}${filt ? ' · Filter: ' + filt : ''}`, 10, 24.5);
      doc.text(`Stand: ${stand}`, W - 10, 13, { align: 'right' });
    },
  });

  const n = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 120, 132);
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.text('Bohrpfahl-Verwaltung', 10, H - 6);
    doc.text(`Seite ${i} von ${n}`, W - 10, H - 6, { align: 'right' });
  }
  doc.save(fileBase('Uebersicht') + '.pdf');
  toast(`PDF erstellt: ${plural(list.length)}.`);
}

$('#btnCsv').addEventListener('click', exportCsv);

/* =====================================================================
   Sicherung (verschlüsselt, nur mit Passwort lesbar)
   ===================================================================== */
async function exportBackup() {
  await persist();
  const payload = { app: APP_ID, version: 1, created: new Date().toISOString(), meta, data: readJSON(LS_DATA) };
  download(JSON.stringify(payload), `Bohrpfahl-Sicherung_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  toast('Sicherung gespeichert. Sie ist nur mit dem Passwort lesbar.');
}

async function restoreFromFile(file) {
  let o;
  try { o = JSON.parse(await file.text()); } catch { return toast('Die Datei ist keine gültige Sicherung.'); }
  const iterOk = n => Number.isInteger(n) && n >= 100000 && n <= 5000000;
  const b64 = s => typeof s === 'string' && s.length > 0 && s.length < 1e6;
  const okV1 = o && o.meta && typeof o.meta.user === 'string' && b64(o.meta.salt) && iterOk(o.meta.iter);
  const okV2 = o && o.meta && Array.isArray(o.meta.users) && o.meta.users.length > 0 && o.meta.users.every(u =>
    u && typeof u.id === 'string' && typeof u.name === 'string' && (u.role === 'admin' || u.role === 'borist') &&
    b64(u.salt) && iterOk(u.iter) && u.wk && b64(u.wk.iv) && b64(u.wk.ct));
  const okData = o && o.data && typeof o.data.iv === 'string' && typeof o.data.ct === 'string';
  if (!o || o.app !== APP_ID || !(okV1 || okV2) || !okData) return toast('Die Datei ist keine gültige Sicherung.');
  if (!isAdmin() && key) return toast('Nur der Administrator kann eine Sicherung laden.');
  if (localStorage.getItem(LS_DATA) &&
    !confirm('Die Sicherung ersetzt alle aktuellen Daten und die Zugangsdaten auf diesem Gerät.\n\nFortfahren?')) return;
  localStorage.setItem(LS_META, JSON.stringify(okV2
    ? { v: 2, users: o.meta.users.map(u => ({ id: u.id, name: u.name, role: u.role, salt: u.salt, iter: u.iter, wk: { iv: u.wk.iv, ct: u.wk.ct } })) }
    : { v: 1, user: o.meta.user, salt: o.meta.salt, iter: o.meta.iter }));
  localStorage.setItem(LS_DATA, JSON.stringify({ iv: o.data.iv, ct: o.data.ct }));
  lock();
  toast('Sicherung geladen – bitte mit den Zugangsdaten der Sicherung anmelden.');
}

const restoreInput = $('#restoreFile');
restoreInput.addEventListener('change', () => {
  const f = restoreInput.files[0];
  restoreInput.value = '';
  if (f) restoreFromFile(f);
});
$('#lockRestore').addEventListener('click', () => restoreInput.click());

/* =====================================================================
   Zugangsdaten ändern
   ===================================================================== */
const pwDlg = $('#pwDialog');
const pwForm = $('#pwForm');

function pwMsgs(list) { $('#pwMsgs').innerHTML = list.map(m => `<div class="e">${esc(m)}</div>`).join(''); }

function openPassword() {
  if (!isAdmin()) return;   // Passwörter vergibt und ändert nur der Administrator (Benutzerverwaltung)
  pwForm.reset();
  $('#p_user').value = me.name;
  pwMsgs([]);
  pwDlg.showModal();
  $('#p_old').focus();
}

pwForm.addEventListener('submit', async e => {
  e.preventDefault();
  const user = $('#p_user').value.trim();
  const oldPw = $('#p_old').value, newPw = $('#p_new').value, newPw2 = $('#p_new2').value;
  const errs = [];
  if (!user) errs.push('Bitte einen Benutzernamen eingeben.');
  if (userList().some(u => u.id !== me.id && u.name.toLowerCase() === user.toLowerCase())) errs.push('Dieser Benutzername ist bereits vergeben.');
  if (newPw && newPw.length < 8) errs.push('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
  if (newPw !== newPw2) errs.push('Die neuen Passwörter stimmen nicht überein.');
  if (errs.length) return pwMsgs(errs);

  const rec = userList().find(u => u.id === me.id);
  try {
    const oldKey = await deriveKey(oldPw, fromB64(rec.salt), rec.iter);
    await unwrapMaster(oldKey, rec.wk);
  } catch { return pwMsgs(['Das aktuelle Passwort ist falsch.']); }

  try {
    rec.name = user;
    if (newPw) Object.assign(rec, await newUserRecord(user, rec.role, newPw, key), { id: rec.id });   // neues Salz + neue Hülle
    saveMeta();
    me = { id: rec.id, name: rec.name, role: rec.role };
    applyRole();
    pwDlg.close();
    toast('Zugangsdaten gespeichert.');
  } catch (err) {
    pwMsgs(['Speichern fehlgeschlagen: ' + err.message]);
  }
});

/* =====================================================================
   Benutzerverwaltung (nur Administrator)
   ===================================================================== */
const usersDlg = $('#usersDialog');
const usersMsg = (list, ok = false) => { $('#usersMsgs').innerHTML = list.map(m => `<div class="${ok ? 'w' : 'e'}">${esc(m)}</div>`).join(''); };

function renderUsers() {
  const list = userList();
  $('#usersBody').innerHTML = list.map(u => `<tr data-uid="${esc(u.id)}">
    <td><strong>${esc(u.name)}</strong>${u.id === me.id ? ' <span class="sub">(Sie)</span>' : ''}</td>
    <td>${u.id === me.id ? esc(ROLES[u.role]) : `<select data-urole aria-label="Rolle von ${esc(u.name)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${u.role === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`}</td>
    <td style="text-align:right">${u.id === me.id ? '' : '<button type="button" class="btn small danger" data-udel>Löschen</button>'}</td></tr>`).join('');
  $('#u_pick').innerHTML = list.map(u => `<option value="${esc(u.id)}">${esc(u.name)} (${ROLES[u.role]})</option>`).join('');
}

function openUsers() {
  if (!isAdmin()) return;
  usersMsg([]);
  $('#u_name').value = ''; $('#u_pass').value = ''; $('#u_newpass').value = '';
  renderUsers();
  usersDlg.showModal();
}

$('#btnUserAdd').addEventListener('click', async () => {
  const name = $('#u_name').value.trim(), pass = $('#u_pass').value, role = $('#u_role').value;
  if (!isAdmin()) return;
  if (!name) return usersMsg(['Bitte einen Benutzernamen eingeben.']);
  if (findUser(name)) return usersMsg(['Dieser Benutzername ist bereits vergeben.']);
  if (pass.length < 8) return usersMsg(['Das Passwort muss mindestens 8 Zeichen lang sein.']);
  try {
    meta.users.push(await newUserRecord(name, role, pass, key));
    saveMeta();
    $('#u_name').value = ''; $('#u_pass').value = '';
    renderUsers();
    usersMsg([`Benutzer „${name}“ (${ROLES[role]}) angelegt. Teilen Sie ihm das Passwort persönlich mit.`], true);
  } catch (err) { usersMsg(['Anlegen fehlgeschlagen: ' + err.message]); }
});

$('#btnUserPass').addEventListener('click', async () => {
  const id = $('#u_pick').value, pass = $('#u_newpass').value;
  const rec = userList().find(u => u.id === id);
  if (!isAdmin() || !rec) return;
  if (pass.length < 8) return usersMsg(['Das Passwort muss mindestens 8 Zeichen lang sein.']);
  try {
    Object.assign(rec, await newUserRecord(rec.name, rec.role, pass, key), { id: rec.id });
    saveMeta();
    $('#u_newpass').value = '';
    usersMsg([`Passwort für „${rec.name}“ gesetzt.`], true);
  } catch (err) { usersMsg(['Fehlgeschlagen: ' + err.message]); }
});

$('#usersBody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-uid]');
  if (!tr || !e.target.closest('[data-udel]') || !isAdmin()) return;
  const rec = userList().find(u => u.id === tr.dataset.uid);
  if (!rec || rec.id === me.id) return;
  if (!confirm(`Benutzer „${rec.name}“ wirklich löschen?`)) return;
  meta.users = meta.users.filter(u => u.id !== rec.id);
  saveMeta(); renderUsers(); usersMsg([`Benutzer „${rec.name}“ gelöscht.`], true);
});
$('#usersBody').addEventListener('change', e => {
  const sel = e.target.closest('[data-urole]');
  const tr = e.target.closest('tr[data-uid]');
  if (!sel || !tr || !isAdmin()) return;
  const rec = userList().find(u => u.id === tr.dataset.uid);
  if (!rec || rec.id === me.id) return;
  rec.role = sel.value; saveMeta(); renderUsers();
  usersMsg([`Rolle von „${rec.name}“: ${ROLES[rec.role]}.`], true);
});
$('#usersForm').addEventListener('submit', e => e.preventDefault());

/* =====================================================================
   Prüfen (nur Administrator): geprüfte Pfähle werden auf der Karte anders gefärbt
   ===================================================================== */
async function setGeprueft(ids, on) {
  if (!isAdmin()) return 0;
  let n = 0;
  for (const id of ids) {
    const p = state.piles.find(x => x.id === id);
    if (!p || !!p.geprueft === on) continue;
    p.geprueft = on ? { am: new Date().toISOString(), von: me.name } : null;
    p.updatedAt = Date.now(); p.updatedBy = me.name; p.updatedRole = me.role;
    n++;
  }
  if (n) { render(); await persist(); }
  return n;
}

async function togglePruefung(p) {
  if (!isAdmin()) return;
  const on = !p.geprueft;
  if (on && pileStatus(p) !== 'fertig' && !confirm(`Pfahl „${p.nr}“ ist noch nicht als ausgeführt erfasst (Betonieren mit Ende fehlt).\n\nTrotzdem als geprüft markieren?`)) return;
  await setGeprueft([p.id], on);
  toast(on ? `Pfahl „${p.nr}“ als geprüft markiert.` : `Prüfung von „${p.nr}“ zurückgenommen.`);
}

/* =====================================================================
   Rückmeldung: Borist → Administrator (wenn beide auf verschiedenen Geräten arbeiten)
   Enthält nur die vom Borist geänderten Pfähle und ist mit dem Datenschlüssel verschlüsselt.
   ===================================================================== */
async function exportRueckmeldung() {
  const mine = state.piles.filter(p => p.updatedRole === 'borist');
  if (!mine.length) return toast('Es gibt noch keine geänderten Pfähle zum Melden.');
  const items = mine.map(p => ({
    id: p.id, nr: p.nr, updatedAt: p.updatedAt, updatedBy: p.updatedBy,
    fields: p.quelle === 'borist' ? structuredClone(p) : pickAllowed(p),   // eigene Pfähle vollständig, sonst nur erlaubte Felder
    neu: p.quelle === 'borist',
  }));
  const payload = { app: APP_ID, type: 'rueckmeldung', version: 1, created: new Date().toISOString(), by: me.name, data: await seal(key, { items }) };
  download(JSON.stringify(payload), `Rueckmeldung_${me.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  toast(`Rückmeldung mit ${plural(items.length)} gespeichert.`);
}

async function importRueckmeldung(file) {
  if (!isAdmin()) return;
  let o;
  try { o = JSON.parse(await file.text()); } catch { return toast('Die Datei ist keine gültige Rückmeldung.'); }
  if (!o || o.app !== APP_ID || o.type !== 'rueckmeldung' || !o.data || typeof o.data.iv !== 'string') return toast('Die Datei ist keine gültige Rückmeldung.');
  let items;
  try { items = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(o.data.iv) }, key, fromB64(o.data.ct)))).items; }
  catch { return toast('Die Rückmeldung passt nicht zu diesen Daten (anderer Datenschlüssel).'); }
  if (!Array.isArray(items)) return toast('Die Rückmeldung ist leer.');
  const res = { neu: 0, upd: 0, geprueft: 0, aelter: 0, unbekannt: 0 };
  for (const it of items) {
    const p = state.piles.find(x => x.id === it.id) || state.piles.find(x => String(x.nr).toLowerCase() === String(it.nr).toLowerCase());
    if (!p) {
      if (it.neu && it.fields) { state.piles.push({ ...emptyPile(), ...it.fields, id: it.id, quelle: 'borist' }); res.neu++; } else res.unbekannt++;
      continue;
    }
    if (p.geprueft) { res.geprueft++; continue; }
    if ((p.updatedAt || 0) >= (it.updatedAt || 0)) { res.aelter++; continue; }
    Object.assign(p, p.quelle === 'borist' && it.neu ? it.fields : pickAllowed(it.fields), { updatedAt: it.updatedAt, updatedBy: it.updatedBy, updatedRole: 'borist' });
    res.upd++;
  }
  render();
  await persist();
  toast([`${res.upd} aktualisiert`, res.neu && `${res.neu} neu`, res.geprueft && `${res.geprueft} übersprungen (bereits geprüft)`, res.aelter && `${res.aelter} übersprungen (Ihre Daten sind neuer)`, res.unbekannt && `${res.unbekannt} unbekannt`].filter(Boolean).join(', ') + '.');
}
const rueckInput = document.createElement('input');
rueckInput.type = 'file'; rueckInput.accept = '.json,application/json'; rueckInput.hidden = true;
document.body.appendChild(rueckInput);
rueckInput.addEventListener('change', () => { const f = rueckInput.files[0]; rueckInput.value = ''; if (f) importRueckmeldung(f); });

/* =====================================================================
   Start
   ===================================================================== */
(async function init() {
  meta = readJSON(LS_META);
  const sk = sessionStorage.getItem(SS_KEY);
  if (meta && meta.users && sk && readJSON(LS_DATA) && window.crypto && crypto.subtle) {
    try {
      const s = JSON.parse(sk);
      const u = userList().find(x => x.id === s.u);
      if (!u) throw new Error('unbekannter Benutzer');
      key = await crypto.subtle.importKey('raw', fromB64(s.k), 'AES-GCM', true, ['encrypt', 'decrypt']);
      state = await unseal(key, readJSON(LS_DATA));
      me = { id: u.id, name: u.name, role: u.role };
      return showApp();
    } catch { key = null; me = null; sessionStorage.removeItem(SS_KEY); }
  }
  showLock();
})();
