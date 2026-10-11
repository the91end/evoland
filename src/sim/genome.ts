import type { Rng } from './rng';

/**
 * Gene layout. Every gene is a number in [0, 1]; traits map them onto
 * real ranges. Phase 1 genes only: adhesion, sharing, policing, the switch
 * network and the rest are appended in later phases.
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
} as const;

export const GENE_COUNT = 15;

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
  };
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
