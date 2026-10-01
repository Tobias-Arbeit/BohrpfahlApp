'use strict';

/* =====================================================================
   Auswertung: Stückzahl, Bohr-/Pfahllänge, Beton, Bohrzeit je Tag / Woche / Monat und je Bohrgerät
   Zugeordnet wird ein Pfahl über sein Datum: Bohrdatum (erste Bohren-Zeile) oder Betondatum (Betonieren).
   Längen sind Ist-Werte; fehlt der Ist-Wert, wird der Soll-Wert genommen (im Hinweis gezählt).
   ===================================================================== */

const STAT = { group: 'week', basis: 'bohren', metric: 'bohr', from: '', to: '', geraet: '' };

const STAT_COLS = [
  { k: 'stueck',    label: 'Pfähle',            unit: 'Stück' },
  { k: 'fertig',    label: 'davon ausgeführt',  unit: 'Stück' },
  { k: 'bohr',      label: 'Bohrlänge',         unit: 'm' },
  { k: 'pfahl',     label: 'Pfahllänge',        unit: 'm' },
  { k: 'leer',      label: 'Leerbohrung',       unit: 'm' },
  { k: 'gw',        label: 'Bohren im GW',      unit: 'm' },
  { k: 'beton',     label: 'Beton IST',         unit: 'm³' },
  { k: 'sollbeton', label: 'Beton SOLL',        unit: 'm³' },
  { k: 'zeit',      label: 'Bohrzeit',          unit: 'h:mm' },
];
const statFmt = (k, v) => k === 'stueck' || k === 'fertig' ? nf0.format(v) : k === 'zeit' ? fmtDur(Math.round(v)) : nf2.format(rd(v, 2));
const statCsv = (k, v) => k === 'stueck' || k === 'fertig' ? String(v) : k === 'zeit' ? fmtDur(Math.round(v)).replace(/ h$/, '') : fmtPlain(rd(v, 2), 2);

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Datum (JJJJ-MM-TT) eines Pfahls für die gewählte Zuordnung; null, wenn keines erfasst ist */
function statDate(p) {
  const own = ((p.zeiten && p.zeiten[STAT.basis]) || []).map(e => e.d).filter(Boolean).sort();
  if (own.length) return own[0];
  if (STAT.basis === 'betonieren') return null;                        // noch nicht betoniert → nicht in der Auswertung
  return allEntries(p).map(e => e.d).filter(Boolean).sort()[0] || null; // sonst frühestes erfasstes Datum
}

/** Montag–Sonntag-Kalenderwoche zu einem Datum (JJJJ-MM-TT); der Donnerstag bestimmt die ISO-Jahreswoche. */
function isoWeekInfo(d) {
  const dt = new Date(d + 'T12:00:00'), day = (dt.getDay() + 6) % 7;     // Montag = 0
  const thu = new Date(dt); thu.setDate(dt.getDate() - day + 3);          // Donnerstag der Woche bestimmt die Kalenderwoche
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  const mon = new Date(dt); mon.setDate(dt.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = x => `${pad2(x.getDate())}.${pad2(x.getMonth() + 1)}.`;
  return { key: `${thu.getFullYear()}-W${pad2(week)}`, week, year: thu.getFullYear(), mon, range: `${f(mon)}–${f(sun)}` };
}

/** Periode zu einem Datum: { key, label, sub } */
function statPeriod(d) {
  if (STAT.group === 'day') return { key: d, label: fmtDate(d), sub: '' };
  if (STAT.group === 'month') return { key: d.slice(0, 7), label: `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`, sub: '' };
  const w = isoWeekInfo(d);
  return { key: w.key, label: `KW ${w.week}/${w.year}`, sub: w.range };
}

const emptyAgg = () => ({ stueck: 0, fertig: 0, bohr: 0, pfahl: 0, leer: 0, gw: 0, beton: 0, sollbeton: 0, zeit: 0 });

/** Werte eines Pfahls; sollUsed zählt, wie oft ein Soll-Wert einspringen musste */
function statValues(p, note) {
  const pick = (ist, soll) => { if (isNum(ist)) return ist; if (isNum(soll)) { note.soll++; return soll; } return 0; };
  const zeit = ((p.zeiten && p.zeiten.bohren) || []).map(entryMin).filter(v => v != null).reduce((a, b) => a + b, 0);
  const s = pileStatus(p);
  return {
    stueck: 1, fertig: s === 'fertig' || s === 'geprueft' ? 1 : 0,
    bohr: pick(p.bohrlaenge, p.sBohrlaenge), pfahl: pick(p.pfahllaenge, p.sPfahllaenge), leer: pick(p.leerbohrung, p.sLeerbohrung),
    gw: isNum(p.grundwasser) ? p.grundwasser : 0,
    beton: isNum(p.verbrauchIst) ? p.verbrauchIst : 0, sollbeton: soll(p) || 0, zeit,
  };
}

function statCompute() {
  const note = { soll: 0, ohneDatum: 0, ohneBeton: 0 };
  const inRange = [];
  for (const p of state.piles) {
    const d = statDate(p);
    if (!d) { if (allEntries(p).every(e => !e.d)) note.ohneDatum++; continue; }
    if (STAT.from && d < STAT.from) continue;
    if (STAT.to && d > STAT.to) continue;
    inRange.push({ p, d });
  }
  const chosen = inRange.filter(({ p }) => !STAT.geraet || (STAT.geraet === '-' ? !p.geraet : p.geraet === STAT.geraet));
  const periods = new Map(), total = emptyAgg();
  for (const { p, d } of chosen) {
    const per = statPeriod(d);
    const row = periods.get(per.key) || { ...per, ...emptyAgg() };
    const v = statValues(p, note);
    for (const k of Object.keys(emptyAgg())) { row[k] += v[k]; total[k] += v[k]; }
    if (p.zeiten && (p.zeiten.betonieren || []).some(e => e.d) && !isNum(p.verbrauchIst)) note.ohneBeton++;
    periods.set(per.key, row);
  }
  // Aufteilung nach Bohrgerät (unabhängig vom Gerätefilter, aber im gewählten Zeitraum)
  const dev = new Map();
  for (const { p } of inRange) {
    const id = p.geraet || '-';
    const row = dev.get(id) || { label: id === '-' ? 'ohne Gerät' : (geraetText(id, p.geraetInfo) || 'Gerät'), ...emptyAgg() };
    const v = statValues(p, { soll: 0 });
    for (const k of Object.keys(emptyAgg())) row[k] += v[k];
    dev.set(id, row);
  }
  return { rows: [...periods.values()].sort((a, b) => a.key.localeCompare(b.key)), total, dev: [...dev.values()], note, count: chosen.length };
}

function statChartSvg(rows, metric) {
  const col = STAT_COLS.find(c => c.k === metric);
  const val = r => metric === 'zeit' ? r.zeit / 60 : r[metric];
  const max = Math.max(...rows.map(val), 0);
  if (!rows.length || max <= 0) return '<div class="pg-empty">Keine Werte für dieses Diagramm im gewählten Zeitraum.</div>';
  const step = (() => { const raw = max / 4, p10 = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(m => m * p10).find(s => s >= raw); })();
  const top = Math.ceil(max / step) * step;
  const bw = 34, gap = 14, L = 52, T = 24, B = 46, H = 250;
  const W = Math.max(560, L + rows.length * (bw + gap) + 20);
  const ph = H - T - B, Yv = v => T + ph - v / top * ph;
  const fmt = v => metric === 'zeit' ? fmtDur(Math.round(v * 60)).replace(' h', '') : (metric === 'stueck' || metric === 'fertig') ? nf0.format(v) : nf1.format(v);
  const o = [`<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Diagramm ${esc(col.label)} je Zeitraum">`];
  for (let v = 0; v <= top + 1e-9; v += step) {
    o.push(`<line x1="${L}" x2="${W - 10}" y1="${Yv(v)}" y2="${Yv(v)}" class="grid"/><text x="${L - 6}" y="${Yv(v) + 3.5}" text-anchor="end" class="ax">${esc(fmt(v))}</text>`);
  }
  o.push(`<text x="${L - 6}" y="12" text-anchor="end" class="ax unit">${esc(col.unit)}</text>`);
  rows.forEach((r, i) => {
    const x = L + gap / 2 + i * (bw + gap), y = Yv(val(r)), h = T + ph - y;
    o.push(`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 0)}" rx="3" class="bar"><title>${esc(r.label)}: ${esc(statFmt(metric, r[metric]))} ${esc(col.unit)}</title></rect>`);
    o.push(`<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="val">${esc(fmt(val(r)))}</text>`);
    o.push(`<text x="${x + bw / 2}" y="${H - B + 15}" text-anchor="middle" class="ax">${esc(STAT.group === 'week' ? 'KW ' + r.label.slice(3).split('/')[0] : STAT.group === 'month' ? r.label.slice(0, 3) + ' ' + r.label.slice(-2) : r.label.slice(0, 5))}</text>`);
    if (r.sub) o.push(`<text x="${x + bw / 2}" y="${H - B + 28}" text-anchor="middle" class="ax sub">${esc(r.sub.slice(0, 6))}</text>`);
  });
  o.push('</svg>');
  return o.join('');
}

function renderStats() {
  // Auswahl Bohrgerät
  const sel = $('#stGeraet');
  const cur = STAT.geraet;
  sel.innerHTML = '<option value="">Alle Geräte</option>' + (state.projekt.geraete || []).map(g => `<option value="${esc(g.id)}">${esc(geraetText(g.id))}</option>`).join('') + '<option value="-">ohne Gerät</option>';
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  STAT.geraet = sel.value;
  $('#stGroup').value = STAT.group; $('#stBasis').value = STAT.basis; $('#stFrom').value = STAT.from; $('#stTo').value = STAT.to;
  $('#stMetric').innerHTML = STAT_COLS.map(c => `<option value="${c.k}">${esc(c.label)} [${esc(c.unit)}]</option>`).join('');
  $('#stMetric').value = STAT.metric;

  const r = statCompute();
  const card = (label, value, sub = '') => `<div class="stat-card"><div class="stat-l">${esc(label)}</div><div class="stat-v">${esc(value)}</div>${sub ? `<div class="stat-s">${esc(sub)}</div>` : ''}</div>`;
  const t = r.total;
  $('#stCards').innerHTML =
    card('Pfähle', nf0.format(t.stueck), `davon ausgeführt ${nf0.format(t.fertig)}`) +
    card('Bohrlänge', `${nf2.format(rd(t.bohr, 2))} m`, `Pfahllänge ${nf2.format(rd(t.pfahl, 2))} m`) +
    card('Beton IST', `${nf2.format(rd(t.beton, 2))} m³`, `SOLL ${nf2.format(rd(t.sollbeton, 2))} m³`) +
    card('Bohrzeit', fmtDur(Math.round(t.zeit)), t.stueck ? `Ø ${fmtDur(Math.round(t.zeit / t.stueck))} je Pfahl` : '');

  $('#stChart').innerHTML = statChartSvg(r.rows, STAT.metric);

  const head = `<thead><tr><th>${STAT.group === 'day' ? 'Tag' : STAT.group === 'week' ? 'Woche' : 'Monat'}</th>${STAT_COLS.map(c => `<th class="num">${esc(c.label)}<span class="u">[${esc(c.unit)}]</span></th>`).join('')}</tr></thead>`;
  const body = r.rows.map(x => `<tr><td>${esc(x.label)}${x.sub ? ` <span class="sub">${esc(x.sub)}</span>` : ''}</td>${STAT_COLS.map(c => `<td class="num">${esc(statFmt(c.k, x[c.k]))}</td>`).join('')}</tr>`).join('');
  const foot = `<tfoot><tr><td>Summe</td>${STAT_COLS.map(c => `<td class="num">${esc(statFmt(c.k, t[c.k]))}</td>`).join('')}</tr></tfoot>`;
  $('#stTable').innerHTML = r.rows.length ? `<table>${head}<tbody>${body}</tbody>${foot}</table>` : '<div class="placeholder"><h2>Keine Daten</h2><p>Im gewählten Zeitraum sind keine Pfähle mit Datum erfasst.</p></div>';

  const dcols = ['stueck', 'bohr', 'pfahl', 'beton', 'zeit'].map(k => STAT_COLS.find(c => c.k === k));
  $('#stDevices').innerHTML = r.dev.length
    ? `<table><thead><tr><th>Bohrgerät</th>${dcols.map(c => `<th class="num">${esc(c.label)}<span class="u">[${esc(c.unit)}]</span></th>`).join('')}</tr></thead><tbody>` +
      r.dev.map(x => `<tr><td>${esc(x.label)}</td>${dcols.map(c => `<td class="num">${esc(statFmt(c.k, x[c.k]))}</td>`).join('')}</tr>`).join('') + '</tbody></table>'
    : '';

  const notes = [];
  if (r.note.soll) notes.push(`Bei ${nf0.format(r.note.soll)} Längenangaben fehlte der Ist-Wert, dort wurde der Soll-Wert verwendet.`);
  if (r.note.ohneBeton) notes.push(`${plural(r.note.ohneBeton)} sind betoniert, aber ohne „Verbrauch IST“ (zählen mit 0 m³).`);
  if (r.note.ohneDatum) notes.push(`${plural(r.note.ohneDatum)} ohne Ausführungszeiten (noch offen) sind nicht enthalten.`);
  $('#stNote').textContent = notes.join(' ');
  renderTitle(0);
}

$('#stGroup').addEventListener('change', e => { STAT.group = e.target.value; renderStats(); });
$('#stBasis').addEventListener('change', e => { STAT.basis = e.target.value; renderStats(); });
$('#stFrom').addEventListener('change', e => { STAT.from = e.target.value; renderStats(); });
$('#stTo').addEventListener('change', e => { STAT.to = e.target.value; renderStats(); });
$('#stGeraet').addEventListener('change', e => { STAT.geraet = e.target.value; renderStats(); });
$('#stMetric').addEventListener('change', e => { STAT.metric = e.target.value; renderStats(); });

$('#btnStatsCsv').addEventListener('click', () => {
  const r = statCompute();
  if (!r.rows.length) return toast('Keine Daten zum Exportieren.');
  const q = s => /[;"\r\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
  const lines = [[STAT.group === 'day' ? 'Tag' : STAT.group === 'week' ? 'Woche' : 'Monat', 'Zeitraum', ...STAT_COLS.map(c => `${c.label} [${c.unit}]`)].map(q).join(';')];
  for (const x of r.rows) lines.push([x.label, x.sub, ...STAT_COLS.map(c => statCsv(c.k, x[c.k]))].map(q).join(';'));
  lines.push(['Summe', '', ...STAT_COLS.map(c => statCsv(c.k, r.total[c.k]))].map(q).join(';'));
  download('﻿' + lines.join('\r\n') + '\r\n', fileBase('Auswertung') + '.csv', 'text/csv;charset=utf-8');
  toast('Auswertung als CSV exportiert.');
});

/* =====================================================================
   Dashboard: Wochenleistung (gebohrte Pfähle je Kalenderwoche, letzte 8 Wochen)
   Unabhängig von den Filtern der Auswertung: immer Bohrdatum, immer die letzten 8 Wochen.
   ===================================================================== */
function dashWeekData() {
  const byWeek = new Map();
  for (const p of state.piles) {
    const d = ((p.zeiten && p.zeiten.bohren) || []).map(e => e.d).filter(Boolean).sort()[0];
    if (!d) continue;
    const w = isoWeekInfo(d);
    const row = byWeek.get(w.key) || { ...w, stueck: 0, bohr: 0 };
    row.stueck++;
    row.bohr += isNum(p.bohrlaenge) ? p.bohrlaenge : (isNum(p.sBohrlaenge) ? p.sBohrlaenge : 0);
    byWeek.set(w.key, row);
  }
  const now = isoWeekInfo(toLocalInput(new Date()).slice(0, 10));
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const dt = new Date(now.mon); dt.setDate(dt.getDate() - i * 7);
    const w = isoWeekInfo(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`);
    weeks.push(byWeek.get(w.key) || { ...w, stueck: 0, bohr: 0 });
  }
  return weeks;
}

function dashWeekChartSvg(weeks) {
  const max = Math.max(...weeks.map(w => w.stueck), 0);
  if (!max) return '<div class="pg-empty">Noch keine Bohrdaten für eine Wochenauswertung.</div>';
  const step = Math.max(1, Math.ceil(max / 4));   // Stückzahlen sind ganzzahlig: Achse ohne Nachkomma-Schritte
  const top = Math.ceil(max / step) * step;
  const bw = 32, gap = 14, L = 30, T = 20, B = 32, H = 190;
  const W = Math.max(400, L + weeks.length * (bw + gap) + 10);
  const ph = H - T - B, Yv = v => T + ph - v / top * ph;
  const curKey = weeks[weeks.length - 1].key;
  const o = [`<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gebohrte Pfähle je Kalenderwoche">`];
  for (let v = 0; v <= top + 1e-9; v += step) {
    o.push(`<line x1="${L}" x2="${W - 8}" y1="${Yv(v)}" y2="${Yv(v)}" class="grid"/><text x="${L - 6}" y="${Yv(v) + 3.5}" text-anchor="end" class="ax">${esc(nf0.format(v))}</text>`);
  }
  weeks.forEach((w, i) => {
    const x = L + gap / 2 + i * (bw + gap), y = Yv(w.stueck), h = T + ph - y;
    o.push(`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 0)}" rx="3" class="bar${w.key === curKey ? ' cur' : ''}"><title>KW ${w.week}/${w.year} (${esc(w.range)}): ${w.stueck} Pfähle, ${nf1.format(w.bohr)} m Bohrlänge</title></rect>`);
    if (w.stueck) o.push(`<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="val">${w.stueck}</text>`);
    o.push(`<text x="${x + bw / 2}" y="${H - B + 15}" text-anchor="middle" class="ax">KW ${w.week}</text>`);
  });
  o.push('</svg>');
  return o.join('');
}

/** Wochenleistung-Kachel: gebohrte Pfähle je Kalenderwoche, letzte 8 Wochen inkl. aktueller. */
function renderDashWoche() {
  const weeks = dashWeekData();
  const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
  const avg = weeks.reduce((a, w) => a + w.stueck, 0) / weeks.length;
  const diff = cur.stueck - prev.stueck;
  const diffTxt = diff === 0 ? '± 0 zur Vorwoche' : `${diff > 0 ? '+' : ''}${diff} zur Vorwoche`;
  $('#dashWeekSub').textContent = weeks.some(w => w.stueck)
    ? `Aktuelle Woche (KW ${cur.week}, ${cur.range}): ${plural(cur.stueck)} gebohrt (${diffTxt}) · Ø letzte 8 Wochen: ${nf1.format(avg)}`
    : 'Noch keine Bohrdaten für eine Wochenauswertung.';
  $('#dashWeekChart').innerHTML = dashWeekChartSvg(weeks);
}
