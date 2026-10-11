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
  | { type: 'inspect'; id: number | null };

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
  nd: number;
  debris: Float32Array;
  vents: { x: number; z: number; strength: number; stock: number }[];
}

export interface Stats {
  type: 'stats';
  history: StatsSample[];
  species: SpeciesInfo[];
  totalBorn: number;
  engulfed: number;
  swaps: number;
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
  };
  /** Ancestors from parent upward. */
  ancestors: ({ id: number } & LineageRecord)[];
  /** Living direct offspring. */
  children: number;
  /** Living descendants within the tracked lineage window. */
  descendants: number;
  pos: [number, number, number];
}

export type FromWorker = Frame | Stats | CellDetail | { type: 'ready'; params: Params };
