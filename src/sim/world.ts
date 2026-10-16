import { DEFAULT_PARAMS, type Params } from './params';
import { Rng, hashSeed } from './rng';
import {
  CELL_TYPES,
  EGG_STATE,
  GENE_COUNT,
  Gene,
  OUTPUTS,
  Output,
  SWITCHES,
  cellTypeOf,
  efficiency,
  recombine,
  runSwitches,
  mutate,
  swapGenes,
  lifeFactorOf,
  tagDistance,
  traitsOf,
} from './genome';
import { Species, type SpeciesInfo } from './species';

/** Chance per tick that touching friends swap genes, scaled by the swap gene. */
const FRIEND_SWAP_RATE = 0.002;
/** Chance that absorbing debris picks up its genes, scaled by the swap gene. */
const DEBRIS_SWAP_RATE = 0.05;
/** Turns a food-gain gradient (energy per tick per unit) into swimming urge. */
const GRADIENT_GAIN = 300;
/** Ticks an engulfer waits between attempts. */
const ENGULF_COOLDOWN = 20;
/** An engulfer must be this much bigger than its prey. */
const ENGULF_SIZE_RATIO = 1.1;
const DEBRIS_SINK = 0.05;
const DEBRIS_DECAY = 0.998;
const DEBRIS_MAX_AGE = 2000;
const STATS_EVERY = 50;
const STATS_MAX = 1200;
const LINEAGE_DEPTH = 12;
/** A bond snaps when stretched past this many times its rest length. */
const BOND_SNAP = 4;
/** Policing cells review their bonds this often. */
const POLICE_EVERY = 50;
/** Of a by-product, the share that goes straight to bonded partners. */
const BOND_BYPRODUCT = 0.7;
/** By-products left in the water fade this much per tick. */
const BYPRODUCT_DECAY = 0.85;
/** Share of the local by-product pool a cell can take per tick. */
const BYPRODUCT_ABSORB = 0.1;
/** Share of an engulfed cell's energy left over as debris. */
const ENGULF_DEBRIS = 0.1;
/** A cell counts as a cheater when it got back this many times what it gave. */
const CHEAT_RATIO = 2;
/** A cell type's outputs must pass this to count: dividing below -0.2 stops division. */
const NO_DIVIDE = -0.2;
/** Ticks between steps of the slow climate and volcanism drift. */
const CLIMATE_EVERY = 100;
/** Ticks a cell that just left its colony stays unable to bond. */
const LEAVE_TICKS = 200;
/** Cell type index of sex cells and germ cells. */
const SEX_TYPE = CELL_TYPES.length - 1;
const GERM_TYPE = Output.Germ + 1;

export interface Vent {
  x: number;
  z: number;
  born: number;
  life: number;
  stock: number;
  /** 0..1, ramps up after opening and fades before closing. */
  strength: number;
}

/**
 * A big organism. Past bodyThreshold cells a body stops being simulated
 * cell by cell and becomes a few tissues, one per cell type, each with a
 * cell count, the switch outputs its cells had, and where in the body it
 * sits. It keeps growing by the same genes, and its only way to have
 * offspring is to release germ cells that start again from one cell.
 */
export interface Body {
  id: number;
  /** Id of the cell whose body this was when it turned big. */
  founder: number;
  species: number;
  gen: number;
  genes: Float32Array;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Cells per tissue, in CELL_TYPES order. */
  tissue: number[];
  /** Mean switch outputs per tissue (OUTPUTS per tissue). */
  out: Float32Array;
  /** Where each tissue sits, as an offset from the centre in body radii. */
  place: Float32Array;
  energy: number;
  age: number;
  lifespan: number;
  growCd: number;
  germCd: number;
  biteCd: number;
  /** Cell radius from the genes, and the body's own radius. */
  cellRadius: number;
  radius: number;
  adult: number;
  dead: boolean;
}

export interface LineageRecord {
  parent: number;
  gen: number;
  born: number;
  died: number;
  species: number;
}

export interface StatsSample {
  tick: number;
  cells: number;
  /** Cells whose largest feeding share is light / vent / engulfing. */
  light: number;
  vent: number;
  engulf: number;
  debris: number;
  meanRadius: number;
  sun: number;
  season: number;
  climate: number;
  volcanism: number;
  vents: number;
  /** Species id -> living cells. */
  species: Record<number, number>;
  /** Cells with at least one bond. */
  bonded: number;
  /** Colonies of 2+ cells, the biggest one, and those mixing 2+ species. */
  colonies: number;
  biggestColony: number;
  mixedColonies: number;
  /** Cells taking far more shared energy than they give. */
  cheaters: number;
  /** Guests living inside hosts. */
  guests: number;
  /** Living cells of each cell type (see CELL_TYPES). */
  types: number[];
  /** Mean distinct cell types in colonies of 3+ cells. */
  typesPerColony: number;
  /** Colonies of 3+ cells that carry a germ cell. */
  germColonies: number;
  /** Sex cells looking for a partner. */
  gametes: number;
  /** Big organisms alive, and the biggest one's cell count. */
  bodies: number;
  biggestBody: number;
}

export class World {
  readonly p: Params;
  readonly rng: Rng;
  readonly seed: string;
  tick = 0;
  sun = 0;
  /** -1 (winter) to 1 (summer). */
  season = 0;
  /** Slow climate drift, about -1 (dim era) to 1 (bright era). */
  climate = 0;
  /** Slow drift in volcanic activity, about -1 (quiet) to 1 (active). */
  volcanism = 0;

  // ---- cells (struct of arrays) ----
  readonly cap: number;
  n = 0;
  private nextId = 1;
  readonly id: Uint32Array;
  readonly parent: Uint32Array;
  readonly gen: Uint32Array;
  readonly species: Int32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly energy: Float32Array;
  readonly age: Int32Array;
  readonly lifespan: Int32Array;
  readonly cooldown: Int16Array;
  readonly engulfCd: Int16Array;
  readonly force: Float32Array;
  readonly dead: Uint8Array;
  readonly genes: Float32Array;
  // traits cached from genes
  readonly radius: Float32Array;
  readonly maxE: Float32Array;
  readonly shareL: Float32Array;
  readonly shareV: Float32Array;
  readonly shareE: Float32Array;
  readonly mot: Float32Array;
  readonly tol: Float32Array;
  readonly swap: Float32Array;
  readonly divThr: Float32Array;
  readonly mutRate: Float32Array;
  readonly adhesion: Float32Array;
  readonly sharing: Float32Array;
  readonly policing: Float32Array;
  readonly symbiont: Float32Array;
  readonly colonyLimit: Int32Array;
  readonly sexG: Float32Array;
  readonly signalG: Float32Array;

  // ---- switch network: SWITCHES states and OUTPUTS outputs per cell ----
  readonly sw: Float32Array;
  readonly out: Float32Array;
  readonly cellType: Uint8Array;
  /** Signal each cell broadcast last tick. */
  readonly signal: Float32Array;
  /** Ticks a sex cell has left to find a partner; 0 for other cells. */
  readonly gamete: Int16Array;
  /** Ticks left before a cell that left its colony may bond again. */
  readonly noBond: Int16Array;
  /** Developmental stage: divisions since the egg or germ cell that founded this body. */
  readonly stage: Uint16Array;
  readonly divUp: Float32Array;
  readonly divSpread: Float32Array;
  /** Per colony root: centre (offset from the root cell, so wrapping is safe) and reach. */
  private readonly colonyX: Float32Array;
  private readonly colonyY: Float32Array;
  private readonly colonyZ: Float32Array;
  private readonly colonyExt: Float32Array;
  private readonly colonyReach: Float32Array;
  /** Per colony root: live cell count, kept up to date as cells are born within a tick. */
  private readonly colonyLive: Int32Array;
  private readonly inputs = new Float32Array(9);

  // ---- bonds: up to maxBonds slots per cell, by cell index ----
  readonly mb: number;
  readonly bondCount: Uint8Array;
  readonly bondTo: Int32Array;
  /** Per bond slot: energy this cell gave / got back, decayed over the policing window. */
  readonly bondGave: Float32Array;
  readonly bondGot: Float32Array;
  /** Per cell: total shared energy given / received, same decay. */
  readonly gaveTotal: Float32Array;
  readonly gotTotal: Float32Array;
  /** Colony id (index of its first cell) and colony size, refreshed every tick. */
  readonly colony: Int32Array;
  readonly colonySize: Int32Array;
  private readonly colonyVolume: Float32Array;

  // ---- guests living inside hosts: up to maxGuests slots per cell ----
  readonly mg: number;
  readonly guestCount: Uint8Array;
  readonly guestGenes: Float32Array;
  readonly guestEnergy: Float32Array;
  readonly guestId: Uint32Array;

  // ---- debris ----
  readonly dCap: number;
  nd = 0;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly dz: Float32Array;
  readonly dE: Float32Array;
  readonly dAge: Int32Array;
  readonly dGenes: Float32Array;

  // ---- environment ----
  readonly vents: Vent[] = [];

  // ---- big organisms ----
  readonly bodies: Body[] = [];

  // ---- spatial hash ----
  private readonly gx: number;
  private readonly gy: number;
  private readonly gz: number;
  private readonly bucketStart: Int32Array;
  private readonly bucketOf: Int32Array;
  private readonly cursor: Int32Array;
  private readonly sorted: Int32Array;
  /** Light demand per water column (x, z bucket), for sharing light. */
  private readonly colDemand: Float32Array;
  /** By-products in the water per bucket: sugar from light feeders, fertiliser from vent feeders. */
  readonly sugar: Float32Array;
  readonly fert: Float32Array;

  private readonly order: Int32Array;
  private near = new Int32Array(256);
  private readonly tmp = new Float64Array(3);

  // ---- bookkeeping ----
  readonly lineage = new Map<number, LineageRecord>();
  readonly speciesTracker: Species;
  readonly history: StatsSample[] = [];
  totalBorn = 0;
  engulfed = 0;
  swaps = 0;
  captured = 0;
  policed = 0;
  germReleases = 0;
  fusions = 0;
  bodiesFormed = 0;

  constructor(seed: string | number = 1, params: Partial<Params> = {}) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.seed = String(seed);
    this.rng = new Rng(hashSeed(seed));
    const p = this.p;
    const cap = (this.cap = p.cellCap);

    this.id = new Uint32Array(cap);
    this.parent = new Uint32Array(cap);
    this.gen = new Uint32Array(cap);
    this.species = new Int32Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.energy = new Float32Array(cap);
    this.age = new Int32Array(cap);
    this.lifespan = new Int32Array(cap);
    this.cooldown = new Int16Array(cap);
    this.engulfCd = new Int16Array(cap);
    this.force = new Float32Array(cap);
    this.dead = new Uint8Array(cap);
    this.genes = new Float32Array(cap * GENE_COUNT);
    this.radius = new Float32Array(cap);
    this.maxE = new Float32Array(cap);
    this.shareL = new Float32Array(cap);
    this.shareV = new Float32Array(cap);
    this.shareE = new Float32Array(cap);
    this.mot = new Float32Array(cap);
    this.tol = new Float32Array(cap);
    this.swap = new Float32Array(cap);
    this.divThr = new Float32Array(cap);
    this.mutRate = new Float32Array(cap);
    this.adhesion = new Float32Array(cap);
    this.sharing = new Float32Array(cap);
    this.policing = new Float32Array(cap);
    this.symbiont = new Float32Array(cap);
    this.colonyLimit = new Int32Array(cap);
    this.sexG = new Float32Array(cap);
    this.signalG = new Float32Array(cap);
    this.sw = new Float32Array(cap * SWITCHES);
    this.out = new Float32Array(cap * OUTPUTS);
    this.cellType = new Uint8Array(cap);
    this.signal = new Float32Array(cap);
    this.gamete = new Int16Array(cap);
    this.noBond = new Int16Array(cap);
    this.stage = new Uint16Array(cap);
    this.divUp = new Float32Array(cap);
    this.divSpread = new Float32Array(cap);
    this.colonyX = new Float32Array(cap);
    this.colonyY = new Float32Array(cap);
    this.colonyZ = new Float32Array(cap);
    this.colonyExt = new Float32Array(cap);
    this.colonyReach = new Float32Array(cap);
    this.colonyLive = new Int32Array(cap);

    const mb = (this.mb = p.maxBonds);
    this.bondCount = new Uint8Array(cap);
    this.bondTo = new Int32Array(cap * mb);
    this.bondGave = new Float32Array(cap * mb);
    this.bondGot = new Float32Array(cap * mb);
    this.gaveTotal = new Float32Array(cap);
    this.gotTotal = new Float32Array(cap);
    this.colony = new Int32Array(cap);
    this.colonySize = new Int32Array(cap);
    this.colonyVolume = new Float32Array(cap);

    const mg = (this.mg = p.maxGuests);
    this.guestCount = new Uint8Array(cap);
    this.guestGenes = new Float32Array(cap * mg * GENE_COUNT);
    this.guestEnergy = new Float32Array(cap * mg);
    this.guestId = new Uint32Array(cap * mg);

    const dCap = (this.dCap = Math.max(1000, Math.floor(cap * 0.8)));
    this.dx = new Float32Array(dCap);
    this.dy = new Float32Array(dCap);
    this.dz = new Float32Array(dCap);
    this.dE = new Float32Array(dCap);
    this.dAge = new Int32Array(dCap);
    this.dGenes = new Float32Array(dCap * GENE_COUNT);

    this.gx = Math.max(1, Math.floor(p.width / p.hashCell));
    this.gy = Math.max(1, Math.ceil(p.depth / p.hashCell));
    this.gz = this.gx;
    const nb = this.gx * this.gy * this.gz;
    this.bucketStart = new Int32Array(nb + 1);
    this.bucketOf = new Int32Array(cap);
    this.cursor = new Int32Array(nb);
    this.sorted = new Int32Array(cap);
    this.colDemand = new Float32Array(this.gx * this.gz);
    this.sugar = new Float32Array(nb);
    this.fert = new Float32Array(nb);
    this.order = new Int32Array(cap);

    this.speciesTracker = new Species(p.speciesDistance);

    for (let i = 0; i < p.ventCount; i++) this.openVent(true);
    this.seedCells();
    this.updateSun();
    this.speciesTracker.recluster(this);
    this.sample();
  }

  // =====================================================================
  // Setup
  // =====================================================================

  private seedCells(): void {
    const { p, rng } = this;
    const tag = [0.35, 0.8, 0.45];
    const g = new Float32Array(GENE_COUNT);
    for (let c = 0; c < p.startingCells; c++) {
      for (let k = 0; k < GENE_COUNT; k++) g[k] = clamp01(0.5 + rng.gauss() * 0.05);
      g[Gene.Light] = clamp01(0.8 + rng.gauss() * 0.01);
      g[Gene.Vent] = clamp01(0.1 + rng.gauss() * 0.01);
      g[Gene.Engulf] = clamp01(0.1 + rng.gauss() * 0.01);
      g[Gene.TagR] = clamp01(tag[0] + rng.gauss() * 0.01);
      g[Gene.TagG] = clamp01(tag[1] + rng.gauss() * 0.01);
      g[Gene.TagB] = clamp01(tag[2] + rng.gauss() * 0.01);
      g[Gene.Tolerance] = clamp01(2 * p.startTolerance + rng.gauss() * 0.05);
      // Policing starts near zero and has to evolve.
      g[Gene.Policing] = clamp01(0.05 + rng.gauss() * 0.02);
      // Sex is rare to begin with; switch weights start near 0.5 (no effect).
      g[Gene.Sex] = clamp01(0.1 + rng.gauss() * 0.03);
      // No flagellum yet: the first cells drift, and swimming has to evolve.
      g[Gene.Motility] = clamp01(0.02 + rng.gauss() * 0.01);
      g[Gene.LikeR] = g[Gene.TagR];
      g[Gene.LikeG] = g[Gene.TagG];
      g[Gene.LikeB] = g[Gene.TagB];
      const i = this.addCell(
        g,
        0,
        rng.range(0, p.width),
        rng.range(5, p.depth - 5),
        rng.range(0, p.width),
        0,
        0,
      );
      this.energy[i] = this.maxE[i] * rng.range(0.4, 0.7);
      this.age[i] = rng.int(p.lifespan / 2);
    }
  }

  private openVent(initial: boolean): void {
    const { p, rng } = this;
    const life = p.ventLifetime * rng.range(0.75, 1.25);
    this.vents.push({
      x: rng.range(0, p.width),
      z: rng.range(0, p.width),
      born: initial ? this.tick - rng.range(0, life * 0.7) : this.tick,
      life,
      stock: p.ventStock * 0.5,
      strength: 0,
    });
  }

  /** Appends a cell with genes copied from src[so..]; returns its index. */
  private addCell(
    src: Float32Array,
    so: number,
    x: number,
    y: number,
    z: number,
    parentId: number,
    generation: number,
  ): number {
    const i = this.n++;
    this.genes.set(src.subarray(so, so + GENE_COUNT), i * GENE_COUNT);
    const id = this.nextId++;
    this.id[i] = id;
    this.parent[i] = parentId;
    this.gen[i] = generation;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.age[i] = 0;
    this.lifespan[i] = Math.round(
      this.p.lifespan * lifeFactorOf(this.genes[i * GENE_COUNT + Gene.Lifespan]) * this.rng.range(0.85, 1.15),
    );
    this.cooldown[i] = this.p.divisionCooldown;
    this.engulfCd[i] = 0;
    this.force[i] = 0;
    this.dead[i] = 0;
    this.bondCount[i] = 0;
    this.guestCount[i] = 0;
    this.gaveTotal[i] = this.gotTotal[i] = 0;
    this.colony[i] = i;
    this.colonySize[i] = 1;
    this.sw.fill(EGG_STATE, i * SWITCHES, (i + 1) * SWITCHES);
    this.stage[i] = 0;
    this.out.fill(0, i * OUTPUTS, (i + 1) * OUTPUTS);
    this.cellType[i] = 0;
    this.signal[i] = 0;
    this.gamete[i] = 0;
    this.noBond[i] = 0;
    this.refreshTraits(i);
    this.energy[i] = 0;
    this.totalBorn++;
    this.lineage.set(id, { parent: parentId, gen: generation, born: this.tick, died: -1, species: -1 });
    return i;
  }

  /** Recomputes cached traits after genes are edited from outside (tests, tools). */
  refreshTraitsFor(i: number): void {
    this.refreshTraits(i);
  }

  /** Recomputes cached traits after a cell's genes change. */
  private refreshTraits(i: number): void {
    const t = traitsOf(this.genes, i * GENE_COUNT);
    this.radius[i] = t.radius;
    this.maxE[i] = this.p.energyPerVolume * t.radius ** 3;
    this.shareL[i] = t.light;
    this.shareV[i] = t.vent;
    this.shareE[i] = t.engulf;
    this.mot[i] = t.motility;
    this.tol[i] = t.tolerance;
    this.swap[i] = t.swap;
    this.divThr[i] = t.divThreshold;
    this.mutRate[i] = t.mutationRate;
    this.adhesion[i] = t.adhesion;
    this.sharing[i] = t.sharing;
    this.policing[i] = t.policing;
    this.symbiont[i] = t.symbiont;
    this.colonyLimit[i] = t.colonyLimit;
    this.sexG[i] = t.sex;
    this.signalG[i] = t.signal;
    this.divUp[i] = t.divUp;
    this.divSpread[i] = t.divSpread;
    if (this.energy[i] > this.maxE[i]) this.energy[i] = this.maxE[i];
  }

  // =====================================================================
  // Environment
  // =====================================================================

  private updateSun(): void {
    const { p, rng } = this;
    // Climate and volcanism wander slowly and keep drifting back toward normal.
    if (this.tick % CLIMATE_EVERY === 0) {
      const k = CLIMATE_EVERY / Math.max(CLIMATE_EVERY, p.climateTime);
      const s = Math.sqrt(2 * k);
      this.climate = clamp(this.climate * (1 - k) + rng.gauss() * s, -1.5, 1.5);
      this.volcanism = clamp(this.volcanism * (1 - k) + rng.gauss() * s, -1.5, 1.5);
    }
    this.season = Math.sin((2 * Math.PI * this.tick) / (p.dayLength * Math.max(1, p.yearLength)));
    const bright = Math.max(0.1, 1 + p.climateSwing * this.climate);
    this.sun = bright * sunAt(this.tick, p.dayLength, p.seasonSwing * this.season);
  }

  /** Vents open now, after volcanic activity has had its say. */
  ventTarget(): number {
    return Math.max(0, Math.round(this.p.ventCount * (1 + this.p.volcanoSwing * this.volcanism)));
  }

  /** Light reaching depth y at full exposure (before shading). */
  lightAt(y: number): number {
    return this.sun * Math.pow(0.5, (this.p.depth - y) / this.p.lightHalfDepth);
  }

  private updateVents(): void {
    const { p } = this;
    for (let v = this.vents.length - 1; v >= 0; v--) {
      const vent = this.vents[v];
      const a = this.tick - vent.born;
      if (a >= vent.life) {
        this.vents.splice(v, 1);
        continue;
      }
      vent.strength = Math.max(0, Math.min(1, a / 1000, (vent.life - a) / 2000));
      vent.stock = Math.min(p.ventStock, vent.stock + p.ventRegen * vent.strength);
    }
    while (this.vents.length < this.ventTarget()) this.openVent(false);
  }

  /**
   * Food from one vent at a point: a plume that is widest and richest at the
   * floor and thins out as it rises.
   */
  private ventWeight(v: Vent, x: number, y: number, z: number): number {
    const { p } = this;
    const dx = wrapDelta(v.x - x, p.width);
    const dz = wrapDelta(v.z - z, p.width);
    const d2 = dx * dx + dz * dz;
    const s2 = 2 * p.ventSpread * p.ventSpread;
    if (d2 > 9 * s2) return 0;
    return v.strength * (v.stock / p.ventStock) * Math.exp(-d2 / s2 - y / p.ventPlume);
  }

  /** Vent food density at a point (0..~1), summed over vents. */
  ventFood(x: number, y: number, z: number): number {
    let food = 0;
    for (const v of this.vents) food += this.ventWeight(v, x, y, z);
    return food;
  }

  // =====================================================================
  // Spatial hash
  // =====================================================================

  private bucketCoord(v: number, n: number): number {
    const b = Math.floor(v / this.p.hashCell);
    return b < 0 ? 0 : b >= n ? n - 1 : b;
  }

  private bucketIndex(x: number, y: number, z: number): number {
    const bx = this.bucketCoord(x, this.gx);
    const by = this.bucketCoord(y, this.gy);
    const bz = this.bucketCoord(z, this.gz);
    return (bx * this.gz + bz) * this.gy + by;
  }

  private buildHash(): void {
    const start = this.bucketStart;
    start.fill(0);
    this.colDemand.fill(0);
    for (let i = 0; i < this.n; i++) {
      const b = this.bucketIndex(this.x[i], this.y[i], this.z[i]);
      this.bucketOf[i] = b;
      start[b + 1]++;
      this.colDemand[(b / this.gy) | 0] += this.lightDemand(i);
    }
    for (let b = 1; b < start.length; b++) start[b] += start[b - 1];
    const cursor = this.cursor;
    cursor.fill(0);
    for (let i = 0; i < this.n; i++) {
      const b = this.bucketOf[i];
      this.sorted[start[b] + cursor[b]++] = i;
    }
  }

  /**
   * Collects every cell in the 3x3x3 buckets around (x, y, z) into
   * this.near, wrapping at the sides; returns how many.
   */
  private gatherNeighbours(x: number, y: number, z: number): number {
    const { gx, gy, gz } = this;
    let count = 0;
    let near = this.near;
    const bx = this.bucketCoord(x, gx);
    const by = this.bucketCoord(y, gy);
    const bz = this.bucketCoord(z, gz);
    for (let ox = -1; ox <= 1; ox++) {
      const cx = (bx + ox + gx) % gx;
      for (let oz = -1; oz <= 1; oz++) {
        const cz = (bz + oz + gz) % gz;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = by + oy;
          if (cy < 0 || cy >= gy) continue;
          const b = (cx * gz + cz) * gy + cy;
          const e = this.bucketStart[b + 1];
          for (let k = this.bucketStart[b]; k < e; k++) {
            if (count === near.length) {
              const grown = new Int32Array(near.length * 2);
              grown.set(near);
              near = this.near = grown;
            }
            near[count++] = this.sorted[k];
          }
        }
      }
    }
    return count;
  }

  /** Light a cell would absorb if it had its water column to itself. */
  private lightDemand(i: number): number {
    const r = this.radius[i];
    return this.p.kLight * efficiency(this.shareL[i]) * this.lightAt(this.y[i]) * r * r;
  }

  /**
   * Light a cell actually gets. Each water column only carries so much
   * light, so crowded columns share it out in proportion to demand.
   */
  private lightGain(i: number): number {
    const demand = this.lightDemand(i);
    if (demand === 0) return 0;
    const col = (this.bucketOf[i] / this.gy) | 0;
    const cap = this.p.lightPerColumn * this.sun;
    return demand / (1 + this.colDemand[col] / cap);
  }

  // =====================================================================
  // Tick
  // =====================================================================

  step(): void {
    const { p, rng } = this;
    this.updateSun();
    this.updateVents();
    this.buildHash();
    this.findColonies();
    this.formBodies();
    for (let b = 0; b < this.sugar.length; b++) {
      this.sugar[b] *= BYPRODUCT_DECAY;
      this.fert[b] *= BYPRODUCT_DECAY;
    }

    const n0 = this.n;
    const order = this.order;
    for (let i = 0; i < n0; i++) order[i] = i;
    for (let i = n0 - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }

    for (let k = 0; k < n0; k++) {
      const i = order[k];
      if (this.dead[i]) continue;
      this.updateCell(i);
    }

    this.updateBonds();
    this.updateBodies();
    this.updateDebris();
    this.removeDead();

    this.tick++;
    if (this.tick % p.speciesEvery === 0) {
      this.speciesTracker.recluster(this);
      this.pruneLineage();
    }
    if (this.tick % STATS_EVERY === 0) this.sample();
  }

  private updateCell(i: number): void {
    const { p, rng, genes } = this;
    const G = GENE_COUNT;
    const xi = this.x[i];
    const yi = this.y[i];
    const zi = this.z[i];
    const ri = this.radius[i];
    const half = p.width / 2;
    const isGamete = this.gamete[i] > 0;
    if (isGamete && --this.gamete[i] === 0) {
      // A sex cell that found no partner dies.
      this.kill(i, true);
      return;
    }
    if (this.noBond[i] > 0) this.noBond[i]--;

    // ---- switches ----
    const o = i * OUTPUTS;
    this.runSwitchesFor(i);
    const out = this.out;
    this.cellType[i] = isGamete ? SEX_TYPE : cellTypeOf(out, o);

    // ---- sense + contacts (one neighbour pass) ----
    let preyDx = 0,
      preyDy = 0,
      preyDz = 0,
      preyD2 = Infinity;
    let fleeX = 0,
      fleeY = 0,
      fleeZ = 0;
    const sense2 = p.senseRadius * p.senseRadius;
    const canEngulf = this.shareE[i] > 0.05;

    const nn = this.gatherNeighbours(xi, yi, zi);
    for (let q = 0; q < nn; q++) {
      const j = this.near[q];
      if (j === i || this.dead[j]) continue;
      let dx = this.x[j] - xi;
      if (dx > half) dx -= p.width;
      else if (dx < -half) dx += p.width;
      const dy = this.y[j] - yi;
      let dz = this.z[j] - zi;
      if (dz > half) dz -= p.width;
      else if (dz < -half) dz += p.width;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > sense2) continue;
      const rj = this.radius[j];
      const friend = tagDistance(genes, j * G, genes, i * G) <= this.tol[i];

      if (!friend) {
        if (canEngulf && ri > this.wholeRadius(j) * ENGULF_SIZE_RATIO && d2 < preyD2) {
          preyD2 = d2;
          preyDx = dx;
          preyDy = dy;
          preyDz = dz;
        } else if (rj > ri * ENGULF_SIZE_RATIO && this.shareE[j] > 0.2) {
          const inv = 1 / (d2 + 1);
          fleeX -= dx * inv;
          fleeY -= dy * inv;
          fleeZ -= dz * inv;
        }
      }

      const touch = ri + rj;
      if (d2 >= touch * touch) continue;

      // Push apart.
      const d = Math.sqrt(d2) || 0.01;
      const push = (0.5 * (touch - d)) / d;
      this.x[i] -= dx * push * 0.5;
      this.y[i] -= dy * push * 0.5;
      this.z[i] -= dz * push * 0.5;
      this.x[j] += dx * push * 0.5;
      this.y[j] += dy * push * 0.5;
      this.z[j] += dz * push * 0.5;

      if (isGamete && this.gamete[j] > 0 && friend && tagDistance(genes, i * G, genes, j * G) <= this.tol[j]) {
        if (this.fuse(i, j)) return;
      }
      if (!friend) {
        if (
          canEngulf &&
          this.engulfCd[i] === 0 &&
          ri > this.wholeRadius(j) * ENGULF_SIZE_RATIO &&
          rng.chance(this.shareE[i])
        ) {
          this.engulfCd[i] = ENGULF_COOLDOWN;
          // Defence cells are hard to swallow.
          const guard = 1 - Math.max(0, out[j * OUTPUTS + Output.Defend]);
          if (rng.chance((guard * ri) / (ri + rj))) this.engulf(i, j);
        }
      } else {
        if (rng.chance(this.swap[i] * FRIEND_SWAP_RATE)) {
          swapGenes(genes, i * G, genes, j * G, rng);
          this.refreshTraits(i);
          this.swaps++;
        }
        // Friends may bond; the other cell's view doesn't matter, which is
        // the opening a tag-mimicking cheater uses. Two single cells can
        // start a colony, and touching cells of the same body stick to
        // each other like tissue; separate bodies never merge.
        const single = this.bondCount[i] === 0 && this.bondCount[j] === 0;
        const sameBody = this.bondCount[i] > 0 && this.bondCount[j] > 0 && this.colony[i] === this.colony[j];
        if (
          !isGamete &&
          this.gamete[j] === 0 &&
          (single || sameBody) &&
          this.noBond[i] === 0 &&
          this.noBond[j] === 0 &&
          this.bondCount[i] < this.mb &&
          this.bondCount[j] < this.mb &&
          rng.chance(this.stickiness(i) * this.stickiness(j) * p.bondRate) &&
          this.bondSlot(i, j) < 0
        ) {
          this.addBond(i, j);
        }
      }
    }
    if (this.dead[i]) return;

    // ---- swim ----
    let sx = 0,
      sy = 0,
      sz = 0;
    const effL = efficiency(this.shareL[i]);
    const effV = efficiency(this.shareV[i]);
    const effE = efficiency(this.shareE[i]);
    // Climb the gradient of this cell's own food gain: light pulls up by
    // day, vent plumes pull toward their source. Whichever pays more wins.
    const r2i = ri * ri;
    if (effL > 0) {
      const dLight = (p.kLight * effL * r2i * this.lightAt(yi) * Math.LN2) / p.lightHalfDepth;
      sy += GRADIENT_GAIN * dLight;
    }
    if (effV > 0) {
      const k = p.kVent * effV * r2i;
      const s2 = 2 * p.ventSpread * p.ventSpread;
      for (const v of this.vents) {
        const w = this.ventWeight(v, xi, yi, zi);
        if (w === 0) continue;
        sx += (GRADIENT_GAIN * k * w * 2 * wrapDelta(v.x - xi, p.width)) / s2;
        sy -= (GRADIENT_GAIN * k * w) / p.ventPlume;
        sz += (GRADIENT_GAIN * k * w * 2 * wrapDelta(v.z - zi, p.width)) / s2;
      }
    }
    if (preyD2 < Infinity) {
      const d = Math.sqrt(preyD2) || 1;
      sx += (2 * effE * preyDx) / d;
      sy += (2 * effE * preyDy) / d;
      sz += (2 * effE * preyDz) / d;
    }
    const fl = Math.hypot(fleeX, fleeY, fleeZ);
    if (fl > 0) {
      sx += (1.5 * fleeX) / fl;
      sy += (1.5 * fleeY) / fl;
      sz += (1.5 * fleeZ) / fl;
    }
    sx += rng.gauss() * 0.3;
    sy += rng.gauss() * 0.3;
    sz += rng.gauss() * 0.3;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const f = this.mot[i] * Math.min(1, sl) * (1 + out[o + Output.Swim]);
    this.force[i] = f;
    const speed = (f * p.maxSpeed) / Math.sqrt(ri);
    this.vx[i] = 0.6 * this.vx[i] + 0.4 * (sx / sl) * speed;
    this.vy[i] = 0.6 * this.vy[i] + 0.4 * (sy / sl) * speed;
    this.vz[i] = 0.6 * this.vz[i] + 0.4 * (sz / sl) * speed;
    currentAt(this.x[i], this.y[i], this.z[i], this.tick, p, this.tmp);
    this.x[i] = wrap(this.x[i] + this.vx[i] + this.tmp[0] + rng.gauss() * 0.05, p.width);
    this.y[i] = clamp(this.y[i] + this.vy[i] + this.tmp[1] + rng.gauss() * 0.05, ri, p.depth - ri);
    this.z[i] = wrap(this.z[i] + this.vz[i] + this.tmp[2] + rng.gauss() * 0.05, p.width);

    // ---- feed ----
    const r2 = r2i;
    const feedBoost = 1 + out[o + Output.Feed];
    const lightFood = effL > 0 ? this.lightGain(i) * feedBoost : 0;
    const ventFood = effV > 0 ? this.feedOnVents(i, effV * p.kVent * r2 * feedBoost) : 0;
    let gain = lightFood + ventFood + this.absorbByproducts(i);
    this.releaseByproducts(i, lightFood, ventFood);
    if (this.guestCount[i] > 0) gain += this.updateGuests(i);
    this.energy[i] = Math.min(this.maxE[i], this.energy[i] + gain);

    // ---- pay ----
    // Feeding machinery costs upkeep, so a cell that stops feeding rests
    // cheaply. A flagellum costs upkeep even at rest, on top of the work of swimming.
    // Living longer takes more repair, so long-lived cells pay more upkeep.
    const repair = 1 + p.repairCost * (lifeFactorOf(this.genes[i * GENE_COUNT + Gene.Lifespan]) - 1);
    const basal = p.kBasal * repair * (p.restCost + (1 - p.restCost) * feedBoost);
    this.energy[i] -= (basal + p.kFlagellum * this.mot[i]) * r2 + p.kSwim * f * f * r2 + p.kBond * this.bondCount[i];
    this.age[i]++;
    if (this.cooldown[i] > 0) this.cooldown[i]--;
    if (this.engulfCd[i] > 0) this.engulfCd[i]--;

    // ---- die or divide ----
    if (this.energy[i] <= 0 || this.age[i] > this.lifespan[i]) {
      this.kill(i, true);
      return;
    }
    if (isGamete) return;
    if (this.cellType[i] === GERM_TYPE && this.bondCount[i] > 0) {
      // Germ cells inside a colony store energy instead of dividing.
      if (this.energy[i] >= p.germEnergy * this.maxE[i]) this.releaseGerm(i);
      return;
    }
    const div = out[o + Output.Divide];
    // A body stops growing at its adult size; only germ cells start the next one.
    const grown = this.bondCount[i] > 0 && this.colonyLive[this.colony[i]] >= this.colonyLimit[i];
    if (
      !grown &&
      div > NO_DIVIDE &&
      this.cooldown[i] === 0 &&
      this.energy[i] >= this.divThr[i] * (1 - 0.3 * Math.max(0, div)) * this.maxE[i] &&
      this.n < this.cap
    ) {
      this.divide(i);
    }
  }

  /** Feeds a cell's senses into its switch network. */
  private runSwitchesFor(i: number): void {
    const inp = this.inputs;
    const nb = this.bondCount[i];
    let sig = 0;
    for (let s = 0; s < nb; s++) sig += this.signal[this.bondTo[i * this.mb + s]];
    inp[0] = nb / this.mb;
    inp[1] = nb > 0 ? sig / nb : 0;
    inp[2] = this.energy[i] / this.maxE[i];
    inp[3] = this.lightAt(this.y[i]);
    inp[4] = this.age[i] / this.lifespan[i];
    inp[5] = 1;
    inp[6] = Math.min(1, this.stage[i] / 8);
    if (nb > 0) {
      const c = this.colony[i];
      inp[7] = clamp((this.y[i] - this.colonyY[c]) / Math.max(this.colonyExt[c], this.radius[i]), -1, 1);
      // 0 at the centre of the body, 1 on its outer surface.
      inp[8] = Math.min(1, this.centreDistance(i, c) / Math.max(this.colonyReach[c], this.radius[i]));
    } else {
      inp[7] = 0;
      inp[8] = 1;
    }
    runSwitches(this.genes, i * GENE_COUNT, inp, this.sw, i * SWITCHES, this.out, i * OUTPUTS);
    // The first switch drives the signal partners hear next tick.
    this.signal[i] = this.signalG[i] * this.sw[i * SWITCHES];
  }

  /** Adhesion after the switch network has had its say. */
  private stickiness(i: number): number {
    return clamp01(this.adhesion[i] * (1 + this.out[i * OUTPUTS + Output.Adhere]));
  }

  /**
   * A full germ cell leaves its colony. It either founds a new colony by
   * dividing, or (with the sex gene's chance) becomes a sex cell that has a
   * limited time to fuse with another.
   */
  private releaseGerm(i: number): void {
    while (this.bondCount[i] > 0) this.removeBondAt(i, 0);
    this.noBond[i] = LEAVE_TICKS;
    this.germReleases++;
    this.startEmbryo(i);
    if (this.rng.chance(this.sexG[i])) {
      this.gamete[i] = this.p.gameteLife;
      this.cellType[i] = SEX_TYPE;
    }
  }

  /**
   * A cell that starts a new body goes back to the egg state: development
   * replays from the genes, not from the parent's body.
   */
  private startEmbryo(i: number): void {
    this.stage[i] = 0;
    this.sw.fill(EGG_STATE, i * SWITCHES, (i + 1) * SWITCHES);
  }

  /**
   * Two sex cells fuse into one new cell. Genes come from either parent
   * (switches in whole blocks); guests come only from the bigger, egg-like
   * parent.
   */
  private fuse(a: number, b: number): boolean {
    if (this.n >= this.cap) return false;
    const { p, rng } = this;
    const G = GENE_COUNT;
    const [egg, sperm] = this.radius[a] >= this.radius[b] ? [a, b] : [b, a];
    const c = this.addCell(
      this.genes,
      egg * G,
      this.x[egg],
      this.y[egg],
      this.z[egg],
      this.id[egg],
      Math.max(this.gen[a], this.gen[b]) + 1,
    );
    recombine(this.genes, c * G, this.genes, egg * G, this.genes, sperm * G, rng);
    mutate(this.genes, c * G, this.mutRate[egg], p.mutationStep, rng);
    this.refreshTraits(c);
    this.species[c] = this.species[egg];
    const rec = this.lineage.get(this.id[c]);
    if (rec) rec.species = this.species[egg];
    this.energy[c] = Math.min(this.maxE[c], this.energy[a] + this.energy[b]);
    const mg = this.mg;
    const ng = this.guestCount[egg];
    this.guestGenes.copyWithin(c * mg * G, egg * mg * G, (egg * mg + ng) * G);
    this.guestEnergy.copyWithin(c * mg, egg * mg, egg * mg + ng);
    this.guestId.copyWithin(c * mg, egg * mg, egg * mg + ng);
    this.guestCount[c] = ng;
    this.guestCount[egg] = 0;
    this.kill(a, false);
    this.kill(b, false);
    this.fusions++;
    return true;
  }

  /** Takes vent food for cell i, draining vent stock; returns energy gained. */
  private feedOnVents(i: number, k: number): number {
    let gain = 0;
    for (const v of this.vents) {
      const w = this.ventWeight(v, this.x[i], this.y[i], this.z[i]);
      if (w < 1e-4) continue;
      const take = Math.min(v.stock, k * w);
      v.stock -= take;
      gain += take;
    }
    return gain;
  }

  private divide(i: number): void {
    const { p, rng } = this;
    const G = GENE_COUNT;
    const e = (this.energy[i] * (1 - p.divisionLoss)) / 2;
    // The daughter goes along the body axis, loosely or strictly by the genes.
    rng.unit(this.tmp);
    const spread = this.divSpread[i];
    const axis = 2 * this.divUp[i] - 1;
    this.tmp[0] *= spread;
    this.tmp[1] = this.tmp[1] * spread + axis * (1 - spread);
    this.tmp[2] *= spread;
    const len = Math.hypot(this.tmp[0], this.tmp[1], this.tmp[2]) || 1;
    for (let k = 0; k < 3; k++) this.tmp[k] /= len;
    const r = this.radius[i] * 2;
    const c = this.addCell(
      this.genes,
      i * G,
      wrap(this.x[i] + this.tmp[0] * r, p.width),
      clamp(this.y[i] + this.tmp[1] * r, 1, p.depth - 1),
      wrap(this.z[i] + this.tmp[2] * r, p.width),
      this.id[i],
      this.gen[i] + 1,
    );
    mutate(this.genes, c * G, this.mutRate[i], p.mutationStep, rng);
    this.refreshTraits(c);
    this.species[c] = this.species[i];
    const rec = this.lineage.get(this.id[c]);
    if (rec) rec.species = this.species[i];
    this.energy[i] = e;
    this.energy[c] = Math.min(e, this.maxE[c]);
    // Inside a body, daughters keep their mother's switch states (cell memory)
    // and both move one stage on. A daughter that floats free is a new egg.
    const stay = rng.chance(this.stickiness(i)) && this.bondCount[i] < this.mb;
    if (stay) {
      this.sw.copyWithin(c * SWITCHES, i * SWITCHES, (i + 1) * SWITCHES);
      this.out.copyWithin(c * OUTPUTS, i * OUTPUTS, (i + 1) * OUTPUTS);
      this.cellType[c] = this.cellType[i];
      this.stage[i] = this.stage[c] = Math.min(65535, this.stage[i] + 1);
      this.addBond(i, c);
      this.colony[c] = this.colony[i];
      this.colonyLive[this.colony[i]]++;
    }
    this.cooldown[i] = p.divisionCooldown;
    if (this.guestCount[i] > 0) this.splitGuests(i, c);
  }

  /** Marks a cell dead; it leaves debris unless it was eaten. */
  private kill(i: number, leaveDebris: boolean): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    const rec = this.lineage.get(this.id[i]);
    if (rec) rec.died = this.tick;
    while (this.bondCount[i] > 0) this.removeBondAt(i, 0);
    this.releaseGuests(i);
    if (!leaveDebris) return;
    this.dropDebris(i, this.p.debrisFraction * (Math.max(0, this.energy[i]) + 0.2 * this.maxE[i]));
  }

  private dropDebris(i: number, energy: number): void {
    if (this.nd >= this.dCap || energy <= 0) return;
    const d = this.nd++;
    this.dx[d] = this.x[i];
    this.dy[d] = this.y[i];
    this.dz[d] = this.z[i];
    // A body is worth something even when its store is empty.
    this.dE[d] = energy;
    this.dAge[d] = 0;
    this.dGenes.set(this.genes.subarray(i * GENE_COUNT, (i + 1) * GENE_COUNT), d * GENE_COUNT);
  }

  private updateDebris(): void {
    const { p, rng } = this;
    const G = GENE_COUNT;
    const half = p.width / 2;
    for (let d = 0; d < this.nd; d++) {
      currentAt(this.dx[d], this.dy[d], this.dz[d], this.tick, p, this.tmp);
      this.dx[d] = wrap(this.dx[d] + this.tmp[0], p.width);
      this.dy[d] = Math.max(0.5, this.dy[d] - DEBRIS_SINK);
      this.dz[d] = wrap(this.dz[d] + this.tmp[2], p.width);
      this.dE[d] *= DEBRIS_DECAY;
      this.dAge[d]++;
      if (this.dAge[d] > DEBRIS_MAX_AGE || this.dE[d] < 0.02) {
        this.dE[d] = 0;
        continue;
      }
      // Engulfers and vent feeders absorb debris they touch.
      const xd = this.dx[d],
        yd = this.dy[d],
        zd = this.dz[d];
      let eater = -1;
      const nn = this.gatherNeighbours(xd, yd, zd);
      for (let q = 0; q < nn && eater < 0; q++) {
        const j = this.near[q];
        if (this.dead[j]) continue;
        const use = this.shareE[j] + 0.5 * this.shareV[j];
        if (use < 0.15) continue;
        let dx = this.x[j] - xd;
        if (dx > half) dx -= p.width;
        else if (dx < -half) dx += p.width;
        const dy = this.y[j] - yd;
        let dz = this.z[j] - zd;
        if (dz > half) dz -= p.width;
        else if (dz < -half) dz += p.width;
        const t = this.radius[j] + 1;
        if (dx * dx + dy * dy + dz * dz < t * t) eater = j;
      }
      if (eater >= 0) {
        const use = Math.min(1, this.shareE[eater] + 0.5 * this.shareV[eater]);
        this.energy[eater] = Math.min(this.maxE[eater], this.energy[eater] + this.dE[d] * use);
        if (rng.chance(this.swap[eater] * DEBRIS_SWAP_RATE)) {
          swapGenes(this.genes, eater * G, this.dGenes, d * G, rng);
          this.refreshTraits(eater);
          this.swaps++;
        }
        this.dE[d] = 0;
      }
    }
    // Compact.
    let w = 0;
    for (let d = 0; d < this.nd; d++) {
      if (this.dE[d] <= 0) continue;
      if (w !== d) {
        this.dx[w] = this.dx[d];
        this.dy[w] = this.dy[d];
        this.dz[w] = this.dz[d];
        this.dE[w] = this.dE[d];
        this.dAge[w] = this.dAge[d];
        this.dGenes.copyWithin(w * G, d * G, (d + 1) * G);
      }
      w++;
    }
    this.nd = w;
  }

  /** Swap-removes dead cells. */
  private removeDead(): void {
    let i = 0;
    while (i < this.n) {
      if (!this.dead[i]) {
        i++;
        continue;
      }
      const last = --this.n;
      if (i !== last) this.moveCell(last, i);
    }
  }

  private moveCell(from: number, to: number): void {
    const arrays = [
      this.id, this.parent, this.gen, this.species, this.x, this.y, this.z, this.vx, this.vy, this.vz,
      this.energy, this.age, this.lifespan, this.cooldown, this.engulfCd, this.force, this.dead,
      this.radius, this.maxE, this.shareL, this.shareV, this.shareE, this.mot, this.tol, this.swap,
      this.divThr, this.mutRate, this.adhesion, this.sharing, this.policing, this.symbiont,
      this.bondCount, this.gaveTotal, this.gotTotal, this.colony, this.colonySize, this.guestCount,
      this.colonyLimit, this.sexG, this.signalG, this.cellType, this.signal, this.gamete, this.noBond,
      this.stage, this.divUp, this.divSpread,
    ];
    for (const a of arrays) a[to] = a[from];
    this.genes.copyWithin(to * GENE_COUNT, from * GENE_COUNT, (from + 1) * GENE_COUNT);
    this.sw.copyWithin(to * SWITCHES, from * SWITCHES, (from + 1) * SWITCHES);
    this.out.copyWithin(to * OUTPUTS, from * OUTPUTS, (from + 1) * OUTPUTS);
    const mb = this.mb;
    this.bondTo.copyWithin(to * mb, from * mb, (from + 1) * mb);
    this.bondGave.copyWithin(to * mb, from * mb, (from + 1) * mb);
    this.bondGot.copyWithin(to * mb, from * mb, (from + 1) * mb);
    // Partners now find this cell at its new index.
    for (let s = 0; s < this.bondCount[to]; s++) {
      const j = this.bondTo[to * mb + s];
      for (let t = 0; t < this.bondCount[j]; t++) if (this.bondTo[j * mb + t] === from) this.bondTo[j * mb + t] = to;
    }
    const mg = this.mg;
    const GG = mg * GENE_COUNT;
    this.guestGenes.copyWithin(to * GG, from * GG, (from + 1) * GG);
    this.guestEnergy.copyWithin(to * mg, from * mg, (from + 1) * mg);
    this.guestId.copyWithin(to * mg, from * mg, (from + 1) * mg);
  }

  // =====================================================================
  // Bonds and colonies
  // =====================================================================

  /** Slot in i's bond list that points at j, or -1. */
  bondSlot(i: number, j: number): number {
    for (let s = 0; s < this.bondCount[i]; s++) if (this.bondTo[i * this.mb + s] === j) return s;
    return -1;
  }

  private addBond(i: number, j: number): void {
    if (i === j || this.bondCount[i] >= this.mb || this.bondCount[j] >= this.mb) return;
    for (const [a, b] of [
      [i, j],
      [j, i],
    ]) {
      const s = a * this.mb + this.bondCount[a]++;
      this.bondTo[s] = b;
      this.bondGave[s] = 0;
      this.bondGot[s] = 0;
    }
  }

  /** Removes bond slot s of cell i, and the matching slot on its partner. */
  private removeBondAt(i: number, s: number): void {
    const mb = this.mb;
    const j = this.bondTo[i * mb + s];
    this.dropSlot(i, s);
    const t = this.bondSlot(j, i);
    if (t >= 0) this.dropSlot(j, t);
  }

  private dropSlot(i: number, s: number): void {
    const mb = this.mb;
    const last = --this.bondCount[i];
    if (s !== last) {
      this.bondTo[i * mb + s] = this.bondTo[i * mb + last];
      this.bondGave[i * mb + s] = this.bondGave[i * mb + last];
      this.bondGot[i * mb + s] = this.bondGot[i * mb + last];
    }
  }

  /** Labels connected groups of bonded cells. */
  findColonies(): void {
    const n = this.n;
    const mb = this.mb;
    const colony = this.colony;
    colony.fill(-1, 0, n);
    const stack = this.order; // free until the shuffle below
    for (let i = 0; i < n; i++) {
      if (colony[i] >= 0) continue;
      colony[i] = i;
      let top = 0;
      let size = 0;
      let vol = 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      stack[top++] = i;
      while (top > 0) {
        const a = stack[--top];
        size++;
        vol += this.radius[a] ** 3;
        sx += wrapDelta(this.x[a] - this.x[i], this.p.width);
        sy += this.y[a];
        sz += wrapDelta(this.z[a] - this.z[i], this.p.width);
        for (let s = 0; s < this.bondCount[a]; s++) {
          const b = this.bondTo[a * mb + s];
          if (colony[b] < 0) {
            colony[b] = i;
            stack[top++] = b;
          }
        }
      }
      this.colonySize[i] = size;
      this.colonyVolume[i] = vol;
      this.colonyX[i] = sx / size;
      this.colonyY[i] = sy / size;
      this.colonyZ[i] = sz / size;
      this.colonyExt[i] = 0;
      this.colonyReach[i] = 0;
      this.colonyLive[i] = size;
    }
    for (let i = 0; i < n; i++) {
      const c = colony[i];
      this.colonySize[i] = this.colonySize[c];
      const d = Math.abs(this.y[i] - this.colonyY[c]);
      if (d > this.colonyExt[c]) this.colonyExt[c] = d;
      const r = this.centreDistance(i, c);
      if (r > this.colonyReach[c]) this.colonyReach[c] = r;
    }
  }

  /** How far cell i sits from the centre of colony c (rooted at cell c). */
  private centreDistance(i: number, c: number): number {
    const W = this.p.width;
    return Math.hypot(
      wrapDelta(this.x[i] - this.x[c], W) - this.colonyX[c],
      this.y[i] - this.colonyY[c],
      wrapDelta(this.z[i] - this.z[c], W) - this.colonyZ[c],
    );
  }

  /** Radius of the whole colony a cell belongs to, as one ball of the same volume. */
  private wholeRadius(j: number): number {
    if (this.bondCount[j] === 0) return this.radius[j];
    return Math.cbrt(this.colonyVolume[this.colony[j]]);
  }

  /**
   * After cells move: bonds act as springs and pull partners' velocities
   * together, partners share energy, ledgers decay, and policing cells
   * cut partners that take more than they give.
   */
  private updateBonds(): void {
    const { p, rng } = this;
    const mb = this.mb;
    const half = p.width / 2;
    const decay = 1 - 1 / p.policingWindow;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i]) continue;
      this.gaveTotal[i] *= decay;
      this.gotTotal[i] *= decay;
      const police = (this.tick + i) % POLICE_EVERY === 0 && this.policing[i] > 0;
      for (let s = this.bondCount[i] - 1; s >= 0; s--) {
        const k = i * mb + s;
        this.bondGave[k] *= decay;
        this.bondGot[k] *= decay;
        const j = this.bondTo[k];
        if (police && this.bondGave[k] > 1 && this.bondGot[k] * 2 < this.bondGave[k] && rng.chance(this.policing[i])) {
          this.removeBondAt(i, s);
          this.policed++;
          continue;
        }
        if (j < i) continue; // each pair once below
        let dx = this.x[j] - this.x[i];
        if (dx > half) dx -= p.width;
        else if (dx < -half) dx += p.width;
        const dy = this.y[j] - this.y[i];
        let dz = this.z[j] - this.z[i];
        if (dz > half) dz -= p.width;
        else if (dz < -half) dz += p.width;
        const d = Math.hypot(dx, dy, dz) || 0.01;
        const rest = this.radius[i] + this.radius[j];
        if (d > rest * BOND_SNAP) {
          this.removeBondAt(i, s);
          continue;
        }
        // Spring toward touching distance.
        const c = (0.25 * (d - rest)) / d;
        this.x[i] = wrap(this.x[i] + dx * c, p.width);
        this.y[i] = clamp(this.y[i] + dy * c, this.radius[i], p.depth - this.radius[i]);
        this.z[i] = wrap(this.z[i] + dz * c, p.width);
        this.x[j] = wrap(this.x[j] - dx * c, p.width);
        this.y[j] = clamp(this.y[j] - dy * c, this.radius[j], p.depth - this.radius[j]);
        this.z[j] = wrap(this.z[j] - dz * c, p.width);
        // A colony swims as one: partners pull each other's velocity together.
        const mvx = 0.5 * (this.vx[i] + this.vx[j]);
        const mvy = 0.5 * (this.vy[i] + this.vy[j]);
        const mvz = 0.5 * (this.vz[i] + this.vz[j]);
        this.vx[i] = this.vx[j] = mvx;
        this.vy[i] = this.vy[j] = mvy;
        this.vz[i] = this.vz[j] = mvz;
        // Share: the fuller cell passes some of its spare energy along.
        const fi = this.energy[i] / this.maxE[i];
        const fj = this.energy[j] / this.maxE[j];
        const [from, to, slotFrom] = fi > fj ? [i, j, k] : [j, i, -1];
        const spare = Math.max(0, this.energy[from] - 0.3 * this.maxE[from]);
        const amount = Math.min(
          (this.sharing[from] * p.shareRate * spare) / this.bondCount[from],
          Math.max(0, this.maxE[to] - this.energy[to]),
        );
        if (amount > 0) {
          this.energy[from] -= amount;
          this.energy[to] += amount;
          this.gaveTotal[from] += amount;
          this.gotTotal[to] += amount;
          const sf = slotFrom >= 0 ? slotFrom : j * mb + this.bondSlot(j, i);
          const st = slotFrom >= 0 ? j * mb + this.bondSlot(j, i) : k;
          this.bondGave[sf] += amount;
          this.bondGot[st] += amount;
        }
      }
    }
  }

  // =====================================================================
  // By-products
  // =====================================================================

  /**
   * Light feeders leak sugar (food for vent feeders and engulfers); vent
   * feeders leave spent minerals that fertilise light feeders. Most goes
   * straight to bonded partners who can use it; the rest drifts into the
   * water nearby and fades fast.
   */
  private releaseByproducts(i: number, lightFood: number, ventFood: number): void {
    const p = this.p;
    if (lightFood <= 0 && ventFood <= 0) return;
    const sugar = p.byproduct * lightFood;
    const fert = p.byproduct * ventFood;
    let leftS = sugar;
    let leftF = fert;
    const nb = this.bondCount[i];
    if (nb > 0) {
      for (let s = 0; s < nb; s++) {
        const j = this.bondTo[i * this.mb + s];
        const useS = Math.min(1, this.shareV[j] + this.shareE[j]);
        const useF = this.shareL[j];
        const gotS = (sugar * BOND_BYPRODUCT * useS) / nb;
        const gotF = (fert * BOND_BYPRODUCT * useF) / nb;
        this.energy[j] = Math.min(this.maxE[j], this.energy[j] + gotS + gotF);
        leftS -= (sugar * BOND_BYPRODUCT) / nb;
        leftF -= (fert * BOND_BYPRODUCT) / nb;
      }
    }
    const b = this.bucketOf[i];
    this.sugar[b] += leftS;
    this.fert[b] += leftF;
  }

  /** Takes by-products from the water around a cell. */
  private absorbByproducts(i: number): number {
    const b = this.bucketOf[i];
    const useS = Math.min(1, this.shareV[i] + this.shareE[i]);
    const useF = this.shareL[i];
    const takeS = this.sugar[b] * BYPRODUCT_ABSORB * useS;
    const takeF = this.fert[b] * BYPRODUCT_ABSORB * useF;
    this.sugar[b] -= takeS;
    this.fert[b] -= takeF;
    return takeS + takeF;
  }

  // =====================================================================
  // Engulfing and guests
  // =====================================================================

  /** Cell i swallows cell j: digests it, or keeps it alive inside as a guest. */
  private engulf(i: number, j: number): void {
    const p = this.p;
    if (this.guestCount[i] < this.mg && this.rng.chance(this.symbiont[i])) {
      const g = i * this.mg + this.guestCount[i]++;
      this.guestGenes.set(this.genes.subarray(j * GENE_COUNT, (j + 1) * GENE_COUNT), g * GENE_COUNT);
      this.guestEnergy[g] = this.energy[j];
      this.guestId[g] = this.id[j];
      this.captured++;
      this.kill(j, false);
      return;
    }
    this.energy[i] = Math.min(this.maxE[i], this.energy[i] + p.engulfGain * this.energy[j]);
    this.dropDebris(j, ENGULF_DEBRIS * this.energy[j]);
    this.kill(j, false);
    this.engulfed++;
  }

  /**
   * Guests feed by their own genes from inside the host, pass part of what
   * they make to it, and pay their own upkeep. Returns the host's net gain.
   */
  private updateGuests(i: number): number {
    const p = this.p;
    const G = GENE_COUNT;
    let toHost = 0;
    const col = (this.bucketOf[i] / this.gy) | 0;
    const light = this.lightAt(this.y[i]);
    const lightCrowd = 1 + this.colDemand[col] / Math.max(1e-6, p.lightPerColumn * this.sun);
    const vent = this.ventFood(this.x[i], this.y[i], this.z[i]);
    for (let s = this.guestCount[i] - 1; s >= 0; s--) {
      const g = i * this.mg + s;
      const t = traitsOf(this.guestGenes, g * G);
      const r2 = t.radius * t.radius;
      const made =
        (p.kLight * efficiency(t.light) * light * r2) / lightCrowd + p.kVent * efficiency(t.vent) * vent * r2;
      const pass = p.guestPass * made;
      toHost += pass - p.kGuest * r2;
      const maxE = p.energyPerVolume * t.radius ** 3;
      let e = this.guestEnergy[g] + made - pass - p.kBasal * r2;
      if (e > maxE) {
        toHost += e - maxE; // a full guest hands over the rest
        e = maxE;
      }
      if (e <= 0) this.dropGuest(i, s);
      else this.guestEnergy[g] = e;
    }
    return toHost;
  }

  private dropGuest(i: number, s: number): void {
    const mg = this.mg;
    const G = GENE_COUNT;
    const last = --this.guestCount[i];
    if (s === last) return;
    const a = i * mg + s;
    const b = i * mg + last;
    this.guestGenes.copyWithin(a * G, b * G, (b + 1) * G);
    this.guestEnergy[a] = this.guestEnergy[b];
    this.guestId[a] = this.guestId[b];
  }

  /**
   * When a host divides its guests divide too (when they have the energy,
   * mutating as they go) and are dealt out between the two daughters.
   */
  private splitGuests(i: number, c: number): void {
    const { p, rng } = this;
    const mg = this.mg;
    const G = GENE_COUNT;
    const pool: { genes: Float32Array; e: number; id: number }[] = [];
    for (let s = 0; s < this.guestCount[i]; s++) {
      const g = i * mg + s;
      const genes = this.guestGenes.slice(g * G, (g + 1) * G);
      const t = traitsOf(genes);
      const e = this.guestEnergy[g];
      if (e >= t.divThreshold * p.energyPerVolume * t.radius ** 3 * 0.5) {
        const child = genes.slice();
        mutate(child, 0, t.mutationRate, p.mutationStep, rng);
        const half = (e * (1 - p.divisionLoss)) / 2;
        pool.push({ genes, e: half, id: this.guestId[g] }, { genes: child, e: half, id: this.nextId++ });
      } else pool.push({ genes, e, id: this.guestId[g] });
    }
    this.guestCount[i] = 0;
    pool.forEach((guest, k) => {
      const host = k % 2 === 0 ? i : c;
      if (this.guestCount[host] >= mg) return;
      const g = host * mg + this.guestCount[host]++;
      this.guestGenes.set(guest.genes, g * G);
      this.guestEnergy[g] = guest.e;
      this.guestId[g] = guest.id;
    });
  }

  /** A dying host lets its guests go free, as long as there is room. */
  private releaseGuests(i: number): void {
    const { p, rng } = this;
    const G = GENE_COUNT;
    const count = this.guestCount[i];
    this.guestCount[i] = 0;
    for (let s = 0; s < count && this.n < this.cap; s++) {
      const g = i * this.mg + s;
      rng.unit(this.tmp);
      const c = this.addCell(
        this.guestGenes,
        g * G,
        wrap(this.x[i] + this.tmp[0] * this.radius[i], p.width),
        clamp(this.y[i] + this.tmp[1] * this.radius[i], 1, p.depth - 1),
        wrap(this.z[i] + this.tmp[2] * this.radius[i], p.width),
        this.id[i],
        this.gen[i] + 1,
      );
      this.energy[c] = Math.min(this.maxE[c], this.guestEnergy[g]);
      this.species[c] = this.species[i];
    }
  }

  // =====================================================================
  // Big organisms
  // =====================================================================

  /** Bodies that reach the threshold turn into big organisms. */
  private formBodies(): void {
    const { p } = this;
    const n = this.n;
    const W = p.width;
    for (let root = 0; root < n; root++) {
      if (this.colony[root] !== root || this.colonySize[root] < p.bodyThreshold || this.dead[root]) continue;
      const T = CELL_TYPES.length;
      const tissue = new Array<number>(T).fill(0);
      const out = new Float32Array(T * OUTPUTS);
      const place = new Float32Array(T * 3);
      const cx = this.x[root] + this.colonyX[root];
      const cz = this.z[root] + this.colonyZ[root];
      const cy = this.colonyY[root];
      const reach = Math.max(1, this.colonyReach[root]);
      let energy = 0;
      let oldest = root;
      for (let i = 0; i < n; i++) {
        if (this.colony[i] !== root || this.dead[i]) continue;
        const t = this.cellType[i] === SEX_TYPE ? 0 : this.cellType[i];
        tissue[t]++;
        for (let k = 0; k < OUTPUTS; k++) out[t * OUTPUTS + k] += this.out[i * OUTPUTS + k];
        place[t * 3] += wrapDelta(this.x[i] - cx, W) / reach;
        place[t * 3 + 1] += (this.y[i] - cy) / reach;
        place[t * 3 + 2] += wrapDelta(this.z[i] - cz, W) / reach;
        energy += this.energy[i];
        if (this.stage[i] < this.stage[oldest]) oldest = i;
        // The cells become the body: they leave no debris and their guests go with them.
        this.guestCount[i] = 0;
        this.kill(i, false);
      }
      for (let t = 0; t < T; t++)
        if (tissue[t] > 0) {
          for (let k = 0; k < OUTPUTS; k++) out[t * OUTPUTS + k] /= tissue[t];
          for (let k = 0; k < 3; k++) place[t * 3 + k] /= tissue[t];
        }
      // The body's genome is the one its cells grew from: the least divided cell's.
      const genes = this.genes.slice(oldest * GENE_COUNT, (oldest + 1) * GENE_COUNT);
      const t = traitsOf(genes);
      const id = this.nextId++;
      const body: Body = {
        id,
        founder: this.id[oldest],
        species: this.species[oldest],
        gen: this.gen[oldest],
        genes,
        x: wrap(cx, W),
        y: clamp(cy, 1, p.depth - 1),
        z: wrap(cz, W),
        vx: 0,
        vy: 0,
        vz: 0,
        tissue,
        out,
        place,
        energy,
        age: 0,
        lifespan: Math.round(p.bodyLifespan * t.life * this.rng.range(0.85, 1.15)),
        growCd: p.divisionCooldown,
        germCd: 0,
        biteCd: 0,
        cellRadius: t.radius,
        radius: 0,
        adult: t.colonyLimit,
        dead: false,
      };
      this.sizeBody(body);
      this.bodies.push(body);
      this.lineage.set(id, { parent: this.id[oldest], gen: this.gen[oldest] + 1, born: this.tick, died: -1, species: body.species });
      this.bodiesFormed++;
    }
  }

  private sizeBody(b: Body): void {
    b.radius = b.cellRadius * Math.cbrt(Math.max(1, bodyCells(b)));
  }

  private bodyMaxE(b: Body): number {
    return this.p.energyPerVolume * b.cellRadius ** 3 * bodyCells(b);
  }

  private updateBodies(): void {
    for (const b of this.bodies) if (!b.dead) this.updateBody(b);
    let w = 0;
    for (const b of this.bodies) if (!b.dead) this.bodies[w++] = b;
    this.bodies.length = w;
  }

  private updateBody(b: Body): void {
    const { p, rng } = this;
    const T = CELL_TYPES.length;
    const W = p.width;
    const t = traitsOf(b.genes);
    const r = b.cellRadius;
    const r2 = r * r;
    const cells = bodyCells(b);
    const effL = efficiency(t.light);
    const effV = efficiency(t.vent);
    const effE = efficiency(t.engulf);

    // ---- feed: every tissue feeds by the genes, scaled by its feeding output ----
    let feedCells = 0;
    let swim = 0;
    for (let k = 0; k < T; k++) {
      const c = b.tissue[k];
      if (!c) continue;
      feedCells += c * (1 + b.out[k * OUTPUTS + Output.Feed]);
      swim += c * t.motility * (1 + b.out[k * OUTPUTS + Output.Swim]);
    }
    swim /= cells;
    // A body shades its own water columns, so light is capped by its footprint.
    const columns = Math.max(1, (Math.PI * b.radius * b.radius) / (p.hashCell * p.hashCell));
    const demand = p.kLight * effL * this.lightAt(b.y) * r2 * feedCells;
    const lightCap = p.lightPerColumn * this.sun * columns;
    const light = demand > 0 && lightCap > 0 ? demand / (1 + demand / lightCap) : 0;
    let vent = 0;
    if (effV > 0) {
      const k = p.kVent * effV * r2 * feedCells;
      for (const v of this.vents) {
        const w = this.ventWeight(v, b.x, b.y, b.z);
        if (w < 1e-4) continue;
        const take = Math.min(v.stock, k * w);
        v.stock -= take;
        vent += take;
      }
    }
    const maxE = this.bodyMaxE(b);
    b.energy = Math.min(maxE, b.energy + light + vent);

    // ---- swim toward its food: up by day for light, toward vents for vent food ----
    let sx = rng.gauss() * 0.3,
      sy = rng.gauss() * 0.3,
      sz = rng.gauss() * 0.3;
    if (effL >= effV) sy += this.sun > 0 ? 1 : -0.3;
    else {
      let best = 0;
      for (const v of this.vents) {
        const w = this.ventWeight(v, b.x, 0, b.z) + 1e-3 * v.strength;
        if (w > best) {
          best = w;
          sx = wrapDelta(v.x - b.x, W);
          sz = wrapDelta(v.z - b.z, W);
          sy = -b.y;
        }
      }
    }
    const sl = Math.hypot(sx, sy, sz) || 1;
    const speed = (Math.min(1.5, swim) * p.maxSpeed) / Math.sqrt(b.radius);
    b.vx = 0.8 * b.vx + 0.2 * (sx / sl) * speed;
    b.vy = 0.8 * b.vy + 0.2 * (sy / sl) * speed;
    b.vz = 0.8 * b.vz + 0.2 * (sz / sl) * speed;
    currentAt(b.x, b.y, b.z, this.tick, p, this.tmp);
    b.x = wrap(b.x + b.vx + this.tmp[0], W);
    b.y = clamp(b.y + b.vy + this.tmp[1], b.radius * 0.5, p.depth - b.radius * 0.5);
    b.z = wrap(b.z + b.vz + this.tmp[2], W);

    // ---- hunt: swallow smaller strangers it touches ----
    if (effE > 0.05) this.bodyHunt(b, effE, maxE);

    // ---- pay ----
    const basal = p.kBasal * (1 + p.repairCost * (t.life - 1)) * (p.restCost * cells + (1 - p.restCost) * feedCells);
    b.energy -= basal * r2 + cells * (p.kFlagellum * t.motility * r2 + p.kBond * 2) + p.kSwim * swim * swim * r2 * cells;
    b.age++;
    if (b.energy <= 0 || b.age > b.lifespan) {
      this.killBody(b);
      return;
    }

    // ---- grow by the same plan: new cells join tissues in the body's proportions ----
    if (b.growCd > 0) b.growCd--;
    else if (cells < b.adult && b.energy >= t.divThreshold * maxE) {
      b.growCd = p.divisionCooldown;
      let dividers = 0;
      for (let k = 0; k < T; k++) dividers += b.tissue[k] * Math.max(0, b.out[k * OUTPUTS + Output.Divide]);
      const add = Math.min(b.adult - cells, Math.max(1, Math.round(cells * 0.03 * (1 + (4 * dividers) / cells))));
      const costPer = p.energyPerVolume * r ** 3 * (0.5 + p.divisionLoss);
      for (let a = 0; a < add && b.energy > costPer; a++) {
        let pick = rng.next() * cells;
        let k = 0;
        while (k < T - 1 && pick >= b.tissue[k]) pick -= b.tissue[k++];
        b.tissue[k]++;
        b.energy -= costPer;
      }
      this.sizeBody(b);
    }

    // ---- reproduce: a full body releases germ cells, which start over from one cell ----
    if (b.germCd > 0) b.germCd--;
    const germ = b.tissue[GERM_TYPE];
    if (germ > 0 && b.germCd === 0 && b.energy >= p.germEnergy * maxE && this.n < this.cap) {
      b.germCd = Math.max(10, Math.round(200 / germ));
      rng.unit(this.tmp);
      const c = this.addCell(
        b.genes,
        0,
        wrap(b.x + this.tmp[0] * b.radius, W),
        clamp(b.y + this.tmp[1] * b.radius, 1, p.depth - 1),
        wrap(b.z + this.tmp[2] * b.radius, W),
        b.id,
        b.gen + 1,
      );
      mutate(this.genes, c * GENE_COUNT, t.mutationRate, p.mutationStep, rng);
      this.refreshTraits(c);
      this.species[c] = b.species;
      const rec = this.lineage.get(this.id[c]);
      if (rec) rec.species = b.species;
      this.energy[c] = this.maxE[c];
      this.noBond[c] = LEAVE_TICKS;
      b.energy -= this.maxE[c];
      b.tissue[GERM_TYPE]--;
      this.sizeBody(b);
      this.germReleases++;
      if (rng.chance(this.sexG[c])) {
        this.gamete[c] = p.gameteLife;
        this.cellType[c] = SEX_TYPE;
      }
    }
  }

  /** A big organism swallows a single cell, or bites a smaller body, that it touches. */
  private bodyHunt(b: Body, effE: number, maxE: number): void {
    const { p, rng } = this;
    const W = p.width;
    if (b.biteCd > 0) {
      b.biteCd--;
      return;
    }
    const G = GENE_COUNT;
    const tol = 0.5 * b.genes[Gene.Tolerance];
    const nn = this.gatherNeighbours(b.x, b.y, b.z);
    for (let q = 0; q < nn; q++) {
      const j = this.near[q];
      if (this.dead[j]) continue;
      const dx = wrapDelta(this.x[j] - b.x, W);
      const dy = this.y[j] - b.y;
      const dz = wrapDelta(this.z[j] - b.z, W);
      const reach = b.radius + this.radius[j];
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (tagDistance(this.genes, j * G, b.genes, 0) <= tol) continue;
      const guard = 1 - Math.max(0, this.out[j * OUTPUTS + Output.Defend]);
      if (!rng.chance(effE * guard)) continue;
      b.energy = Math.min(maxE, b.energy + p.engulfGain * this.energy[j]);
      this.dropDebris(j, ENGULF_DEBRIS * this.energy[j]);
      this.kill(j, false);
      this.engulfed++;
      b.biteCd = ENGULF_COOLDOWN;
      return;
    }
    // Bigger bodies take bites out of smaller ones, unless defence cells stop them.
    for (const o of this.bodies) {
      if (o === b || o.dead || o.radius * ENGULF_SIZE_RATIO > b.radius) continue;
      const dx = wrapDelta(o.x - b.x, W);
      const dy = o.y - b.y;
      const dz = wrapDelta(o.z - b.z, W);
      const reach = b.radius + o.radius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (tagDistance(o.genes, 0, b.genes, 0) <= tol) continue;
      b.biteCd = ENGULF_COOLDOWN;
      let def = 0;
      const oc = bodyCells(o);
      for (let k = 0; k < o.tissue.length; k++) def += o.tissue[k] * Math.max(0, o.out[k * OUTPUTS + Output.Defend]);
      if (!rng.chance(effE * (1 - Math.min(1, (2 * def) / oc)))) return;
      const bite = Math.max(1, Math.round(oc * 0.1));
      const share = bite / oc;
      b.energy = Math.min(maxE, b.energy + p.engulfGain * o.energy * share);
      o.energy *= 1 - share;
      for (let a = 0; a < bite; a++) {
        let pick = rng.next() * bodyCells(o);
        let k = 0;
        while (k < o.tissue.length - 1 && pick >= o.tissue[k]) pick -= o.tissue[k++];
        if (o.tissue[k] > 0) o.tissue[k]--;
      }
      if (bodyCells(o) < 2) this.killBody(o);
      else this.sizeBody(o);
      this.engulfed++;
      return;
    }
  }

  private killBody(b: Body): void {
    if (b.dead) return;
    b.dead = true;
    const rec = this.lineage.get(b.id);
    if (rec) rec.died = this.tick;
    // A dead body breaks up into a few pieces of debris.
    const pieces = Math.min(8, Math.max(1, Math.round(bodyCells(b) / 16)));
    const energy = this.p.debrisFraction * (Math.max(0, b.energy) + 0.2 * this.bodyMaxE(b));
    for (let k = 0; k < pieces && this.nd < this.dCap; k++) {
      const d = this.nd++;
      this.rng.unit(this.tmp);
      this.dx[d] = wrap(b.x + this.tmp[0] * b.radius, this.p.width);
      this.dy[d] = clamp(b.y + this.tmp[1] * b.radius, 0.5, this.p.depth);
      this.dz[d] = wrap(b.z + this.tmp[2] * b.radius, this.p.width);
      this.dE[d] = energy / pieces;
      this.dAge[d] = 0;
      this.dGenes.set(b.genes, d * GENE_COUNT);
    }
  }

  // =====================================================================
  // Bookkeeping
  // =====================================================================

  /** Keeps lineage records for living cells and a few generations of their ancestors. */
  private pruneLineage(): void {
    const keep = new Set<number>();
    for (let i = 0; i < this.n; i++) {
      let id = this.id[i];
      for (let depth = 0; depth <= LINEAGE_DEPTH && id && !keep.has(id); depth++) {
        keep.add(id);
        id = this.lineage.get(id)?.parent ?? 0;
      }
    }
    for (const b of this.bodies) {
      let id = b.id;
      for (let depth = 0; depth <= LINEAGE_DEPTH && id && !keep.has(id); depth++) {
        keep.add(id);
        id = this.lineage.get(id)?.parent ?? 0;
      }
    }
    for (const id of this.lineage.keys()) if (!keep.has(id)) this.lineage.delete(id);
  }

  sample(): void {
    let l = 0,
      v = 0,
      e = 0,
      rs = 0;
    const sp: Record<number, number> = {};
    let bonded = 0,
      cheaters = 0,
      guests = 0;
    const colonySpecies = new Map<number, Set<number>>();
    let biggest = 1;
    const types = new Array<number>(CELL_TYPES.length).fill(0);
    const colonyTypes = new Map<number, number>();
    for (let i = 0; i < this.n; i++) {
      types[this.cellType[i]]++;
      if (this.colonySize[i] >= 3) {
        const c = this.colony[i];
        colonyTypes.set(c, (colonyTypes.get(c) ?? 0) | (1 << this.cellType[i]));
      }
      if (this.bondCount[i] > 0) {
        bonded++;
        const c = this.colony[i];
        let set = colonySpecies.get(c);
        if (!set) colonySpecies.set(c, (set = new Set()));
        set.add(this.species[i]);
        if (this.colonySize[i] > biggest) biggest = this.colonySize[i];
      }
      if (this.gotTotal[i] > 1 && this.gotTotal[i] > CHEAT_RATIO * this.gaveTotal[i]) cheaters++;
      guests += this.guestCount[i];
      const a = this.shareL[i],
        b = this.shareV[i],
        c = this.shareE[i];
      if (a >= b && a >= c) l++;
      else if (b >= c) v++;
      else e++;
      rs += this.radius[i];
      const s = this.species[i];
      sp[s] = (sp[s] ?? 0) + 1;
    }
    this.history.push({
      tick: this.tick,
      cells: this.n,
      light: l,
      vent: v,
      engulf: e,
      debris: this.nd,
      meanRadius: this.n ? rs / this.n : 0,
      sun: this.sun,
      season: this.season,
      climate: this.climate,
      volcanism: this.volcanism,
      vents: this.vents.length,
      species: sp,
      bonded,
      colonies: colonySpecies.size,
      biggestColony: colonySpecies.size ? biggest : 0,
      mixedColonies: [...colonySpecies.values()].filter((s) => s.size > 1).length,
      cheaters,
      guests,
      types,
      typesPerColony: colonyTypes.size
        ? [...colonyTypes.values()].reduce((sum, mask) => sum + popcount(mask), 0) / colonyTypes.size
        : 0,
      germColonies: [...colonyTypes.values()].filter((mask) => mask & (1 << GERM_TYPE)).length,
      gametes: types[SEX_TYPE],
      bodies: this.bodies.length,
      biggestBody: this.bodies.reduce((m, b) => Math.max(m, bodyCells(b)), 0),
    });
    if (this.history.length > STATS_MAX) {
      // Thin older history by half so the chart spans the whole run.
      const keep = this.history.filter((_, k) => k % 2 === 0 || k > STATS_MAX / 2);
      this.history.length = 0;
      this.history.push(...keep);
    }
  }

  indexOf(id: number): number {
    for (let i = 0; i < this.n; i++) if (this.id[i] === id) return i;
    return -1;
  }

  livingSpecies(minCells = 1): SpeciesInfo[] {
    return this.speciesTracker.list().filter((s) => s.count >= minCells);
  }

  /** A short fingerprint of the full state, for determinism checks. */
  checksum(): number {
    let h = 0;
    for (let i = 0; i < this.n; i++) {
      h = (h * 31 + Math.round(this.x[i] * 1000)) | 0;
      h = (h * 31 + Math.round(this.y[i] * 1000)) | 0;
      h = (h * 31 + Math.round(this.energy[i] * 1000)) | 0;
      h = (h * 31 + this.id[i]) | 0;
    }
    return (h ^ this.n ^ (this.nd << 16)) >>> 0;
  }
}

// =====================================================================
// Helpers shared with the renderer
// =====================================================================

/** Sun strength 0..1: day for the first half of each cycle, night for the second. */
/**
 * Sunlight over the day, 0 at night. A positive season lifts the curve, so
 * days are longer and brighter; a negative one makes them short and dim.
 */
export function sunAt(tick: number, dayLength: number, season = 0): number {
  return Math.max(0, Math.sin((2 * Math.PI * tick) / dayLength) + season) / (1 + Math.abs(season));
}

/** Gentle current, periodic across the wrapped pond, stronger near the surface. */
export function currentAt(
  x: number,
  y: number,
  z: number,
  tick: number,
  p: Pick<Params, 'width' | 'depth'>,
  out: Float64Array | number[],
): void {
  const k = (2 * Math.PI) / p.width;
  const s = 0.12 * (0.4 + (0.6 * y) / p.depth);
  out[0] = s * (0.6 + Math.sin(z * k + tick * 0.0004));
  out[1] = 0.03 * Math.sin(x * k * 2 + tick * 0.0003);
  out[2] = s * Math.cos(x * k + tick * 0.0006);
}

function wrap(v: number, w: number): number {
  return v < 0 ? v + w : v >= w ? v - w : v;
}

function wrapDelta(d: number, w: number): number {
  return d > w / 2 ? d - w : d < -w / 2 ? d + w : d;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function bodyCells(b: Body): number {
  let c = 0;
  for (const t of b.tissue) c += t;
  return c;
}

function popcount(m: number): number {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
