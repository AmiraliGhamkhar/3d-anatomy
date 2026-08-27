/**
 * main.js — the demonstration application.
 *
 * Deliberately thin: every piece of anatomy comes from the library, and this file
 * only wires the DOM to `AnatomyViewer`. It is the reference for how to embed the
 * model in a larger app.
 */
import { Vector3 } from 'three';
import { AnatomyViewer } from '../AnatomyViewer.js';

const LAYER_META = [
  { id: 'skeletal', label: 'Skeletal system', color: '#e6dcc4' },
  { id: 'muscular', label: 'Muscular system', color: '#8e3b32' },
  { id: 'visceral', label: 'Viscera & CNS', color: '#c98d84' },
  { id: 'integumentary', label: 'Body surface', color: '#c9967e' },
];

const $ = (sel) => document.querySelector(sel);

const viewer = new AnatomyViewer($('#view'), {
  quality: 'auto',
  visible: { skeletal: true, muscular: true, visceral: false, integumentary: false },
  skinOpacity: 0.22,
});
viewer.init();

/* ---------------- layer panel ---------------- */
const layerList = $('#layer-list');
const counts = new Map();
for (const part of viewer.parts.values()) {
  const sys = part.userData.part?.system;
  if (sys) counts.set(sys, (counts.get(sys) ?? 0) + 1);
}

for (const meta of LAYER_META) {
  const row = document.createElement('label');
  row.className = 'layer';
  row.style.color = meta.color;
  const on = viewer.options.visible[meta.id] ?? false;
  if (!on) row.classList.add('off');
  row.innerHTML = `
    <input type="checkbox" ${on ? 'checked' : ''} />
    <span class="dot"></span>
    <span class="name">${meta.label}</span>
    <span class="count">${counts.get(meta.id) ?? 0}</span>`;
  const input = row.querySelector('input');
  input.addEventListener('change', () => {
    viewer.setSystemVisible(meta.id, input.checked);
    row.classList.toggle('off', !input.checked);
  });
  layerList.appendChild(row);
}

/* ---------------- skin opacity ---------------- */
const skin = $('#skin');
const skinOut = $('#skin-out');
skin.addEventListener('input', () => {
  const v = Number(skin.value) / 100;
  skinOut.textContent = `${skin.value}%`;
  viewer.setSkinOpacity(v);
  // Turning the skin on from zero should also make its system visible.
  if (v > 0) {
    viewer.setSystemVisible('integumentary', true);
    const box = layerList.children[LAYER_META.findIndex((m) => m.id === 'integumentary')];
    box.classList.remove('off');
    box.querySelector('input').checked = true;
  }
});

/* ---------------- quality ---------------- */
$('#quality').addEventListener('change', (e) => {
  if (e.target.value === 'auto') {
    viewer.governor.enabled = true;
    viewer.governor.apply();
  } else {
    viewer.governor.enabled = false;
    viewer.governor.setTier(e.target.value);
  }
});

$('#reset').addEventListener('click', () => {
  viewer.isolate(null);
  viewer.select(null);
  hideDetail();
  viewer.frameAll();
});
$('#clear-sel').addEventListener('click', () => {
  viewer.isolate(null);
  viewer.select(null);
  hideDetail();
});

/* ---------------- search / browse ---------------- */
const results = $('#results');
const allParts = [...viewer.parts.values()]
  .map((o) => ({ id: o.userData.part.id, ...o.userData.part }))
  .filter((p) => p.name)
  .sort((a, b) => a.name.localeCompare(b.name));

function renderResults(list) {
  results.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No matches';
    results.appendChild(li);
    return;
  }
  for (const p of list.slice(0, 60)) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}</span><span class="sys">${p.system}</span>`;
    li.addEventListener('click', () => {
      viewer.setSystemVisible(p.system, true);
      const box = layerList.children[LAYER_META.findIndex((m) => m.id === p.system)];
      if (box) {
        box.classList.remove('off');
        box.querySelector('input').checked = true;
      }
      viewer.select(p.id);
      viewer.focus(p.id);
      showDetail(p);
    });
    results.appendChild(li);
  }
}
renderResults(allParts.slice(0, 40));

$('#search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderResults(allParts.slice(0, 40));
  renderResults(
    allParts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.latin ?? '').toLowerCase().includes(q) ||
        (p.region ?? '').toLowerCase().includes(q),
    ),
  );
});

/* ---------------- detail card ---------------- */
const detail = $('#detail');
function showDetail(p) {
  detail.hidden = false;
  $('#detail-name').textContent = p.name;
  $('#detail-latin').textContent = p.latin ?? '';
  $('#detail-meta').textContent = `${p.system ?? ''}${p.region ? ' · ' + p.region : ''}`;
  $('#detail-note').textContent = p.note ?? '';
  $('#focus').onclick = () => viewer.focus(p.id);
  $('#isolate').onclick = () => {
    viewer.isolate(p.id);
    viewer.focus(p.id);
  };
}
function hideDetail() {
  detail.hidden = true;
}

/* ---------------- picking ---------------- */
viewer.onPick = (hit) => {
  if (!hit) return hideDetail();
  const part = viewer.parts.get(hit.id);
  showDetail(part ? part.userData.part : hit);
};

/* ---------------- label overlay ----------------
 * A single floating label tracking the selected structure. It is re-projected
 * every frame from the part's world-space centre, so it stays glued to the
 * anatomy while you orbit.
 */
const labels = $('#labels');
const labelEl = document.createElement('div');
labelEl.className = 'label';
labels.appendChild(labelEl);

let labelledPart = null;
const _centre = new Vector3();

function updateLabel() {
  if (!viewer.selected) {
    labelEl.style.display = 'none';
    return;
  }
  const obj = viewer.selected !== labelledPart ? viewer.parts.get(viewer.selected) : labelledPart;
  if (!obj) {
    labelEl.style.display = 'none';
    return;
  }
  labelledPart = obj;
  const centre = viewer.partWorldCentre(viewer.selected, _centre);
  const p = viewer.project(centre);
  labelEl.style.display = 'block';
  labelEl.style.left = `${p.x}px`;
  labelEl.style.top = `${p.y}px`;
  labelEl.textContent = obj.userData.part?.name ?? viewer.selected;
}
setInterval(updateLabel, 50);

/* ---------------- stats HUD ---------------- */
const statsEl = $('#stats');
const rows = [
  ['fps', 'Frame rate'],
  ['tier', 'Quality tier'],
  ['dpr', 'Pixel ratio'],
  ['triangles', 'Triangles'],
  ['drawCalls', 'Draw calls'],
  ['parts', 'Anatomical parts'],
];
const cells = {};
for (const [key, label] of rows) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = '—';
  statsEl.append(dt, dd);
  cells[key] = dd;
}
cells.parts.textContent = String(viewer.parts.size);

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
let lastStats = 0;
viewer.onStats = (s) => {
  const now = performance.now();
  if (now - lastStats < 250) return; // 4 Hz is plenty for a readout
  lastStats = now;
  cells.fps.textContent = s.fps ? `${Math.round(s.fps)} fps` : '—';
  cells.tier.textContent = s.tier ?? '—';
  cells.dpr.textContent = s.dpr ? s.dpr.toFixed(2) + '×' : '—';
  cells.triangles.textContent = fmt(s.triangles ?? 0);
  cells.drawCalls.textContent = String(s.drawCalls ?? 0);
};

viewer.onTierChange = (tier, name) => {
  const sel = $('#quality');
  if (viewer.governor.enabled && sel.value !== 'auto') sel.value = 'auto';
  console.info(`[anatomy] quality tier → ${name} (${tier.label})`);
};
