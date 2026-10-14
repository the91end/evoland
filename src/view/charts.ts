import type { StatsSample } from '../sim/world';
import type { SpeciesInfo } from '../sim/species';

const FEED = ['#e8d94a', '#f0703a', '#b06cf0'];
const DEBRIS = '#8a7a66';
const GRID = 'rgba(140,200,230,0.15)';
const TEXT = '#86a7b8';
const TOP_SPECIES = 8;

function setup(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio, 2);
  // Pin the CSS size so a high-DPI backing store never grows the element.
  const h = Number(canvas.dataset.h ?? (canvas.dataset.h = canvas.getAttribute('height') ?? '120'));
  canvas.style.height = `${h}px`;
  const w = canvas.clientWidth;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

function axes(g: CanvasRenderingContext2D, w: number, h: number, maxY: number, lastTick: number): void {
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k <= 3; k++) {
    const y = Math.round(h - (h * k) / 4) + 0.5;
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  g.fillStyle = TEXT;
  g.font = '10px system-ui, sans-serif';
  g.textBaseline = 'top';
  g.fillText(String(Math.round(maxY)), 2, 2);
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(`tick ${lastTick}`, w - 2, h - 2);
  g.textAlign = 'left';
}

/** Stacked area of the biggest species over time, the rest grouped as "other". */
export function drawPopulation(
  canvas: HTMLCanvasElement,
  history: StatsSample[],
  species: SpeciesInfo[],
  colour: (id: number) => string,
): void {
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (history.length < 2) return;
  const top = species
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_SPECIES)
    .map((s) => s.id);
  const maxY = Math.max(1, ...history.map((s) => s.cells)) * 1.05;
  const x = (k: number) => (k / (history.length - 1)) * w;
  const y = (v: number) => h - (v / maxY) * h;

  const base = new Float64Array(history.length);
  const layers = [...top, -999];
  for (const id of layers) {
    const vals = history.map((s) => {
      if (id === -999) {
        let other = s.cells;
        for (const t of top) other -= s.species[t] ?? 0;
        return Math.max(0, other);
      }
      return s.species[id] ?? 0;
    });
    g.beginPath();
    for (let k = 0; k < history.length; k++) g.lineTo(x(k), y(base[k] + vals[k]));
    for (let k = history.length - 1; k >= 0; k--) g.lineTo(x(k), y(base[k]));
    g.closePath();
    g.fillStyle = id === -999 ? 'rgba(134,167,184,0.35)' : colour(id);
    g.fill();
    for (let k = 0; k < history.length; k++) base[k] += vals[k];
  }
  axes(g, w, h, maxY, history[history.length - 1].tick);
}

export const COLONY_SERIES: [keyof StatsSample, string, string][] = [
  ['bonded', 'Cells in colonies', '#5fd3c6'],
  ['biggestColony', 'Biggest colony', '#e9f6ff'],
  ['mixedColonies', 'Mixed-species colonies', '#f0a3d8'],
  ['cheaters', 'Cheaters', '#ff5d5d'],
  ['guests', 'Guests inside hosts', '#9be36b'],
  ['bodies', 'Big organisms', '#ffd166'],
];

/** Colonies, partnerships, cheaters and guests over time. */
export function drawColonies(canvas: HTMLCanvasElement, history: StatsSample[]): void {
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const hist = history.filter((s) => s.bonded !== undefined);
  if (hist.length < 2) return;
  const maxY = Math.max(1, ...hist.map((s) => Math.max(...COLONY_SERIES.map(([k]) => (s[k] as number) ?? 0)))) * 1.05;
  const x = (k: number) => (k / (hist.length - 1)) * w;
  const y = (v: number) => h - (v / maxY) * h;
  for (const [key, , col] of COLONY_SERIES) {
    g.beginPath();
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    for (let k = 0; k < hist.length; k++) g.lineTo(x(k), y((hist[k][key] as number) ?? 0));
    g.stroke();
  }
  axes(g, w, h, maxY, hist[hist.length - 1].tick);
}

/** Stacked area of living cells by cell type. */
export function drawTypes(canvas: HTMLCanvasElement, history: StatsSample[], colours: string[]): void {
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const hist = history.filter((s) => s.types !== undefined);
  if (hist.length < 2) return;
  const maxY = Math.max(1, ...hist.map((s) => s.cells)) * 1.05;
  const x = (k: number) => (k / (hist.length - 1)) * w;
  const y = (v: number) => h - (v / maxY) * h;
  const base = new Float64Array(hist.length);
  for (let t = 0; t < colours.length; t++) {
    g.beginPath();
    for (let k = 0; k < hist.length; k++) g.lineTo(x(k), y(base[k] + hist[k].types[t]));
    for (let k = hist.length - 1; k >= 0; k--) g.lineTo(x(k), y(base[k]));
    g.closePath();
    g.fillStyle = colours[t];
    g.globalAlpha = t === 0 ? 0.35 : 0.9;
    g.fill();
    for (let k = 0; k < hist.length; k++) base[k] += hist[k].types[t];
  }
  g.globalAlpha = 1;
  axes(g, w, h, maxY, hist[hist.length - 1].tick);
}

/** Lines for cells by main feeding mode, plus debris. */
export function drawFeeding(canvas: HTMLCanvasElement, history: StatsSample[]): void {
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (history.length < 2) return;
  const maxY = Math.max(1, ...history.map((s) => Math.max(s.light, s.vent, s.engulf, s.debris))) * 1.05;
  const x = (k: number) => (k / (history.length - 1)) * w;
  const y = (v: number) => h - (v / maxY) * h;

  // Night bands.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let k = 0; k < history.length; k++) {
    if (history[k].sun === 0) g.fillRect(x(k), 0, Math.max(1, w / history.length), h);
  }
  const series: [keyof StatsSample, string][] = [
    ['debris', DEBRIS],
    ['light', FEED[0]],
    ['vent', FEED[1]],
    ['engulf', FEED[2]],
  ];
  for (const [key, col] of series) {
    g.beginPath();
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    for (let k = 0; k < history.length; k++) g.lineTo(x(k), y(history[k][key] as number));
    g.stroke();
  }
  axes(g, w, h, maxY, history[history.length - 1].tick);
}

/** Species shown in the family tree: alive, with living descendants, or once common. */
const TREE_MIN_PEAK = 30;
const TREE_MAX_ROWS = 80;

/**
 * Family tree over time: each species is a line from when it split off to
 * when it died out (or now), joined to its parent where it split. A thicker,
 * outlined stretch marks when most of its cells lived in colonies, and the
 * first species to get there is labelled.
 */
export function drawFamilyTree(
  canvas: HTMLCanvasElement,
  all: SpeciesInfo[],
  now: number,
  colour: (id: number) => string,
): void {
  const children = new Map<number, SpeciesInfo[]>();
  for (const s of all) {
    const list = children.get(s.parent) ?? [];
    list.push(s);
    children.set(s.parent, list);
  }
  const keep = new Map<number, boolean>();
  const kept = (s: SpeciesInfo): boolean => {
    let v = keep.get(s.id);
    if (v === undefined) {
      v = s.count > 0 || s.peak >= TREE_MIN_PEAK;
      for (const c of children.get(s.id) ?? []) v = kept(c) || v;
      keep.set(s.id, v);
    }
    return v;
  };
  const rows: SpeciesInfo[] = [];
  const walk = (s: SpeciesInfo) => {
    if (!kept(s) || rows.length >= TREE_MAX_ROWS) return;
    rows.push(s);
    for (const c of (children.get(s.id) ?? []).sort((a, b) => a.born - b.born)) walk(c);
  };
  for (const root of (children.get(0) ?? []).sort((a, b) => a.born - b.born)) walk(root);

  const rowH = Math.max(4, Math.min(12, 220 / Math.max(1, rows.length)));
  canvas.setAttribute('height', String(Math.max(60, Math.round(rows.length * rowH + 26))));
  delete canvas.dataset.h;
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!rows.length) return;
  const t0 = Math.min(...rows.map((s) => s.born));
  const span = Math.max(1, now - t0);
  const x = (t: number) => 4 + ((t - t0) / span) * (w - 8);
  const rowOf = new Map(rows.map((s, k) => [s.id, k]));
  const y = (k: number) => 6 + k * rowH + rowH / 2;

  // Splits: a thin line down from the parent at the moment of the split.
  g.strokeStyle = 'rgba(140,200,230,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  for (const s of rows) {
    const pk = rowOf.get(s.parent);
    if (pk === undefined) continue;
    const k = rowOf.get(s.id)!;
    g.moveTo(Math.round(x(s.born)) + 0.5, y(pk));
    g.lineTo(Math.round(x(s.born)) + 0.5, y(k));
  }
  g.stroke();

  let first: SpeciesInfo | null = null;
  g.lineCap = 'round';
  rows.forEach((s, k) => {
    const end = s.count > 0 || s.extinct < 0 ? now : s.extinct;
    const thick = Math.max(1.5, Math.min(rowH - 1, 1 + Math.log2(1 + s.peak) * 0.6));
    g.globalAlpha = s.count > 0 ? 1 : 0.45;
    g.strokeStyle = colour(s.id);
    g.lineWidth = thick;
    g.beginPath();
    g.moveTo(x(s.born), y(k));
    g.lineTo(Math.max(x(s.born) + 1, x(end)), y(k));
    g.stroke();
    const since = s.multiSince ?? -1;
    if (since >= 0) {
      if (!first || since < (first.multiSince ?? -1)) first = s;
      g.strokeStyle = '#e9f6ff';
      g.lineWidth = Math.min(rowH, thick + 2);
      g.globalAlpha *= 0.9;
      g.beginPath();
      g.moveTo(x(since), y(k));
      g.lineTo(Math.max(x(since) + 2, x(end)), y(k));
      g.stroke();
      g.strokeStyle = colour(s.id);
      g.lineWidth = thick;
      g.stroke();
    }
  });
  g.globalAlpha = 1;
  g.lineCap = 'butt';
  const f = first as SpeciesInfo | null;
  if (f) {
    const k = rowOf.get(f.id)!;
    const fx = x(f.multiSince);
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(fx, y(k), 3.5, 0, Math.PI * 2);
    g.fill();
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(`● first multicellular: #${f.id}, tick ${f.multiSince}`, w / 2, h - 2);
  }
  g.fillStyle = TEXT;
  g.font = '10px system-ui, sans-serif';
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(`tick ${now}`, w - 2, h - 2);
  g.textAlign = 'left';
  g.fillText(`tick ${t0}`, 2, h - 2);
}
