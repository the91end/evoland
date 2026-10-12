import type { OrganismDetail } from '../protocol';

/** Remembered 2D layout per cell id, so the drawing stays steady between updates. */
const layout = new Map<number, { x: number; y: number }>();
/** Screen positions of the last drawing, for tapping a cell. */
let hit: { id: number; x: number; y: number; r: number }[] = [];

/**
 * Draws an organism as a flat map: one dot per cell in its cell type
 * colour (brighter when fuller), lines for bonds, and a ring on the
 * inspected cell. A small spring layout keeps bonded cells together.
 */
export function drawOrganism(canvas: HTMLCanvasElement, org: OrganismDetail, colours: string[], width: number): void {
  const cells = org.cells;
  const n = cells.length;
  const pos = cells.map((c, k) => {
    const old = layout.get(c.id);
    if (old) return { ...old };
    // New cells start beside a bonded cell that already has a place.
    const link = org.bonds.find(([a, b]) => (a === k && layout.has(cells[b].id)) || (b === k && layout.has(cells[a].id)));
    const other = link ? (link[0] === k ? link[1] : link[0]) : -1;
    const base = other >= 0 ? layout.get(cells[other].id)! : { x: 0, y: 0 };
    return { x: base.x + Math.cos(k * 2.4) * 0.8, y: base.y + Math.sin(k * 2.4) * 0.8 };
  });
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let it = 0; it < 60; it++) {
    fx.fill(0);
    fy.fill(0);
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const dx = pos[b].x - pos[a].x;
        const dy = pos[b].y - pos[a].y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = 0.3 / d2;
        fx[a] -= dx * f;
        fy[a] -= dy * f;
        fx[b] += dx * f;
        fy[b] += dy * f;
      }
    for (const [a, b] of org.bonds) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (0.5 * (d - 1)) / d;
      fx[a] += dx * f;
      fy[a] += dy * f;
      fx[b] -= dx * f;
      fy[b] -= dy * f;
    }
    for (let k = 0; k < n; k++) {
      pos[k].x += Math.max(-0.3, Math.min(0.3, fx[k] * 0.3));
      pos[k].y += Math.max(-0.3, Math.min(0.3, fy[k] * 0.3));
    }
  }
  cells.forEach((c, k) => layout.set(c.id, pos[k]));
  if (layout.size > 4000) layout.clear();

  const h = Math.max(140, Math.min(260, width * 0.75));
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pos) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 14;
  const scale = Math.min((width - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxY - minY), 40);
  const ox = width / 2 - ((minX + maxX) / 2) * scale;
  const oy = h / 2 - ((minY + maxY) / 2) * scale;
  const sx = (k: number) => ox + pos[k].x * scale;
  const sy = (k: number) => oy + pos[k].y * scale;
  const dot = Math.max(3, Math.min(9, scale * 0.35));

  g.strokeStyle = 'rgba(160,210,230,0.45)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (const [a, b] of org.bonds) {
    g.moveTo(sx(a), sy(a));
    g.lineTo(sx(b), sy(b));
  }
  g.stroke();
  hit = [];
  cells.forEach((c, k) => {
    const r = dot * (0.6 + 0.4 * (c.radius / 4));
    g.globalAlpha = 0.45 + 0.55 * c.energy;
    g.fillStyle = colours[c.type];
    g.beginPath();
    g.arc(sx(k), sy(k), r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    if (k === 0) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(k), sy(k), r + 3, 0, Math.PI * 2);
      g.stroke();
    }
    hit.push({ id: c.id, x: sx(k), y: sy(k), r: r + 4 });
  });
}

/** The cell id under a point on the organism drawing, or null. */
export function organismCellAt(x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const p of hit) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < p.r && d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
