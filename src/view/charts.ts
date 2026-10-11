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
];

/** Colonies, partnerships, cheaters and guests over time. */
export function drawColonies(canvas: HTMLCanvasElement, history: StatsSample[]): void {
  const g = setup(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const hist = history.filter((s) => s.bonded !== undefined);
  if (hist.length < 2) return;
  const maxY = Math.max(1, ...hist.map((s) => Math.max(...COLONY_SERIES.map(([k]) => s[k] as number)))) * 1.05;
  const x = (k: number) => (k / (hist.length - 1)) * w;
  const y = (v: number) => h - (v / maxY) * h;
  for (const [key, , col] of COLONY_SERIES) {
    g.beginPath();
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    for (let k = 0; k < hist.length; k++) g.lineTo(x(k), y(hist[k][key] as number));
    g.stroke();
  }
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
