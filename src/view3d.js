'use strict';

/* =====================================================================
   3D-Ansicht (Three.js)
   Zeigt jeden Pfahl mit Koordinaten als stehenden Zylinder an seiner
   Ost/Nord-Position; farbige Abschnitte entlang der Tiefe wie im
   2D-Schnitt (siehe layerSpans/soilOf in graphic.js). Die Höhe der
   Arbeitsebene (bzw. Soll) bestimmt die vertikale Position, dadurch
   werden unterschiedliche Geländehöhen sichtbar. Klick auf einen Pfahl
   öffnet ihn wie in Tabelle und Karte (openPile).
   ===================================================================== */
const VIEW3D = { renderer: null, scene: null, camera: null, controls: null, group: null, ro: null, fitKey: '' };

function ensure3D() {
  if (VIEW3D.renderer) return;
  const host = $('#view3dCanvas');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f4);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;   // nicht unter das Gelände drehen

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.15));
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(80, 140, 60);
  scene.add(dir);

  const group = new THREE.Group();
  scene.add(group);

  Object.assign(VIEW3D, { renderer, scene, camera, controls, group });

  VIEW3D.ro = new ResizeObserver(() => resize3D());
  VIEW3D.ro.observe(host);

  const raycaster = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const pick = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ptr, camera);
    const hit = raycaster.intersectObjects(group.children, true)[0];
    let o = hit && hit.object;
    while (o && !o.userData.pileId) o = o.parent;
    return o ? o.userData.pileId : null;
  };
  renderer.domElement.addEventListener('click', e => { const id = pick(e); if (id) openPile({ id }); });
  renderer.domElement.addEventListener('pointermove', e => { renderer.domElement.style.cursor = pick(e) ? 'pointer' : 'grab'; });

  (function loop() {
    requestAnimationFrame(loop);
    if ($('#view3dView').hidden) return;
    controls.update();
    renderer.render(scene, camera);
  })();
}

function resize3D() {
  if (!VIEW3D.renderer) return;
  const host = $('#view3dCanvas');
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  VIEW3D.renderer.setSize(w, h, false);
  VIEW3D.camera.aspect = w / h;
  VIEW3D.camera.updateProjectionMatrix();
}

function disposeObject3D(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

/** Lokale, näherungsweise maßstabsgetreue Meter-Koordinaten (x nach Osten, z nach Süden), zentriert
    auf den Schwerpunkt der übergebenen Pfähle. Bei geografischem Koordinatensystem (WGS84) grob über
    die Breite in Meter umgerechnet (für die räumliche Anordnung ausreichend, keine echte Projektion). */
function planar3D(piles) {
  const geo = crsInfo(state.projekt.crs).geo;
  if (!piles.length) return [];
  const cx = piles.reduce((s, p) => s + p.ost, 0) / piles.length;
  const cy = piles.reduce((s, p) => s + p.nord, 0) / piles.length;
  const mPerLon = geo ? 111320 * Math.cos(cy * Math.PI / 180) : 1;
  const mPerLat = geo ? 111320 : 1;
  return piles.map(p => ({ p, x: (p.ost - cx) * mPerLon, z: -(p.nord - cy) * mPerLat }));
}

const soilColor3D = l => {
  if (l.art === 'hindernis') return 0xa9744a;
  if (l.art === 'hart') return 0x9aa1ab;
  const s = l.art === 'boden' ? soilOf(l.boden) : null;
  return s ? s.color : 0xcfd3d8;
};

/** Ein Pfahl als Gruppe aus gestapelten Zylindersegmenten (Bodenaufschluss) plus Statusring am Kopf.
    refY: mittlere Arbeitsebene der aktuell angezeigten Pfähle, damit nur die (meist geringen)
    Höhenunterschiede zwischen den Pfählen sichtbar werden statt der absoluten Höhenkote. */
function pile3DMesh(p, refY) {
  const g = new THREE.Group();
  g.userData.pileId = p.id;

  const ae = isNum(p.arbeitsebene) ? p.arbeitsebene : p.sArbeitsebene;
  const topY = (isNum(ae) ? ae : refY) - refY;
  const r = Math.max(0.15, (isNum(p.durchmesser) ? p.durchmesser : 0.4) / 2);
  const layers = layerSpans(p);

  const addSeg = (von, bis, color) => {
    const h = Math.max(0.05, bis - von);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 }));
    mesh.position.y = topY - von - h / 2;
    mesh.userData.pileId = p.id;
    g.add(mesh);
  };

  if (layers.length) {
    layers.forEach(l => addSeg(l.von, l.bis, soilColor3D(l)));
  } else {
    const uk = isNum(p.unterkante) ? p.unterkante : p.sUnterkante;
    const depthUK = isNum(uk) && isNum(ae) ? ae - uk : 8;   // Fallback: 8 m, wenn gar keine Höhenangaben vorhanden sind
    addSeg(0, Math.max(0.3, depthUK), STATUS[pileStatus(p)].color);
  }

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.14, 18), new THREE.MeshStandardMaterial({ color: STATUS[pileStatus(p)].color }));
  ring.position.y = topY + 0.07;
  ring.userData.pileId = p.id;
  g.add(ring);

  return g;
}

/** Grobe Tiefenabschätzung eines Pfahls (für die Kamera-Einstellung, keine exakte Länge). */
function pileDepthEstimate(p) {
  const layers = layerSpans(p);
  if (layers.length) return layers[layers.length - 1].bis;
  const ae = isNum(p.arbeitsebene) ? p.arbeitsebene : p.sArbeitsebene;
  const uk = isNum(p.unterkante) ? p.unterkante : p.sUnterkante;
  return isNum(ae) && isNum(uk) ? ae - uk : 8;
}

function fit3D(pts) {
  if (!pts.length) return;
  const xs = pts.map(x => x.x), zs = pts.map(x => x.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const maxDepth = Math.max(8, ...pts.map(x => pileDepthEstimate(x.p)));
  const spread = Math.max(15, maxDepth * 1.6, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const midY = -maxDepth * 0.35;   // Blickpunkt etwas unterhalb der Arbeitsebene, damit die Pfähle mittig liegen
  VIEW3D.controls.target.set(cx, midY, cz);
  VIEW3D.camera.position.set(cx + spread * 0.7, midY + spread * 0.75 + 5, cz + spread * 0.7);
  VIEW3D.camera.near = Math.max(0.1, spread / 500);
  VIEW3D.camera.far = spread * 40 + 200;
  VIEW3D.camera.updateProjectionMatrix();
  VIEW3D.controls.update();
}

/** Zeichnet die übergebenen Pfähle (bereits gefiltert) in der 3D-Ansicht. */
function render3D(list) {
  ensure3D();
  VIEW3D.group.children.slice().forEach(c => { disposeObject3D(c); VIEW3D.group.remove(c); });

  const withPos = list.filter(p => isNum(p.ost) && isNum(p.nord));
  const pts = planar3D(withPos);
  const grid = new THREE.GridHelper(Math.max(40, Math.ceil((pts.length ? Math.max(...pts.map(x => Math.hypot(x.x, x.z)), 20) : 20) * 2.4 / 10) * 10), 24, 0xbfc7cf, 0xdfe3e7);
  grid.raycast = () => {};   // Gitterlinien sollen Klicks auf Pfähle nicht blockieren
  VIEW3D.group.add(grid);

  const aeVals = withPos.map(p => (isNum(p.arbeitsebene) ? p.arbeitsebene : p.sArbeitsebene)).filter(isNum);
  const refY = aeVals.length ? aeVals.reduce((s, v) => s + v, 0) / aeVals.length : 0;

  pts.forEach(({ p, x, z }) => {
    const mesh = pile3DMesh(p, refY);
    mesh.position.x = x; mesh.position.z = z;
    VIEW3D.group.add(mesh);
  });

  const without = list.length - withPos.length;
  $('#view3dNoCoords').textContent = without
    ? `${plural(without)} ohne Koordinaten (nicht in der 3D-Ansicht).`
    : '';
  $('#view3dEmpty').hidden = pts.length > 0;
  $('#view3dEmpty').textContent = state.piles.length
    ? 'Keine Pfähle mit Koordinaten in der aktuellen Auswahl. Koordinaten können im Pfahl-Formular oder über den Excel-Import (Rechtswert/Hochwert) erfasst werden.'
    : 'Noch keine Pfähle erfasst.';

  resize3D();
  const key = pts.map(x => x.p.id).join(',');
  if (key !== VIEW3D.fitKey) { VIEW3D.fitKey = key; fit3D(pts); }
}

function clear3D() {
  if (!VIEW3D.group) return;
  VIEW3D.group.children.slice().forEach(c => { disposeObject3D(c); VIEW3D.group.remove(c); });
  VIEW3D.fitKey = '';
  $('#view3dNoCoords').textContent = '';
}

$('#btnView3dFit').addEventListener('click', () => {
  const pts = planar3D(visiblePiles().filter(p => isNum(p.ost) && isNum(p.nord)));
  fit3D(pts);
});
