'use strict';

/* =====================================================================
   Koordinatensysteme (proj4) und Kartenansicht (Leaflet)
   Die Koordinaten stehen je Pfahl als Rechtswert/Ost (ost) und Hochwert/Nord (nord)
   im Koordinatensystem des Projekts (state.projekt.crs). Umgerechnet wird nur zur Anzeige.
   ===================================================================== */

const MGI = '+ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs';
const DHDN = '+ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs';
const tm = (lon, x0, y0, datum) => `+proj=tmerc +lat_0=0 +lon_0=${lon} +k=1 +x_0=${x0} +y_0=${y0} ${datum}`;

/** nat = Landesvermessung mit Vermessungs-Achsenbezeichnung (Y = Rechtswert/Ost, X = Hochwert/Nord) */
const CRS_LIST = [
  { id: 'EPSG:4326',  label: 'WGS84 – Länge/Breite in Grad (GPS)', geo: true },
  { id: 'EPSG:25832', label: 'ETRS89 / UTM 32N (EPSG:25832)', def: '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs' },
  { id: 'EPSG:25833', label: 'ETRS89 / UTM 33N (EPSG:25833)', def: '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs' },
  { id: 'EPSG:31254', label: 'MGI / Österreich GK West (EPSG:31254)',  nat: true, def: tm(10.33333333333333, 0, -5000000, MGI) },
  { id: 'EPSG:31255', label: 'MGI / Österreich GK Central (EPSG:31255)', nat: true, def: tm(13.33333333333333, 0, -5000000, MGI) },
  { id: 'EPSG:31256', label: 'MGI / Österreich GK East (EPSG:31256)',  nat: true, def: tm(16.33333333333333, 0, -5000000, MGI) },
  { id: 'EPSG:31284', label: 'MGI / Österreich M28 (EPSG:31284)', nat: true, def: tm(10.33333333333333, 150000, -5000000, MGI) },
  { id: 'EPSG:31285', label: 'MGI / Österreich M31 (EPSG:31285)', nat: true, def: tm(13.33333333333333, 450000, -5000000, MGI) },
  { id: 'EPSG:31286', label: 'MGI / Österreich M34 (EPSG:31286)', nat: true, def: tm(16.33333333333333, 750000, -5000000, MGI) },
  { id: 'EPSG:31287', label: 'MGI / Österreich Lambert (EPSG:31287)', nat: true,
    def: '+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.33333333333333 +x_0=400000 +y_0=400000 ' + MGI },
  { id: 'EPSG:31466', label: 'DHDN / Gauß-Krüger Zone 2 (EPSG:31466)', nat: true, def: tm(6, 2500000, 0, DHDN) },
  { id: 'EPSG:31467', label: 'DHDN / Gauß-Krüger Zone 3 (EPSG:31467)', nat: true, def: tm(9, 3500000, 0, DHDN) },
  { id: 'EPSG:31468', label: 'DHDN / Gauß-Krüger Zone 4 (EPSG:31468)', nat: true, def: tm(12, 4500000, 0, DHDN) },
  { id: 'EPSG:2056',  label: 'CH1903+ / LV95 Schweiz (EPSG:2056)',
    def: '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs' },
];
CRS_LIST.forEach(c => { if (c.def) proj4.defs(c.id, c.def); });

const DEFAULT_CRS = 'EPSG:25832';
const crsInfo = id => CRS_LIST.find(c => c.id === id) || CRS_LIST.find(c => c.id === DEFAULT_CRS);

/** Beschriftungen je nach Koordinatensystem */
function coordLabels(crs = state.projekt.crs) {
  return crsInfo(crs).geo
    ? { ost: 'Längengrad (Ost)', nord: 'Breitengrad (Nord)', unit: '°', dec: 7 }
    : { ost: 'Rechtswert (Ost)', nord: 'Hochwert (Nord)', unit: 'm', dec: 3 };
}

/** Pfahl → [Breite, Länge] (WGS84) oder null */
function toLatLon(p, crs = state.projekt.crs) {
  if (!p || !isNum(p.ost) || !isNum(p.nord)) return null;
  let lon, lat;
  if (crsInfo(crs).geo) { lon = p.ost; lat = p.nord; }
  else {
    try {
      const id = crsInfo(crs).id;
      [lon, lat] = proj4(id, 'EPSG:4326', [p.ost, p.nord]);
      // Gegenprobe: außerhalb des gültigen Bereichs liefert die Umkehrung sonst scheinbar plausible Werte
      const back = proj4('EPSG:4326', id, [lon, lat]);
      if (!(Math.abs(back[0] - p.ost) < 1 && Math.abs(back[1] - p.nord) < 1)) return null;
    } catch { return null; }
  }
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

const nf5 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
const fmtLatLon = ll => `${nf5.format(ll[0])}° N, ${nf5.format(ll[1])}° O`;

/** Abstand zweier WGS84-Punkte in km (Haversine) */
function kmBetween(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* =====================================================================
   Ausführungsstand (aus den Ausführungszeiten abgeleitet)
   ===================================================================== */
/* Rot = noch nicht ausgeführt, Orange = in Ausführung, Grün = ausgeführt, Blau = durch Bauleitung geprüft */
const STATUS = {
  offen:    { label: 'Noch nicht ausgeführt',   color: '#dc2626', ink: '#ffffff' },
  aktiv:    { label: 'In Ausführung',           color: '#e08600', ink: '#1a1207' },
  fertig:   { label: 'Ausgeführt',              color: '#2e7d32', ink: '#ffffff' },
  geprueft: { label: 'Durch Bauleitung geprüft', color: '#2563eb', ink: '#ffffff' },
};
function pileStatus(p) {
  if (p.geprueft) return 'geprueft';
  const z = p.zeiten || {};
  if ((z.betonieren || []).some(e => e.d && e.bis)) return 'fertig';
  if (ZEIT_GROUPS.some(g => (z[g.k] || []).some(e => e.d || e.von || e.bis))) return 'aktiv';
  // Vom Bohrist unvollständig gespeicherter Pfahl (offene Pflichtfelder) gilt als „In Ausführung“,
  // auch solange noch keine Ausführungszeiten erfasst sind – siehe form-submit in app.js.
  return p.unvollstaendig ? 'aktiv' : 'offen';
}

/* =====================================================================
   Karte
   ===================================================================== */
const BASES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
         opt: { maxNativeZoom: 19, maxZoom: 21, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende' } },
  osmde: { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
           opt: { maxNativeZoom: 19, maxZoom: 21, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende, Kacheln: openstreetmap.de' } },
  basemap: { url: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png',
             opt: { maxNativeZoom: 19, maxZoom: 21, attribution: 'Karte: <a href="https://www.basemap.at" target="_blank" rel="noopener">basemap.at</a> (nur Österreich)' } },
  ortho: { url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
           opt: { maxNativeZoom: 19, maxZoom: 21, attribution: 'Luftbild: <a href="https://www.basemap.at" target="_blank" rel="noopener">basemap.at</a> (nur Österreich)' } },
  none: null,
};

const BASE_LABEL = {
  osm: 'OpenStreetMap', osmde: 'OpenStreetMap Deutschland', basemap: 'basemap.at Karte', ortho: 'Luftbild', none: 'Ohne Hintergrund',
};
/** Reihenfolge der Ersatz-Hintergründe, falls einer nicht lädt */
const BASE_FALLBACK = ['osm', 'osmde', 'basemap'];

const MAP = { map: null, group: null, base: null, fitKey: '', markers: new Map(), tried: new Set() };

function mapPref() { try { return localStorage.getItem('bohrpfahl.mapbase') || 'osm'; } catch { return 'osm'; } }

function mapStatus(msg) {
  const el = $('#mapStatus');
  el.textContent = msg || '';
  el.hidden = !msg;
}

/** Ein Hintergrund lädt nicht (kein einziges Bild): auf den nächsten wechseln oder Hinweis zeigen. */
function baseFailed(name) {
  const next = BASE_FALLBACK.find(n => !MAP.tried.has(n));
  if (next) {
    mapStatus(`${BASE_LABEL[name]} ist nicht erreichbar (Internet, Firewall oder Sperre). Es wird ${BASE_LABEL[next]} verwendet.`);
    setBase(next, true);
  } else {
    mapStatus('Es konnte kein Hintergrund geladen werden (Internetverbindung oder Firewall?). Die Pfähle werden trotzdem angezeigt; bei „Ohne Hintergrund“ entfällt die Abfrage.');
  }
}

/** auto = automatischer Wechsel nach einem Fehler (wird nicht als Vorliebe gespeichert) */
function setBase(name, auto = false) {
  if (!BASES[name] && name !== 'none') name = 'osm';
  if (MAP.base) { MAP.map.removeLayer(MAP.base); MAP.base = null; }
  if (!auto) { MAP.tried = new Set(); mapStatus(''); }
  MAP.tried.add(name);
  if (BASES[name]) {
    const layer = L.tileLayer(BASES[name].url, BASES[name].opt);
    let ok = 0, err = 0;
    layer.on('tileload', () => { ok++; });
    layer.on('tileerror', () => { err++; });
    layer.on('load', () => { if (!ok && err && MAP.base === layer) baseFailed(name); });
    layer.addTo(MAP.map);
    MAP.base = layer;
  }
  $('#mapBase').value = name;
  if (!auto) { try { localStorage.setItem('bohrpfahl.mapbase', name); } catch { /* egal */ } }
}

function initMap() {
  if (MAP.map) return;
  MAP.map = L.map('map', { preferCanvas: true, maxZoom: 21, minZoom: 2, worldCopyJump: false }).setView([47.5, 11], 8);
  MAP.group = L.layerGroup().addTo(MAP.map);
  L.control.scale({ imperial: false }).addTo(MAP.map);
  MAP.map.on('zoomend', updateLabels);
  MAP.map.getContainer().addEventListener('click', e => {
    const b = e.target.closest('[data-pop]');
    if (!b) return;
    const p = state.piles.find(x => x.id === b.dataset.id);
    if (!p) return;
    if (b.dataset.pop === 'edit') openPile({ id: p.id });
    else if (b.dataset.pop === 'pdf') pdfProtokoll(p, b);
    else if (b.dataset.pop === 'pruef') togglePruefung(p);
  });
  setBase(mapPref());
}

/** Bei vielen, eng liegenden Pfählen erscheinen die Nummern erst bei größerem Zoom; Marker wachsen mit dem Zoom. */
function updateLabels() {
  if (!MAP.map) return;
  const z = MAP.map.getZoom();
  MAP.map.getContainer().classList.toggle('labels-on', z >= (MAP.markers.size > 60 ? 20 : 17));
  const r = z >= 20 ? 9 : z >= 19 ? 7 : z >= 18 ? 6 : z >= 17 ? 5 : 4;
  const sparse = MAP.markers.size <= 60;
  const w = z >= 17 || sparse ? 2 : 1;                 // dünner weißer Rand bei kleinem Zoom, damit die Farbe sichtbar bleibt
  MAP.markers.forEach(m => { m.setRadius(sparse ? Math.max(r, 7) : r); m.setStyle({ weight: w }); });
}

function popupHtml(p) {
  const st = STATUS[pileStatus(p)];
  const cl = coordLabels();
  const row = (k, v) => v ? `<div><span class="pk">${esc(k)}</span> ${esc(v)}</div>` : '';
  const lenV = isNum(p.pfahllaenge) ? p.pfahllaenge : p.sPfahllaenge;
  const len = isNum(lenV) ? `${nf3.format(lenV)} m${isNum(p.pfahllaenge) ? '' : ' (Soll)'}` : '';
  const dia = isNum(p.durchmesser) ? `${nf2.format(p.durchmesser)} m` : '';
  return `<div class="pop"><strong>${esc(p.nr)}</strong> <span class="pop-st" style="--c:${st.color};--ink:${st.ink}">${esc(st.label)}</span>
    ${row('Typ', pileTyp(p))}${row('Fotos', (p.fotos || []).length ? `${p.fotos.length} angehängt` : '')}${row('Ø / Länge', [dia, len].filter(Boolean).join(' · '))}
    ${row(cl.ost.split(' ')[0], nfCoord(p.ost))}${row(cl.nord.split(' ')[0], nfCoord(p.nord))}
    <div class="pop-act"><button type="button" class="btn small" data-pop="edit" data-id="${esc(p.id)}">Bearbeiten</button>
    <button type="button" class="btn small" data-pop="pdf" data-id="${esc(p.id)}">Protokoll</button>
    ${isAdmin() ? `<button type="button" class="btn small" data-pop="pruef" data-id="${esc(p.id)}">${p.geprueft ? 'Prüfung zurücknehmen' : 'Als geprüft markieren'}</button>` : ''}</div></div>`;
}

const nfCoord = v => isNum(v) ? new Intl.NumberFormat('de-DE', { minimumFractionDigits: coordLabels().dec, maximumFractionDigits: coordLabels().dec }).format(v) : '';

/** Zeichnet die übergebenen Pfähle (bereits gefiltert) auf die Karte. */
function renderMap(list) {
  initMap();
  const withPos = [], without = [];
  list.forEach(p => { const ll = toLatLon(p); (ll ? withPos : without).push({ p, ll }); });

  MAP.group.clearLayers();
  MAP.markers.clear();
  const many = withPos.length > 1500;
  const counts = { offen: 0, aktiv: 0, fertig: 0, geprueft: 0 };
  for (const { p, ll } of withPos) {
    const s = pileStatus(p);
    counts[s]++;
    const m = L.circleMarker(ll, { radius: 6, weight: 2, color: '#ffffff', fillColor: STATUS[s].color, fillOpacity: 0.95 });
    m.bindPopup(popupHtml(p), { minWidth: 260, offset: [0, -4], autoPanPadding: [24, 24] });
    if (!many) m.bindTooltip(p.nr, { permanent: true, direction: 'right', offset: [6, 0], className: 'pile-label' });
    m.addTo(MAP.group);
    MAP.markers.set(p.id, m);
  }
  updateLabels();
  // „Ausgeführt“ enthält die geprüften Pfähle: wird ein Pfahl geprüft, springt die Zahl nicht auf 0
  const shown = { ...counts, fertig: counts.fertig + counts.geprueft };
  $('#mapLegend').innerHTML = Object.entries(STATUS).map(([k, s]) =>
    `<span class="lg"><i style="background:${s.color}"></i>${esc(s.label)} <b>${shown[k]}</b></span>`).join('');
  $('#mapNoCoords').textContent = without.length
    ? `${plural(without.length)} ohne Koordinaten (nicht auf der Karte): ${without.slice(0, 8).map(x => x.p.nr).join(', ')}${without.length > 8 ? ' …' : ''}`
    : '';
  $('#mapEmpty').hidden = withPos.length > 0;
  $('#mapEmpty').textContent = state.piles.length
    ? 'Keine Pfähle mit Koordinaten in der aktuellen Auswahl. Koordinaten können im Pfahl-Formular oder über den Excel-Import (Rechtswert/Hochwert) erfasst werden.'
    : 'Noch keine Pfähle erfasst.';

  // Ausschnitt nur anpassen, wenn sich die angezeigte Auswahl geändert hat
  const key = withPos.map(x => x.p.id).join(',');
  setTimeout(() => {
    MAP.map.invalidateSize();
    if (key !== MAP.fitKey) { MAP.fitKey = key; fitMap(withPos.map(x => x.ll)); }
  }, 0);
}

function fitMap(lls) {
  if (!lls) lls = [...MAP.markers.values()].map(m => m.getLatLng());
  if (!lls.length) return;
  if (lls.length === 1) MAP.map.setView(lls[0], 18);
  else MAP.map.fitBounds(L.latLngBounds(lls), { padding: [40, 40], maxZoom: 19 });
}

/** Pfahl auf der Karte zeigen und Popup öffnen */
function focusPile(id) {
  setTimeout(() => {
    const m = MAP.markers.get(id);
    if (!m) return;
    MAP.map.setView(m.getLatLng(), Math.max(MAP.map.getZoom(), 18));
    m.openPopup();
  }, 60);
}

function clearMap() {
  if (!MAP.map) return;
  MAP.group.clearLayers();
  MAP.markers.clear();
  MAP.fitKey = '';
  $('#mapLegend').innerHTML = ''; $('#mapNoCoords').textContent = '';
}

$('#mapBase').addEventListener('change', e => setBase(e.target.value));
$('#btnMapFit').addEventListener('click', () => fitMap());

/* =====================================================================
   Dashboard: kompakter, schreibgeschützter Kartenausschnitt
   (eigene, kleinere Karteninstanz; Klick auf einen Pfahl wechselt zur vollen Karte)
   ===================================================================== */
const DMAP = { map: null, group: null, fitKey: '' };

function initDashMap() {
  if (DMAP.map) return;
  DMAP.map = L.map('dashMap', {
    preferCanvas: true, maxZoom: 21, minZoom: 2, worldCopyJump: false,
    attributionControl: false, zoomControl: false,
  }).setView([47.5, 11], 8);
  L.control.zoom({ position: 'bottomright' }).addTo(DMAP.map);
  DMAP.group = L.layerGroup().addTo(DMAP.map);
  const name = mapPref();
  if (BASES[name]) L.tileLayer(BASES[name].url, BASES[name].opt).addTo(DMAP.map);
}

function renderDashMap(list) {
  initDashMap();
  const withPos = [];
  list.forEach(p => { const ll = toLatLon(p); if (ll) withPos.push({ p, ll }); });

  DMAP.group.clearLayers();
  const counts = { offen: 0, aktiv: 0, fertig: 0, geprueft: 0 };
  for (const { p, ll } of withPos) {
    const s = pileStatus(p);
    counts[s]++;
    const m = L.circleMarker(ll, { radius: 5, weight: 1.5, color: '#ffffff', fillColor: STATUS[s].color, fillOpacity: 0.95 });
    m.bindTooltip(p.nr);
    m.on('click', () => { setView('map'); focusPile(p.id); });
    m.addTo(DMAP.group);
  }
  // „Ausgeführt“ enthält die geprüften Pfähle (gleiche Zählweise wie auf der Hauptkarte)
  const shown = { ...counts, fertig: counts.fertig + counts.geprueft };
  $('#dashMapLegend').innerHTML = withPos.length
    ? Object.entries(STATUS).map(([k, s]) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.label)} <b>${shown[k]}</b></span>`).join('')
    : '';

  $('#dashMapEmpty').hidden = withPos.length > 0;
  $('#dashMapEmpty').textContent = list.length
    ? 'Keine Pfähle mit Koordinaten in diesem Projekt.'
    : 'Noch keine Pfähle erfasst.';

  const key = withPos.map(x => x.p.id).join(',');
  setTimeout(() => {
    DMAP.map.invalidateSize();
    if (key === DMAP.fitKey) return;
    DMAP.fitKey = key;
    const lls = withPos.map(x => x.ll);
    if (!lls.length) return;
    if (lls.length === 1) DMAP.map.setView(lls[0], 16);
    else DMAP.map.fitBounds(L.latLngBounds(lls), { padding: [20, 20], maxZoom: 17 });
  }, 0);
}

function clearDashMap() {
  if (!DMAP.map) return;
  DMAP.group.clearLayers();
  DMAP.fitKey = '';
  $('#dashMapLegend').innerHTML = '';
}
