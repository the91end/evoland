import type { Params } from './sim/params';
import type { SpeciesInfo } from './sim/species';
import type { StatsSample, LineageRecord } from './sim/world';

/** Messages from the page to the simulation worker. */
export type ToWorker =
  | { type: 'start'; seed: string; params: Partial<Params> }
  | { type: 'speed'; speed: number }
  /** Live parameter changes, applied to the running world. */
  | { type: 'params'; params: Partial<Params> }
  | { type: 'pause'; paused: boolean }
  | { type: 'inspect'; id: number | null }
  /** Save the whole pond to a file, or replace it with one. */
  | { type: 'save' }
  | { type: 'load'; data: ArrayBuffer };

/** One rendered frame of the world, sent with transferable buffers. */
export interface Frame {
  type: 'frame';
  tick: number;
  sun: number;
  /** Simulated ticks per wall-clock second, measured. */
  rate: number;
  n: number;
  ids: Uint32Array;
  /** xyz per cell. */
  pos: Float32Array;
  /** xyz velocity per cell (for tails). */
  vel: Float32Array;
  radius: Float32Array;
  /** Tag RGB per cell. */
  tag: Float32Array;
  /** Light / vent / engulf share per cell. */
  feed: Float32Array;
  species: Int32Array;
  motility: Float32Array;
  /** Energy as a fraction of max, per cell. */
  energy: Float32Array;
  /** Bonded pairs as frame indices (a, b, a, b, ...). */
  bonds: Uint32Array;
  /** Colony id per cell (the id of one member cell), and colony size. */
  colony: Uint32Array;
  colonySize: Int32Array;
  /** Cell type per cell (index into CELL_TYPES). */
  cellType: Uint8Array;
  /** Distinct cell types in each cell's colony (0 for colonies under 3 cells). */
  colonyTypes: Uint8Array;
  /** Guests per cell, and each guest slot's tag colour (maxGuests * 3 per cell). */
  guests: Uint8Array;
  guestTag: Float32Array;
  maxGuests: number;
  nd: number;
  debris: Float32Array;
  vents: { x: number; z: number; strength: number; stock: number }[];
  bodies: BodyFrame[];
}

/** A big organism as drawn: a few tissue parts around a centre. */
export interface BodyFrame {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  cellRadius: number;
  species: number;
  energy: number;
  tag: [number, number, number];
  feed: [number, number, number];
  /** One part per tissue: cell type, cells, and offset from the centre in body radii. */
  parts: { type: number; n: number; ox: number; oy: number; oz: number }[];
}

export interface BodyDetail {
  type: 'inspectBody';
  id: number;
  alive: boolean;
  species: number;
  generation: number;
  age: number;
  lifespan: number;
  energy: number;
  maxEnergy: number;
  cells: number;
  adult: number;
  radius: number;
  /** Cells per tissue, in CELL_TYPES order. */
  tissue: number[];
  genes: number[];
  traits: CellDetail['traits'];
  ancestors: ({ id: number } & LineageRecord)[];
}

export interface Stats {
  type: 'stats';
  history: StatsSample[];
  species: SpeciesInfo[];
  totalBorn: number;
  engulfed: number;
  swaps: number;
  captured: number;
  policed: number;
  germReleases: number;
  fusions: number;
  bodiesFormed: number;
}

export interface OrganismDetail {
  /** Member cells; the inspected cell is index 0. */
  cells: { id: number; type: number; energy: number; radius: number; motility: number; x: number; y: number; z: number }[];
  /** Bonds as pairs of indices into cells. */
  bonds: [number, number][];
  /** True when the organism has more cells than were sent. */
  truncated: boolean;
}

export interface CellDetail {
  type: 'inspect';
  id: number;
  alive: boolean;
  species: number;
  generation: number;
  age: number;
  lifespan: number;
  energy: number;
  maxEnergy: number;
  genes: number[];
  traits: {
    radius: number;
    light: number;
    vent: number;
    engulf: number;
    motility: number;
    tolerance: number;
    swap: number;
    divThreshold: number;
    mutationRate: number;
    adhesion: number;
    sharing: number;
    policing: number;
    symbiont: number;
    signal: number;
    colonyLimit: number;
    sex: number;
    divUp: number;
    divSpread: number;
  };
  cellType: number;
  /** Switch states (0..1) and the outputs they set (-1..1, shared budget). */
  switches: number[];
  outputs: number[];
  /** Ticks left to find a partner, for sex cells. */
  gamete: number;
  /** Divisions since the egg or germ cell that started this cell's body. */
  stage: number;
  /** The whole organism (bonded group) this cell belongs to, when it has 2+ cells. */
  organism: OrganismDetail | null;
  bonds: number;
  colonySize: number;
  /** Shared energy given and received recently. */
  gave: number;
  got: number;
  guests: { id: number; energy: number; light: number; vent: number; engulf: number; tag: [number, number, number] }[];
  /** Ancestors from parent upward. */
  ancestors: ({ id: number } & LineageRecord)[];
  /** Living direct offspring. */
  children: number;
  /** Living descendants within the tracked lineage window. */
  descendants: number;
  pos: [number, number, number];
}

export type FromWorker =
  | Frame
  | Stats
  | CellDetail
  | BodyDetail
  | { type: 'ready'; params: Params; seed: string; loaded: boolean }
  | { type: 'saved'; data: ArrayBuffer; tick: number }
  | { type: 'loadFailed'; message: string };
