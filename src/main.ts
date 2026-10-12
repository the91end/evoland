import * as THREE from 'three';
import './style.css';
import { Pond, TYPE_COLOURS, type ColourMode } from './view/pond';
import { drawOrganism, organismCellAt } from './view/organism';
import { COLONY_SERIES, drawColonies, drawFeeding, drawPopulation, drawTypes } from './view/charts';
import { DEFAULT_PARAMS, type Params } from './sim/params';
import { CELL_TYPES, GENE_NAMES, OUTPUT_NAMES } from './sim/genome';
import type { SpeciesInfo } from './sim/species';
import type { CellDetail, FromWorker, Stats, ToWorker } from './protocol';
import SimWorker from './sim.worker.ts?worker&inline';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const url = new URL(location.href);
let seed = url.searchParams.get('seed') ?? String(Math.floor(Math.random() * 1e6));
let overrides: Partial<Params> = loadOverrides();
let params: Params = { ...DEFAULT_PARAMS, ...overrides };
let paused = false;
let stats: Stats | null = null;
let speciesById = new Map<number, SpeciesInfo>();

const worker = new SimWorker();
const send = (m: ToWorker) => worker.postMessage(m);
const pond = new Pond($('scene'), params);

// ---------------------------------------------------------------------------
// Species colours (shared by the 3D view and the charts)
// ---------------------------------------------------------------------------

const speciesColours = new Map<number, THREE.Color>();
function speciesColour(id: number): THREE.Color {
  let c = speciesColours.get(id);
  if (!c) {
    c = new THREE.Color().setHSL((id * 0.61803) % 1, 0.75, 0.55);
    speciesColours.set(id, c);
  }
  return c;
}
const speciesCss = (id: number) => `#${speciesColour(id).getHexString()}`;
const tagCss = (t: number[]) => `rgb(${t.map((v) => Math.round(v * 255)).join(',')})`;

// ---------------------------------------------------------------------------
// Worker messages
// ---------------------------------------------------------------------------

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'ready':
      params = m.params;
      break;
    case 'frame':
      pond.pushFrame(m);
      updateClock(m.tick, m.sun, m.rate, m.n);
      break;
    case 'stats':
      stats = m;
      speciesById = new Map(m.species.map((s) => [s.id, s]));
      drawSide();
      break;
    case 'inspect':
      showInspector(m);
      break;
  }
};

function start(): void {
  params = { ...DEFAULT_PARAMS, ...overrides };
  pond.build(params);
  speciesColours.clear();
  closeInspector();
  try {
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  } catch {
    // Sandboxed hosts may refuse URL changes; the seed box still shows it.
  }
  $<HTMLInputElement>('seed').value = seed;
  buildTune();
  send({ type: 'start', seed, params: overrides });
  send({ type: 'speed', speed: currentSpeed() });
  send({ type: 'pause', paused });
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

const speedInput = $<HTMLInputElement>('speed');
const SPEED_MIN = 0.25;
const SPEED_MAX = 20;
const speedFromSlider = (v: number) => SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, v / 100);
speedInput.value = String((100 * Math.log(1 / SPEED_MIN)) / Math.log(SPEED_MAX / SPEED_MIN));
function currentSpeed(): number {
  const s = speedFromSlider(Number(speedInput.value));
  return s < 1 ? Math.round(s * 100) / 100 : s < 3 ? Math.round(s * 10) / 10 : Math.round(s);
}
function onSpeed(): void {
  const s = currentSpeed();
  $('speedLabel').textContent = `${s}×`;
  send({ type: 'speed', speed: s });
}
speedInput.addEventListener('input', onSpeed);
onSpeed();

function setPaused(p: boolean): void {
  paused = p;
  $('play').textContent = paused ? 'Play' : 'Pause';
  send({ type: 'pause', paused });
}
$('play').addEventListener('click', () => setPaused(!paused));

$<HTMLSelectElement>('colour').addEventListener('change', (e) => {
  pond.colourMode = (e.target as HTMLSelectElement).value as ColourMode;
});

$('restart').addEventListener('click', () => {
  seed = $<HTMLInputElement>('seed').value.trim() || String(Math.floor(Math.random() * 1e6));
  start();
});
$<HTMLInputElement>('seed').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('restart').click();
});

$('sideBtn').addEventListener('click', () => $('side').classList.toggle('closed'));
if (window.innerWidth < 760) $('side').classList.add('closed');

function updateClock(tick: number, sun: number, rate: number, n: number): void {
  const day = Math.floor(tick / params.dayLength) + 1;
  const phase = sun > 0 ? 'day' : 'night';
  $('clock').textContent = `Day ${day}, ${phase} · tick ${tick} · ${n} cells`;
  $('rate').textContent = rate ? `${Math.round(rate)} ticks/s` : '';
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.key === 'Escape') closeInspector();
});

// ---------------------------------------------------------------------------
// Side panel: charts and species tree
// ---------------------------------------------------------------------------

$('colonyLegend').innerHTML = COLONY_SERIES.map(
  ([, label, col]) => `<span><i style="background:${col}"></i>${label}</span>`,
).join('');

$('typeLegend').innerHTML = CELL_TYPES.map(
  (label, k) => `<span><i style="background:${TYPE_COLOURS[k]}"></i>${label}</span>`,
).join('');

function drawSide(): void {
  if (!stats || $('side').classList.contains('closed')) return;
  drawPopulation($('popChart'), stats.history, stats.species, speciesCss);
  drawFeeding($('feedChart'), stats.history);
  drawColonies($('colonyChart'), stats.history);
  drawTypes($('typeChart'), stats.history, TYPE_COLOURS);
  const last = stats.history[stats.history.length - 1];
  if (last?.types)
    $('multiTotals').textContent =
      `${last.typesPerColony.toFixed(1)} cell types per colony · ${last.germColonies} colonies with a germ cell · ` +
      `${stats.fragments.toLocaleString()} colonies split · ${stats.germReleases.toLocaleString()} germ cells released · ` +
      `${stats.fusions.toLocaleString()} sex cell fusions`;

  const alive = stats.species.filter((s) => s.count > 0);
  const big = alive.filter((s) => s.count >= 10).length;
  $('speciesCount').textContent = `${big} with 10+ cells, ${alive.length} alive`;
  $('totals').textContent =
    `${stats.totalBorn.toLocaleString()} cells born · ${stats.engulfed.toLocaleString()} engulfed · ` +
    `${stats.swaps.toLocaleString()} gene swaps · ${stats.captured.toLocaleString()} kept as guests · ` +
    `${stats.policed.toLocaleString()} bonds cut by policing`;
  $('speciesTree').replaceChildren(...speciesTree(stats.species));
}

/** Indented family tree of species that are alive or have living descendants. */
function speciesTree(all: SpeciesInfo[]): HTMLElement[] {
  const children = new Map<number, SpeciesInfo[]>();
  for (const s of all) {
    const list = children.get(s.parent) ?? [];
    list.push(s);
    children.set(s.parent, list);
  }
  const hasLiving = new Map<number, boolean>();
  const living = (s: SpeciesInfo): boolean => {
    let v = hasLiving.get(s.id);
    if (v === undefined) {
      v = s.count > 0;
      for (const c of children.get(s.id) ?? []) v = living(c) || v;
      hasLiving.set(s.id, v);
    }
    return v;
  };
  const rows: HTMLElement[] = [];
  const walk = (s: SpeciesInfo, depth: number) => {
    if (!living(s) || rows.length > 200) return;
    const row = document.createElement('div');
    row.className = 'row' + (s.count === 0 ? ' extinct' : '');
    row.style.paddingLeft = `${depth * 12}px`;
    const [l, v, e] = s.feeding;
    row.innerHTML =
      `<span class="swatch" style="background:${speciesCss(s.id)}"></span>` +
      `<span class="swatch" title="tag colour" style="background:${tagCss(s.tag)};border-radius:2px"></span>` +
      `<span>#${s.id}</span>` +
      `<span class="feedbar" title="light ${pct(l)} · vent ${pct(v)} · engulfing ${pct(e)}">` +
      `<i style="width:${l * 100}%;background:var(--light)"></i>` +
      `<i style="width:${v * 100}%;background:var(--vent)"></i>` +
      `<i style="width:${e * 100}%;background:var(--engulf)"></i></span>` +
      `<span class="muted small">r ${s.meanRadius.toFixed(1)}</span>` +
      `<span class="count">${s.count > 0 ? s.count : 'extinct'}</span>`;
    rows.push(row);
    const kids = (children.get(s.id) ?? []).sort((a, b) => b.count - a.count);
    for (const c of kids) walk(c, depth + 1);
  };
  for (const root of children.get(0) ?? []) walk(root, 0);
  return rows;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------
// Picking and the inspector
// ---------------------------------------------------------------------------

let downAt: [number, number] | null = null;
const canvas = pond.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 4) return;
  const id = pond.pick(e.clientX, e.clientY);
  if (id !== null) {
    pond.followId = id;
    send({ type: 'inspect', id });
  }
});
$('inspClose').addEventListener('click', closeInspector);

/** Follows the biggest colony with 2+ cell types, or else the biggest colony. */
$('biggestBtn').addEventListener('click', () => {
  const f = pond.latest;
  if (!f) return;
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < f.n; i++) {
    const score = f.colonySize[i] + (f.colonyTypes[i] >= 2 ? 1e6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) {
    $('biggestBtn').textContent = 'No colonies yet';
    setTimeout(() => ($('biggestBtn').textContent = 'Follow biggest'), 1500);
    return;
  }
  pond.followId = f.ids[best];
  send({ type: 'inspect', id: f.ids[best] });
});

function closeInspector(): void {
  pond.followId = null;
  $('inspector').hidden = true;
  send({ type: 'inspect', id: null });
}

function showInspector(d: CellDetail): void {
  if (pond.followId !== d.id) return;
  $('inspector').hidden = false;
  const sp = speciesById.get(d.species);
  $('inspTitle').innerHTML =
    `<span class="swatch" style="background:${speciesCss(d.species)}"></span>Cell #${d.id}` +
    (d.alive ? '' : ' <span class="muted">(dead)</span>');
  const t = d.traits;
  const rows: [string, string][] = d.alive
    ? [
        ['Species', `#${d.species}${sp ? ` (${sp.count} cells)` : ''}`],
        ['Generation', String(d.generation)],
        ['Age', `${d.age} / ${d.lifespan} ticks`],
        ['Energy', `${d.energy.toFixed(1)} / ${d.maxEnergy.toFixed(1)}`],
        ['Radius', t.radius.toFixed(2)],
        ['Feeding L / V / E', `${pct(t.light)} / ${pct(t.vent)} / ${pct(t.engulf)}`],
        ['Motility', t.motility.toFixed(2)],
        ['Tolerance', t.tolerance.toFixed(3)],
        ['Gene swapping', t.swap.toFixed(2)],
        ['Divides at', pct(t.divThreshold)],
        ['Mutation rate', t.mutationRate.toFixed(3)],
        ['Adhesion', t.adhesion.toFixed(2)],
        ['Sharing', t.sharing.toFixed(2)],
        ['Policing', t.policing.toFixed(2)],
        ['Symbiont keeping', t.symbiont.toFixed(2)],
        ['Cell type', CELL_TYPES[d.cellType] + (d.gamete ? ` (${d.gamete} ticks to find a partner)` : '')],
        ['Switches', d.switches.map((v) => v.toFixed(2)).join(' · ')],
        ...d.outputs.map((v, k): [string, string] => [`Output: ${OUTPUT_NAMES[k]}`, `${v >= 0 ? '+' : ''}${v.toFixed(2)}`]),
        ['Signal / colony limit / sex', `${t.signal.toFixed(2)} / ${t.colonyLimit} cells / ${t.sex.toFixed(2)}`],
        ['Bonds', `${d.bonds} (colony of ${d.colonySize})`],
        ['Shared lately: gave / got', `${d.gave.toFixed(1)} / ${d.got.toFixed(1)}`],
        ['Height above floor', d.pos[1].toFixed(0)],
      ]
    : [
        ['Species', `#${d.species}`],
        ['Generation', String(d.generation)],
        ['Lived', `${d.age} ticks`],
      ];
  rows.push(['Living offspring', String(d.children)], ['Living descendants', String(d.descendants)]);

  const org = d.alive ? d.organism : null;
  let html = '';
  if (org) {
    const counts = new Array<number>(CELL_TYPES.length).fill(0);
    let energy = 0;
    for (const c of org.cells) {
      counts[c.type]++;
      energy += c.energy;
    }
    const kinds = counts.filter((c) => c > 0).length;
    const label = org.cells.length >= 3 && kinds >= 2 ? 'Multicellular organism' : 'Colony';
    html +=
      `<h2>${label}: ${org.cells.length}${org.truncated ? '+' : ''} cells, ${kinds} cell type${kinds > 1 ? 's' : ''}</h2>` +
      '<canvas id="orgCanvas"></canvas>' +
      '<p class="muted small">Tap a cell in the drawing to inspect it. Ring = this cell, faint = low energy.</p>' +
      '<div class="legend">' +
      counts
        .map((c, k) => (c ? `<span><i style="background:${TYPE_COLOURS[k]}"></i>${CELL_TYPES[k]} ${c}</span>` : ''))
        .join('') +
      '</div>' +
      `<p class="muted small">Average energy ${pct(energy / org.cells.length)} · ${org.bonds.length} bonds</p>` +
      '<h2>This cell</h2>';
  }
  html += '<table>' + rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join('') + '</table>';
  if (d.genes.length) {
    html += '<h2>Genome</h2><table>';
    d.genes.forEach((g, k) => {
      html += `<tr><td class="muted small">${GENE_NAMES[k]}</td><td><span class="gene" style="width:${Math.max(2, g * 80)}px"></span> ${g.toFixed(2)}</td></tr>`;
    });
    html += '</table>';
  }
  if (d.guests.length) {
    html += '<h2>Guests inside</h2><table>';
    for (const g of d.guests)
      html += `<tr><td><span class="swatch" style="background:${tagCss(g.tag)}"></span>#${g.id}</td><td class="muted small">L/V/E ${pct(g.light)} / ${pct(g.vent)} / ${pct(g.engulf)} · ${g.energy.toFixed(1)} energy</td></tr>`;
    html += '</table>';
  }
  html += '<h2>Ancestors</h2>';
  if (!d.ancestors.length) html += '<p class="muted small">Founding cell, or ancestry older than the lineage window.</p>';
  else {
    html += '<table>';
    for (const a of d.ancestors) {
      const fate = a.died >= 0 ? `died at tick ${a.died}` : 'alive';
      html += `<tr><td><span class="swatch" style="background:${speciesCss(a.species)}"></span>#${a.id} · gen ${a.gen}</td><td class="muted small">${fate}</td></tr>`;
    }
    html += '</table>';
  }
  $('inspBody').innerHTML = html;
  if (org) {
    const c = $<HTMLCanvasElement>('orgCanvas');
    drawOrganism(c, org, TYPE_COLOURS, $('inspBody').clientWidth || 280);
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const id = organismCellAt(e.clientX - r.left, e.clientY - r.top);
      if (id !== null && id !== pond.followId) {
        pond.followId = id;
        send({ type: 'inspect', id });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Settings: live tuning sliders, plus settings that need a restart
// ---------------------------------------------------------------------------

/** Parameters that can change while the pond runs: [key, label, min, max]. */
const LIVE: [keyof Params, string, number, number][] = [
  ['dayLength', 'Day length (ticks)', 300, 12000],
  ['kLight', 'Light gain', 0, 0.4],
  ['lightPerColumn', 'Light per water column', 0.05, 2],
  ['lightHalfDepth', 'Light halves every (units)', 15, 300],
  ['kVent', 'Vent gain', 0, 1.5],
  ['ventRegen', 'Vent refill per tick', 0, 30],
  ['ventCount', 'Vents', 0, 15],
  ['kBasal', 'Basal cost', 0, 0.02],
  ['kSwim', 'Swimming cost', 0, 0.03],
  ['engulfGain', 'Engulf energy gain', 0, 1],
  ['debrisFraction', 'Energy left as debris', 0, 1],
  ['divisionLoss', 'Energy lost dividing', 0, 0.5],
  ['lifespan', 'Lifespan (ticks)', 300, 12000],
  ['mutationStep', 'Mutation step', 0, 0.2],
  ['maxSpeed', 'Top swimming speed', 0, 6],
  ['bondRate', 'Bonding chance', 0, 0.1],
  ['kBond', 'Bond upkeep', 0, 0.02],
  ['shareRate', 'Sharing rate', 0, 0.3],
  ['byproduct', 'By-product per food', 0, 1],
  ['policingWindow', 'Policing window (ticks)', 20, 1000],
  ['guestPass', 'Guest pays host', 0, 1],
  ['kGuest', 'Guest upkeep', 0, 0.01],
  ['fragmentRate', 'Over-size colony split chance', 0, 0.1],
  ['germEnergy', 'Germ cell leaves at energy', 0.3, 1],
  ['gameteLife', 'Sex cell lifetime (ticks)', 50, 3000],
];

/** Parameters that shape the pond itself, applied on restart. */
const RESTART: [keyof Params, string][] = [
  ['startingCells', 'Starting cells'],
  ['startTolerance', 'Starting tolerance (tag distance)'],
  ['cellCap', 'Cell cap'],
  ['ticksPerSecond', 'Ticks per second at 1×'],
  ['ventLifetime', 'Vent lifetime (ticks)'],
  ['energyPerVolume', 'Energy stored per volume'],
  ['maxBonds', 'Bonds per cell'],
  ['maxGuests', 'Guests per host'],
];
const INT_KEYS = new Set<keyof Params>([
  'dayLength',
  'ventCount',
  'lifespan',
  'startingCells',
  'cellCap',
  'policingWindow',
  'maxBonds',
  'maxGuests',
]);

function loadOverrides(): Partial<Params> {
  try {
    return JSON.parse(localStorage.getItem('evoland.params') ?? '{}');
  } catch {
    return {};
  }
}

function saveOverrides(): void {
  try {
    localStorage.setItem('evoland.params', JSON.stringify(overrides));
  } catch {
    // Storage may be unavailable; settings still apply to this run.
  }
}

function setOverride(key: keyof Params, v: number): void {
  const o = overrides as Record<string, number>;
  if (v === DEFAULT_PARAMS[key]) delete o[key];
  else o[key] = v;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(3))));

/** Builds the live sliders in the side panel; changes reach the worker at once. */
function buildTune(): void {
  const box = $('tuneFields');
  box.innerHTML = '';
  for (const [key, label, min, max] of LIVE) {
    const row = document.createElement('label');
    row.className = 'tune';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'value';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = INT_KEYS.has(key) ? '1' : String((max - min) / 200);
    input.value = String(params[key]);
    input.dataset.key = key;
    value.textContent = fmt(params[key]);
    if (params[key] !== DEFAULT_PARAMS[key]) row.classList.add('changed');
    input.addEventListener('input', () => {
      const v = INT_KEYS.has(key) ? Math.round(Number(input.value)) : Number(input.value);
      value.textContent = fmt(v);
      (params as unknown as Record<string, number>)[key] = v;
      setOverride(key, v);
      row.classList.toggle('changed', v !== DEFAULT_PARAMS[key]);
      send({ type: 'params', params: { [key]: v } });
    });
    input.addEventListener('change', saveOverrides);
    // On touch screens a slider stays locked until its name is tapped, so
    // scrolling the panel can't drag it by accident.
    row.addEventListener('click', (e) => {
      if (e.target === input) return;
      e.preventDefault();
      const open = !row.classList.contains('active');
      box.querySelectorAll('label.tune.active').forEach((r) => r.classList.remove('active'));
      row.classList.toggle('active', open);
    });
    row.append(name, value, input);
    box.append(row);
  }
}

$('tuneReset').addEventListener('click', () => {
  const live: Partial<Params> = {};
  for (const [key] of LIVE) {
    setOverride(key, DEFAULT_PARAMS[key]);
    (live as Record<string, number>)[key] = DEFAULT_PARAMS[key];
  }
  params = { ...params, ...live };
  saveOverrides();
  send({ type: 'params', params: live });
  buildTune();
});

function openSettings(): void {
  const box = $('settingsFields');
  box.innerHTML = '';
  for (const [key, label] of RESTART) {
    const l = document.createElement('label');
    l.textContent = label;
    l.htmlFor = `set-${key}`;
    const input = document.createElement('input');
    input.id = `set-${key}`;
    input.type = 'number';
    input.step = 'any';
    input.value = String(params[key]);
    input.placeholder = String(DEFAULT_PARAMS[key]);
    box.append(l, input);
  }
  $<HTMLDialogElement>('settings').showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
$<HTMLDialogElement>('settings').addEventListener('close', () => {
  const choice = $<HTMLDialogElement>('settings').returnValue;
  if (choice === 'apply') {
    for (const [key] of RESTART) {
      const v = Number($<HTMLInputElement>(`set-${key}`).value);
      if (Number.isFinite(v) && v > 0) setOverride(key, v);
    }
  } else if (choice === 'reset') {
    overrides = {};
  } else return;
  saveOverrides();
  start();
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function frame(): void {
  pond.render(speciesColour);
  requestAnimationFrame(frame);
}

start();
requestAnimationFrame(frame);

// Keep the side panels below the top bar, however many rows it wraps to.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--bar-h', `${$('bar').offsetHeight}px`);
}).observe($('bar'));
