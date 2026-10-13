/// <reference lib="webworker" />
/**
 * Runs the World at a fixed tick rate off the main thread and streams
 * frames back. The page only draws.
 */
import { World, bodyCells } from './sim/world';
import { GENE_COUNT, OUTPUTS, SWITCHES, traitsOf } from './sim/genome';
import type { BodyFrame, CellDetail, Frame, FromWorker, OrganismDetail, Stats, ToWorker } from './protocol';

/** Most member cells sent for one organism. */
const ORGANISM_MAX = 256;

declare const self: DedicatedWorkerGlobalScope;

const FRAME_MS = 16;
const STATS_MS = 500;
const INSPECT_MS = 200;
/** Never spend longer than this per loop turn, so messages stay responsive. */
const BUDGET_MS = 30;

let world: World | null = null;
let speed = 1;
let paused = false;
let inspectId: number | null = null;

let owed = 0;
let lastTime = 0;
let lastFrame = 0;
let lastStats = 0;
let lastInspect = 0;
let rateTicks = 0;
let rateStart = 0;
let rate = 0;
let scheduled = false;

const channel = new MessageChannel();
channel.port1.onmessage = () => {
  scheduled = false;
  loop();
};

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      world = new World(m.seed, m.params);
      owed = 0;
      lastTime = performance.now();
      rateStart = lastTime;
      rateTicks = 0;
      inspectId = null;
      post({ type: 'ready', params: world.p });
      sendFrame();
      sendStats();
      schedule(0);
      break;
    case 'speed':
      speed = m.speed;
      break;
    case 'params':
      if (world) Object.assign(world.p, m.params);
      break;
    case 'pause':
      paused = m.paused;
      lastTime = performance.now();
      owed = 0;
      if (!paused) schedule(0);
      break;
    case 'inspect':
      inspectId = m.id;
      if (world && inspectId !== null) sendInspect();
      break;
  }
};

function schedule(delay: number): void {
  if (scheduled) return;
  scheduled = true;
  if (delay <= 0) channel.port2.postMessage(0);
  else
    setTimeout(() => {
      scheduled = false;
      loop();
    }, delay);
}

function loop(): void {
  if (!world || paused) return;
  const w = world;
  const now = performance.now();
  owed += ((now - lastTime) / 1000) * w.p.ticksPerSecond * speed;
  lastTime = now;
  // Don't try to catch up more than a second of backlog.
  owed = Math.min(owed, w.p.ticksPerSecond * speed);

  const start = performance.now();
  let ran = 0;
  while (owed >= 1 && performance.now() - start < BUDGET_MS) {
    w.step();
    owed -= 1;
    ran++;
  }
  rateTicks += ran;
  const t = performance.now();
  if (t - rateStart > 1000) {
    rate = (rateTicks * 1000) / (t - rateStart);
    rateTicks = 0;
    rateStart = t;
  }
  if (ran > 0 && t - lastFrame >= FRAME_MS) sendFrame();
  if (t - lastStats >= STATS_MS) sendStats();
  if (inspectId !== null && t - lastInspect >= INSPECT_MS) sendInspect();

  if (owed >= 1) schedule(0);
  else schedule(Math.max(1, ((1 - owed) * 1000) / (w.p.ticksPerSecond * speed)));
}

function sendFrame(): void {
  const w = world!;
  lastFrame = performance.now();
  w.findColonies();
  const n = w.n;
  const ids = w.id.slice(0, n);
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const tag = new Float32Array(n * 3);
  const feed = new Float32Array(n * 3);
  const energy = new Float32Array(n);
  const G = GENE_COUNT;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = w.x[i];
    pos[i * 3 + 1] = w.y[i];
    pos[i * 3 + 2] = w.z[i];
    vel[i * 3] = w.vx[i];
    vel[i * 3 + 1] = w.vy[i];
    vel[i * 3 + 2] = w.vz[i];
    tag[i * 3] = w.genes[i * G + 5];
    tag[i * 3 + 1] = w.genes[i * G + 6];
    tag[i * 3 + 2] = w.genes[i * G + 7];
    feed[i * 3] = w.shareL[i];
    feed[i * 3 + 1] = w.shareV[i];
    feed[i * 3 + 2] = w.shareE[i];
    energy[i] = w.energy[i] / w.maxE[i];
  }
  // Distinct cell types per colony of 3+ cells, as a bit mask per colony root.
  const masks = new Map<number, number>();
  for (let i = 0; i < n; i++)
    if (w.colonySize[i] >= 3) masks.set(w.colony[i], (masks.get(w.colony[i]) ?? 0) | (1 << w.cellType[i]));
  const colonyTypes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let m = masks.get(w.colony[i]) ?? 0;
    let c = 0;
    for (; m; m &= m - 1) c++;
    colonyTypes[i] = c;
  }
  const bondList: number[] = [];
  for (let i = 0; i < n; i++)
    for (let s = 0; s < w.bondCount[i]; s++) {
      const j = w.bondTo[i * w.mb + s];
      if (j > i && j < n) bondList.push(i, j);
    }
  const bonds = new Uint32Array(bondList);
  const mg = w.mg;
  const guests = w.guestCount.slice(0, n);
  const guestTag = new Float32Array(n * mg * 3);
  for (let i = 0; i < n; i++)
    for (let s = 0; s < guests[i]; s++) {
      const g = (i * mg + s) * G;
      for (let k = 0; k < 3; k++) guestTag[(i * mg + s) * 3 + k] = w.guestGenes[g + 5 + k];
    }
  const debris = new Float32Array(w.nd * 3);
  for (let d = 0; d < w.nd; d++) {
    debris[d * 3] = w.dx[d];
    debris[d * 3 + 1] = w.dy[d];
    debris[d * 3 + 2] = w.dz[d];
  }
  const frame: Frame = {
    type: 'frame',
    tick: w.tick,
    sun: w.sun,
    rate,
    n,
    ids,
    pos,
    vel,
    radius: w.radius.slice(0, n),
    tag,
    feed,
    species: w.species.slice(0, n),
    motility: w.mot.slice(0, n),
    energy,
    bonds,
    colony: Uint32Array.from(w.colony.subarray(0, n), (c) => w.id[c]),
    colonySize: w.colonySize.slice(0, n),
    cellType: w.cellType.slice(0, n),
    colonyTypes,
    guests,
    guestTag,
    maxGuests: mg,
    nd: w.nd,
    debris,
    bodies: w.bodies.map((b): BodyFrame => {
      const t = traitsOf(b.genes);
      return {
        id: b.id,
        x: b.x,
        y: b.y,
        z: b.z,
        radius: b.radius,
        cellRadius: b.cellRadius,
        species: b.species,
        energy: b.energy / (w.p.energyPerVolume * b.cellRadius ** 3 * Math.max(1, bodyCells(b))),
        tag: [b.genes[5], b.genes[6], b.genes[7]],
        feed: [t.light, t.vent, t.engulf],
        parts: b.tissue.flatMap((n, k) =>
          n > 0 ? [{ type: k, n, ox: b.place[k * 3], oy: b.place[k * 3 + 1], oz: b.place[k * 3 + 2] }] : [],
        ),
      };
    }),
    vents: w.vents.map((v) => ({ x: v.x, z: v.z, strength: v.strength, stock: v.stock / w.p.ventStock })),
  };
  post(frame, [
    ids.buffer,
    pos.buffer,
    vel.buffer,
    frame.radius.buffer,
    tag.buffer,
    feed.buffer,
    frame.species.buffer,
    frame.motility.buffer,
    energy.buffer,
    debris.buffer,
    bonds.buffer,
    frame.colony.buffer,
    frame.colonySize.buffer,
    frame.cellType.buffer,
    colonyTypes.buffer,
    guests.buffer,
    guestTag.buffer,
  ]);
}

function sendStats(): void {
  const w = world!;
  lastStats = performance.now();
  const msg: Stats = {
    type: 'stats',
    history: w.history,
    species: w.speciesTracker.list(),
    totalBorn: w.totalBorn,
    engulfed: w.engulfed,
    swaps: w.swaps,
    captured: w.captured,
    policed: w.policed,
    germReleases: w.germReleases,
    fusions: w.fusions,
    bodiesFormed: w.bodiesFormed,
  };
  post(msg);
}

function sendInspect(): void {
  const w = world!;
  lastInspect = performance.now();
  const id = inspectId!;
  const i = w.indexOf(id);
  const rec = w.lineage.get(id);
  const ancestors: CellDetail['ancestors'] = [];
  let p = rec?.parent ?? 0;
  while (p && ancestors.length < 12) {
    const r = w.lineage.get(p);
    if (!r) break;
    ancestors.push({ id: p, ...r });
    p = r.parent;
  }
  let children = 0;
  let descendants = 0;
  for (let k = 0; k < w.n; k++) {
    if (w.parent[k] === id) children++;
    let a = w.parent[k];
    for (let depth = 0; a && depth < 12; depth++) {
      if (a === id) {
        descendants++;
        break;
      }
      a = w.lineage.get(a)?.parent ?? 0;
    }
  }
  const body = i < 0 ? w.bodies.find((b) => b.id === id) : undefined;
  if (body) {
    const t = traitsOf(body.genes);
    post({
      type: 'inspectBody',
      id,
      alive: true,
      species: body.species,
      generation: body.gen,
      age: body.age,
      lifespan: body.lifespan,
      energy: body.energy,
      maxEnergy: w.p.energyPerVolume * body.cellRadius ** 3 * bodyCells(body!),
      cells: bodyCells(body!),
      adult: body.adult,
      radius: body.radius,
      tissue: body.tissue.slice(),
      genes: Array.from(body.genes),
      traits: t,
      ancestors,
    });
    return;
  }
  if (i < 0) {
    // Dead: send what the lineage remembers so the panel can say so.
    post({
      type: 'inspect',
      id,
      alive: false,
      species: rec?.species ?? -1,
      generation: rec?.gen ?? 0,
      age: rec && rec.died >= 0 ? rec.died - rec.born : 0,
      lifespan: 0,
      energy: 0,
      maxEnergy: 0,
      genes: [],
      traits: traitsOf(new Float32Array(GENE_COUNT)),
      ancestors,
      children,
      descendants,
      pos: [0, 0, 0],
      bonds: 0,
      colonySize: 0,
      gave: 0,
      got: 0,
      guests: [],
      cellType: 0,
      switches: [],
      outputs: [],
      gamete: 0,
      stage: 0,
      organism: null,
    });
    return;
  }
  const g = Array.from(w.genes.subarray(i * GENE_COUNT, (i + 1) * GENE_COUNT));
  post({
    type: 'inspect',
    id,
    alive: true,
    species: w.species[i],
    generation: w.gen[i],
    age: w.age[i],
    lifespan: w.lifespan[i],
    energy: w.energy[i],
    maxEnergy: w.maxE[i],
    genes: g,
    traits: traitsOf(g),
    ancestors,
    children,
    descendants,
    pos: [w.x[i], w.y[i], w.z[i]],
    bonds: w.bondCount[i],
    colonySize: w.colonySize[i],
    gave: w.gaveTotal[i],
    got: w.gotTotal[i],
    cellType: w.cellType[i],
    switches: Array.from(w.sw.subarray(i * SWITCHES, (i + 1) * SWITCHES)),
    outputs: Array.from(w.out.subarray(i * OUTPUTS, (i + 1) * OUTPUTS)),
    gamete: w.gamete[i],
    stage: w.stage[i],
    organism: organismOf(w, i),
    guests: Array.from({ length: w.guestCount[i] }, (_, s) => {
      const g = i * w.mg + s;
      const t = traitsOf(w.guestGenes, g * GENE_COUNT);
      const o = g * GENE_COUNT;
      return {
        id: w.guestId[g],
        energy: w.guestEnergy[g],
        light: t.light,
        vent: t.vent,
        engulf: t.engulf,
        tag: [w.guestGenes[o + 5], w.guestGenes[o + 6], w.guestGenes[o + 7]] as [number, number, number],
      };
    }),
  });
}

/** Walks the bonds out from cell i to collect its whole organism. */
function organismOf(w: World, i: number): OrganismDetail | null {
  if (w.bondCount[i] === 0) return null;
  const index = new Map<number, number>([[i, 0]]);
  const order = [i];
  const bonds: [number, number][] = [];
  let truncated = false;
  for (let k = 0; k < order.length; k++) {
    const a = order[k];
    for (let s = 0; s < w.bondCount[a]; s++) {
      const b = w.bondTo[a * w.mb + s];
      let j = index.get(b);
      if (j === undefined) {
        if (order.length >= ORGANISM_MAX) {
          truncated = true;
          continue;
        }
        j = order.length;
        index.set(b, j);
        order.push(b);
      }
      if (k < j) bonds.push([k, j]);
    }
  }
  return {
    cells: order.map((c) => ({
      id: w.id[c],
      type: w.cellType[c],
      energy: w.energy[c] / w.maxE[c],
      radius: w.radius[c],
      motility: w.mot[c],
      x: w.x[c],
      y: w.y[c],
      z: w.z[c],
    })),
    bonds,
    truncated,
  };
}
