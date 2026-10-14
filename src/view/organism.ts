import type { OrganismDetail } from '../protocol';
import { FLAGELLUM_MIN } from './pond';

type V3 = { x: number; y: number; z: number };

/** Remembered 3D layout per cell id, so the drawing stays steady between updates. */
const layout = new Map<number, V3>();
/** Screen positions of the last drawing, nearest last, for tapping a cell. */
let hit: { id: number; x: number; y: number; r: number }[] = [];

/** How the viewer has turned and zoomed the drawing; kept while the same organism is shown. */
const view = { rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], zoom: 1, panX: 0, panY: 0 };
function resetView(): void {
  Object.assign(view, { rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], zoom: 1, panX: 0, panY: 0 });
  turn(0.5, 0.35);
}
resetView();

/**
 * Turns the organism about the screen's up axis by `yaw` and then its
 * sideways axis by `pitch`. Turning always happens relative to the screen,
 * so no angle ever runs into a limit.
 */
function turn(yaw: number, pitch: number): void {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rows of (pitch about x) times (yaw about y).
  const t = [cy, 0, -sy, -sp * sy, cp, -sp * cy, cp * sy, sp, cp * cy];
  const r = view.rot;
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = t[i * 3] * r[j] + t[i * 3 + 1] * r[3 + j] + t[i * 3 + 2] * r[6 + j];
  // Keep the rows unit length and square to each other so rounding never skews it.
  const row = (i: number) => out.slice(i * 3, i * 3 + 3);
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((x) => x / l);
  };
  const a = norm(row(0));
  let b = row(1);
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  b = norm(b.map((x, k) => x - d * a[k]));
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  view.rot = [...a, ...b, ...c];
}

/** The last thing drawn, so turning and zooming can redraw without new data. */
let last: { org: OrganismDetail; colours: string[]; pos: V3[]; width: number } | null = null;
let onTap: (id: number) => void = () => {};

/**
 * One canvas reused across inspector updates, so a drag or pinch is not cut
 * off when the panel refreshes. Drag turns the organism, wheel or pinch
 * zooms toward the pointer, double click resets the view, and a tap on a
 * cell calls the tap handler.
 */
const canvas = document.createElement('canvas');
canvas.id = 'orgCanvas';
canvas.style.touchAction = 'none';
canvas.style.cursor = 'grab';
const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let pinch: { d: number; mx: number; my: number } | null = null;

function local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Zooms by a factor while keeping the point (x, y) on the canvas still. */
function zoomAt(x: number, y: number, factor: number): void {
  const next = Math.max(0.3, Math.min(12, view.zoom * factor));
  const f = next / view.zoom;
  const px = x - canvas.clientWidth / 2;
  const py = y - canvas.clientHeight / 2;
  view.panX = px - (px - view.panX) * f;
  view.panY = py - (py - view.panY) * f;
  view.zoom = next;
}

function pinchState(): { d: number; mx: number; my: number } {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

// Moves and releases are heard on the window: the inspector rebuilds its
// contents while a drag goes on, which would drop a pointer capture.
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  // A first finger or mouse press starts a new gesture: forget any pointer
  // whose release never reached us (let go outside the window, or a touch
  // the browser dropped), or it would leave the view stuck mid pinch.
  if (e.isPrimary) {
    pointers.clear();
    pinch = null;
  }
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 1) dragged = false;
  if (pointers.size === 2) {
    pinch = pinchState();
    dragged = true;
  }
  canvas.style.cursor = 'grabbing';
});
window.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  // A mouse with no button held has been let go somewhere we did not hear.
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    release(e);
    return;
  }
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size >= 2 && pinch) {
    const now = pinchState();
    view.panX += now.mx - pinch.mx;
    view.panY += now.my - pinch.my;
    zoomAt(now.mx, now.my, now.d / pinch.d);
    pinch = now;
  } else {
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (!dragged && Math.hypot(dx, dy) < 3) {
      pointers.set(e.pointerId, prev);
      return;
    }
    dragged = true;
    turn(dx * 0.01, dy * 0.01);
  }
  render();
});
function release(e: PointerEvent): void {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    canvas.style.cursor = 'grab';
    if (!dragged && e.type === 'pointerup') {
      const p = local(e);
      const id = organismCellAt(p.x, p.y);
      if (id !== null) onTap(id);
    }
  }
}
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('blur', () => {
  pointers.clear();
  pinch = null;
  canvas.style.cursor = 'grab';
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    render();
  },
  { passive: false },
);
canvas.addEventListener('dblclick', () => {
  resetView();
  render();
});

/** The organism canvas and the handler for tapping one of its cells. */
export function organismCanvas(tap: (id: number) => void): HTMLCanvasElement {
  onTap = tap;
  return canvas;
}

/**
 * Lays an organism out in 3D and draws it: one ball per cell in its cell
 * type colour (brighter when fuller), packed so bonded cells touch, with a
 * bright wall where each bond joins two cells and a ring on the inspected
 * cell. A small spring layout keeps bonded cells together; new cells start
 * where they really sit relative to their neighbours.
 */
export function drawOrganism(org: OrganismDetail, colours: string[], width: number): void {
  const cells = org.cells;
  const n = cells.length;
  // A different organism gets a fresh view.
  if (!cells.some((c) => layout.has(c.id))) resetView();
  // Typical bond length in the pond, to turn real offsets into layout units.
  let realBond = 0;
  for (const [a, b] of org.bonds)
    realBond += Math.hypot(cells[b].x - cells[a].x, cells[b].y - cells[a].y, cells[b].z - cells[a].z);
  realBond = org.bonds.length && realBond > 0 ? realBond / org.bonds.length : 1;
  const anyPlaced = cells.some((c) => layout.has(c.id));
  const pos: V3[] = cells.map((c, k) => {
    const old = layout.get(c.id);
    if (old) return { ...old };
    if (!anyPlaced)
      return { x: (c.x - cells[0].x) / realBond, y: (c.y - cells[0].y) / realBond, z: (c.z - cells[0].z) / realBond };
    // New cells start beside a bonded cell that already has a place, on the side they really are.
    const link = org.bonds.find(([a, b]) => (a === k && layout.has(cells[b].id)) || (b === k && layout.has(cells[a].id)));
    const other = link ? (link[0] === k ? link[1] : link[0]) : -1;
    const base = other >= 0 ? layout.get(cells[other].id)! : { x: 0, y: 0, z: 0 };
    let dx = other >= 0 ? c.x - cells[other].x : Math.cos(k * 2.4);
    let dy = other >= 0 ? c.y - cells[other].y : Math.sin(k * 2.4);
    let dz = other >= 0 ? c.z - cells[other].z : Math.cos(k * 1.3);
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) [dx, dy, dz] = [Math.cos(k * 2.4), Math.sin(k * 2.4), 0.3];
    const s = 0.8 / (Math.hypot(dx, dy, dz) || 1);
    return { x: base.x + dx * s, y: base.y + dy * s, z: base.z + dz * s };
  });
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);
  for (let it = 0; it < 60; it++) {
    fx.fill(0);
    fy.fill(0);
    fz.fill(0);
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const dx = pos[b].x - pos[a].x;
        const dy = pos[b].y - pos[a].y;
        const dz = pos[b].z - pos[a].z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = 0.3 / d2;
        fx[a] -= dx * f;
        fy[a] -= dy * f;
        fz[a] -= dz * f;
        fx[b] += dx * f;
        fy[b] += dy * f;
        fz[b] += dz * f;
      }
    for (const [a, b] of org.bonds) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const dz = pos[b].z - pos[a].z;
      const d = Math.hypot(dx, dy, dz) || 0.01;
      const f = (0.5 * (d - 1)) / d;
      fx[a] += dx * f;
      fy[a] += dy * f;
      fz[a] += dz * f;
      fx[b] -= dx * f;
      fy[b] -= dy * f;
      fz[b] -= dz * f;
    }
    const clamp = (v: number) => Math.max(-0.3, Math.min(0.3, v * 0.3));
    for (let k = 0; k < n; k++) {
      pos[k].x += clamp(fx[k]);
      pos[k].y += clamp(fy[k]);
      pos[k].z += clamp(fz[k]);
    }
  }
  cells.forEach((c, k) => layout.set(c.id, pos[k]));
  if (layout.size > 4000) layout.clear();
  last = { org, colours, pos, width };
  render();
}

/** Draws the last organism with the current turn and zoom. */
function render(): void {
  if (!last) return;
  const { org, colours, pos, width } = last;
  const cells = org.cells;
  const n = cells.length;
  const h = Math.max(160, Math.min(300, width * 0.8));
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Turn about the middle of the body; size by its bounding ball so turning never rescales it.
  const mx = pos.reduce((s, p) => s + p.x, 0) / n;
  const my = pos.reduce((s, p) => s + p.y, 0) / n;
  const mz = pos.reduce((s, p) => s + p.z, 0) / n;
  let reach = 0;
  for (const p of pos) reach = Math.max(reach, Math.hypot(p.x - mx, p.y - my, p.z - mz));
  let bondLen = 0;
  for (const [a, b] of org.bonds) bondLen += Math.hypot(pos[b].x - pos[a].x, pos[b].y - pos[a].y, pos[b].z - pos[a].z);
  bondLen = org.bonds.length ? bondLen / org.bonds.length : 1;
  const pad = 6;
  const span = 1.15 * bondLen;
  const fit = Math.min((width - 2 * pad) / (2 * reach + span), (h - 2 * pad) / (2 * reach + span), 44 / bondLen);
  const scale = fit * view.zoom;
  const m = view.rot;
  const eye = 4 * (reach + bondLen);
  // Screen x, y, a perspective factor, and depth toward the viewer (-1 far to +1 near).
  const proj = pos.map((p) => {
    const x0 = p.x - mx;
    const y0 = p.y - my;
    const z0 = p.z - mz;
    const x1 = m[0] * x0 + m[1] * y0 + m[2] * z0;
    const y2 = m[3] * x0 + m[4] * y0 + m[5] * z0;
    const z2 = m[6] * x0 + m[7] * y0 + m[8] * z0;
    const f = eye / Math.max(eye * 0.2, eye - z2);
    return {
      x: width / 2 + view.panX + x1 * scale * f,
      y: h / 2 + view.panY - y2 * scale * f,
      f,
      depth: reach > 0 ? z2 / (reach + bondLen) : 0,
      vx: x1,
      vy: y2,
    };
  });
  const unit = 0.6 * bondLen * scale;
  const rad = (k: number) => unit * proj[k].f * (0.85 + 0.15 * (cells[k].radius / 4));

  // Bonds by cell, drawn with the nearer of their two cells.
  const bondsOf: number[][] = cells.map(() => []);
  org.bonds.forEach(([a, b], i) => {
    const near = proj[a].depth >= proj[b].depth ? a : b;
    bondsOf[near].push(i);
  });
  const order = cells.map((_, k) => k).sort((a, b) => proj[a].depth - proj[b].depth);

  hit = [];
  g.lineCap = 'round';
  for (const k of order) {
    const c = cells[k];
    const p = proj[k];
    const r = rad(k);
    // Flagellum, pointing away from the body's middle, behind its cell.
    if (c.motility >= FLAGELLUM_MIN) {
      let dx = p.vx;
      let dy = -p.vy;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) [dx, dy] = [0, 1];
      else [dx, dy] = [dx / d, dy / d];
      const len = r * (1.2 + 2.5 * c.motility);
      g.strokeStyle = 'rgba(207,233,242,0.85)';
      g.lineWidth = (1 + 1.5 * c.motility) * Math.min(2, p.f * view.zoom ** 0.5);
      g.beginPath();
      g.moveTo(p.x + dx * r, p.y + dy * r);
      // A gentle wave so it reads as a flagellum, not a stick.
      g.quadraticCurveTo(
        p.x + dx * (r + len * 0.5) - dy * len * 0.25,
        p.y + dy * (r + len * 0.5) + dx * len * 0.25,
        p.x + dx * (r + len),
        p.y + dy * (r + len),
      );
      g.stroke();
    }
    // Cell body: a lit ball with a membrane edge, dimmer further back.
    g.globalAlpha = 0.45 + 0.55 * c.energy;
    g.fillStyle = colours[c.type];
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    const shine = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.05, p.x, p.y, r);
    shine.addColorStop(0, 'rgba(255,255,255,0.35)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(0,10,20,0.35)');
    g.fillStyle = shine;
    g.fill();
    const fog = Math.max(0, Math.min(0.5, 0.25 - 0.25 * p.depth));
    if (fog > 0.01) {
      g.fillStyle = `rgba(6,20,30,${fog.toFixed(3)})`;
      g.fill();
    }
    g.strokeStyle = 'rgba(220,240,250,0.35)';
    g.lineWidth = 1;
    g.stroke();
    hit.push({ id: c.id, x: p.x, y: p.y, r: r + 2 });
    // Bonds are the shared walls where two touching cells meet; they fade when seen end on.
    for (const i of bondsOf[k]) {
      const [a, b] = org.bonds[i];
      const dx = proj[b].x - proj[a].x;
      const dy = proj[b].y - proj[a].y;
      const d = Math.hypot(dx, dy) || 1;
      const full = Math.hypot(pos[b].x - pos[a].x, pos[b].y - pos[a].y, pos[b].z - pos[a].z) * scale;
      const side = full > 0 ? Math.min(1, d / (full * ((proj[a].f + proj[b].f) / 2))) : 1;
      const half = 0.75 * Math.min(rad(a), rad(b));
      const t = rad(a) / (rad(a) + rad(b));
      const wx = proj[a].x + dx * t;
      const wy = proj[a].y + dy * t;
      g.strokeStyle = `rgba(225,245,255,${(0.9 * side).toFixed(3)})`;
      g.lineWidth = Math.max(1.5, unit * 0.12);
      g.beginPath();
      g.moveTo(wx - (dy / d) * half, wy + (dx / d) * half);
      g.lineTo(wx + (dy / d) * half, wy - (dx / d) * half);
      g.stroke();
    }
    // Ring on the inspected cell.
    if (k === 0) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** The cell id under a point on the organism drawing (the nearest one), or null. */
export function organismCellAt(x: number, y: number): number | null {
  for (let i = hit.length - 1; i >= 0; i--) {
    const p = hit[i];
    if (Math.hypot(p.x - x, p.y - y) < p.r) return p.id;
  }
  return null;
}
