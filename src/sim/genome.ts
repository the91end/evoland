import type { Rng } from './rng';

/**
 * Gene layout. Every gene is a number in [0, 1]; traits map them onto
 * real ranges. Phases 1 and 2; the switch network and sex are appended in
 * Phase 3.
 */
export const Gene = {
  Size: 0,
  Light: 1,
  Vent: 2,
  Engulf: 3,
  Motility: 4,
  TagR: 5,
  TagG: 6,
  TagB: 7,
  LikeR: 8,
  LikeG: 9,
  LikeB: 10,
  Tolerance: 11,
  Swap: 12,
  DivThreshold: 13,
  MutationRate: 14,
  Adhesion: 15,
  Sharing: 16,
  Policing: 17,
  Symbiont: 18,
  /** Phase 3: how strongly the signalling switch broadcasts to partners. */
  Signal: 19,
  /** Adult body size: cells in an organism this big stop dividing. */
  ColonySize: 20,
  /** Chance a released germ cell becomes a sex cell instead of a founder. */
  Sex: 21,
  /** Body axis: daughters are placed above (1) or below (0) their mother. */
  DivUp: 22,
  /** How loosely daughters follow the body axis: 0 builds a line, 1 a ball. */
  DivSpread: 23,
} as const;

/**
 * The gene switch network. Each of the 4 switches reads 9 inputs (bond
 * count, partners' signal, energy, light, age, a constant, developmental
 * stage, height within the body, its own last state) and pushes 6 outputs.
 * Stage and height are what let a body plan unfold the same way each
 * generation: a cell knows how many divisions it is from the egg and
 * whether it sits at the top or bottom of the body. A switch's 13 weights sit together so sex
 * passes them on as one block.
 */
export const SWITCHES = 4;
export const SWITCH_INPUTS = 9;
export const OUTPUTS = 6;
export const SWITCH_BLOCK = SWITCH_INPUTS + OUTPUTS;
export const SWITCH_BASE = 24;
/** Switch states of a fresh egg or founding germ cell. */
export const EGG_STATE = 0.5;
export const GENE_COUNT = SWITCH_BASE + SWITCHES * SWITCH_BLOCK;

/** What the switch outputs change, in output order. */
export const Output = { Feed: 0, Swim: 1, Adhere: 2, Defend: 3, Divide: 4, Germ: 5 } as const;
export const INPUT_NAMES = ['bonds', 'signal', 'energy', 'light', 'age', 'bias', 'stage', 'height', 'self'];
export const OUTPUT_NAMES = ['feeding', 'swimming', 'adhesion', 'defence', 'dividing', 'germ'];

export const GENE_NAMES: string[] = [
  'Size',
  'Light feeding',
  'Vent feeding',
  'Engulfing',
  'Motility',
  'Tag red',
  'Tag green',
  'Tag blue',
  'Liked tag red',
  'Liked tag green',
  'Liked tag blue',
  'Tolerance',
  'Gene swapping',
  'Division threshold',
  'Mutation rate',
  'Adhesion',
  'Sharing',
  'Policing',
  'Symbiont keeping',
  'Signal strength',
  'Colony size limit',
  'Sex',
  'Body axis (daughters up)',
  'Body spread (ball vs line)',
  ...Array.from({ length: SWITCHES * SWITCH_BLOCK }, (_, k) => {
    const sw = Math.floor(k / SWITCH_BLOCK) + 1;
    const w = k % SWITCH_BLOCK;
    return w < SWITCH_INPUTS
      ? `Switch ${sw} ← ${INPUT_NAMES[w]}`
      : `Switch ${sw} → ${OUTPUT_NAMES[w - SWITCH_INPUTS]}`;
  }),
];

/** Traits derived once from a genome when a cell is born. */
export interface Traits {
  radius: number;
  /** Normalised feeding shares, sum to 1. */
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
  /** Adult body size in cells. */
  colonyLimit: number;
  sex: number;
  divUp: number;
  divSpread: number;
}

export function radiusOf(g: ArrayLike<number>, o: number): number {
  return 1 + 3 * g[o + Gene.Size];
}

export function traitsOf(g: ArrayLike<number>, o = 0): Traits {
  const l = g[o + Gene.Light];
  const v = g[o + Gene.Vent];
  const e = g[o + Gene.Engulf];
  const sum = l + v + e || 1;
  return {
    radius: radiusOf(g, o),
    light: l / sum,
    vent: v / sum,
    engulf: e / sum,
    motility: g[o + Gene.Motility],
    tolerance: 0.5 * g[o + Gene.Tolerance],
    swap: g[o + Gene.Swap],
    divThreshold: 0.5 + 0.45 * g[o + Gene.DivThreshold],
    mutationRate: 0.01 + 0.29 * g[o + Gene.MutationRate],
    adhesion: g[o + Gene.Adhesion],
    sharing: g[o + Gene.Sharing],
    policing: g[o + Gene.Policing],
    symbiont: g[o + Gene.Symbiont],
    signal: g[o + Gene.Signal],
    colonyLimit: colonyLimitOf(g[o + Gene.ColonySize]),
    sex: g[o + Gene.Sex],
    divUp: g[o + Gene.DivUp],
    divSpread: g[o + Gene.DivSpread],
  };
}

/** Colony size limit from its gene: 2 to 64 cells. */
export function colonyLimitOf(g: number): number {
  return Math.round(2 + 62 * g * g);
}

/**
 * Runs one cell's switch network. Reads `inputs` (the first 8 switch
 * inputs; the 9th is each switch's own state), updates `state[so..so+4)`
 * in place and writes the 6 outputs to `out[oo..oo+6)`. Outputs share a
 * fixed budget: their sizes never add up to more than 1, so a cell that
 * boosts one thing has less to give everything else.
 */
export function runSwitches(
  g: ArrayLike<number>,
  o: number,
  inputs: ArrayLike<number>,
  state: Float32Array,
  so: number,
  out: Float32Array,
  oo: number,
): void {
  for (let s = 0; s < SWITCHES; s++) {
    const b = o + SWITCH_BASE + s * SWITCH_BLOCK;
    let sum = (2 * g[b + 8] - 1) * state[so + s];
    for (let k = 0; k < 8; k++) sum += (2 * g[b + k] - 1) * inputs[k];
    state[so + s] = 1 / (1 + Math.exp(-4 * sum));
  }
  let total = 0;
  for (let k = 0; k < OUTPUTS; k++) {
    let v = 0;
    for (let s = 0; s < SWITCHES; s++) v += (2 * g[o + SWITCH_BASE + s * SWITCH_BLOCK + SWITCH_INPUTS + k] - 1) * state[so + s];
    out[oo + k] = v;
    total += Math.abs(v);
  }
  if (total > 1) for (let k = 0; k < OUTPUTS; k++) out[oo + k] /= total;
}

/**
 * A cell's type from its outputs: the output it boosts most, or plain
 * when nothing stands out. Sex cells are their own type.
 */
export const CELL_TYPES = ['plain', 'feeder', 'swimmer', 'sticky', 'defender', 'divider', 'germ', 'sex cell'];
export const TYPE_THRESHOLD = 0.25;

export function cellTypeOf(out: ArrayLike<number>, oo: number): number {
  let best = -1;
  let bestV = TYPE_THRESHOLD;
  for (let k = 0; k < OUTPUTS; k++) {
    if (out[oo + k] > bestV) {
      bestV = out[oo + k];
      best = k;
    }
  }
  return best + 1;
}

/**
 * Sex: each gene comes from either parent, except that each switch's
 * weights travel together so a working switch is not torn apart.
 */
export function recombine(
  child: Float32Array,
  co: number,
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
  rng: Rng,
): void {
  for (let k = 0; k < SWITCH_BASE; k++) child[co + k] = rng.next() < 0.5 ? a[ao + k] : b[bo + k];
  for (let s = 0; s < SWITCHES; s++) {
    const [src, so] = rng.next() < 0.5 ? [a, ao] : [b, bo];
    const off = SWITCH_BASE + s * SWITCH_BLOCK;
    for (let k = off; k < off + SWITCH_BLOCK; k++) child[co + k] = src[so + k];
  }
}

/**
 * Feeding efficiency from a feeding share. Shares sum to 1, so a generalist
 * is mediocre at everything; a mild exponent tips the balance toward
 * specialists without making the path between niches a dead end.
 */
export function efficiency(share: number): number {
  return Math.pow(share, 1.2);
}

/**
 * Mutates genes[o..o+GENE_COUNT) in place: each gene mutates with
 * probability `rate` by a Gaussian step, clamped to [0, 1].
 */
export function mutate(genes: Float32Array, o: number, rate: number, step: number, rng: Rng): void {
  for (let k = 0; k < GENE_COUNT; k++) {
    if (rng.next() < rate) {
      const v = genes[o + k] + rng.gauss() * step;
      genes[o + k] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

/**
 * Horizontal gene transfer: copies a random run of 1 to 4 consecutive genes
 * from the source genome into the target genome.
 */
export function swapGenes(
  target: Float32Array,
  to: number,
  source: Float32Array,
  so: number,
  rng: Rng,
): void {
  const len = 1 + rng.int(4);
  const start = rng.int(GENE_COUNT - len + 1);
  for (let k = start; k < start + len; k++) target[to + k] = source[so + k];
}

/** Euclidean distance between a tag and a liked tag (RGB, 0..sqrt(3)). */
export function tagDistance(
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
): number {
  const dr = a[ao + Gene.TagR] - b[bo + Gene.LikeR];
  const dg = a[ao + Gene.TagG] - b[bo + Gene.LikeG];
  const db = a[ao + Gene.TagB] - b[bo + Gene.LikeB];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
