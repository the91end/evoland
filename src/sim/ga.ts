import { GENE_COUNT, Gene, lifeFactorOf, mutate, recombine, traitsOf } from './genome';
import type { Params } from './params';
import { Rng, hashSeed } from './rng';
import { World, bodyCells } from './world';

/**
 * Genetic algorithm mode. Each generation is one pond that runs for a
 * fixed number of ticks, started from a population of founder genomes.
 * When time is up, each founder's family is scored by the chosen fitness,
 * the best founders pass on unchanged (elites) and the rest of the next
 * population is bred from tournament winners by crossover and mutation.
 */

export type FitnessKind = 'distance' | 'cells' | 'energy' | 'size';

export const FITNESS_NAMES: Record<FitnessKind, string> = {
  distance: 'Distance travelled',
  cells: 'Living descendants',
  energy: 'Stored energy',
  size: 'Biggest organism',
};

export interface GaSettings {
  /** Founder genomes per generation. */
  population: number;
  /** Ticks each generation's pond runs. */
  duration: number;
  /** Share of the best founders copied unchanged into the next generation. */
  elite: number;
  fitness: FitnessKind;
}

export const DEFAULT_GA: GaSettings = { population: 100, duration: 6000, elite: 0.1, fitness: 'distance' };

export interface GaRecord {
  gen: number;
  best: number;
  mean: number;
  /** Founders with any family left alive at the end. */
  survivors: number;
}

/** What the page shows about a run. */
export interface GaStatus {
  gen: number;
  tick: number;
  settings: GaSettings;
  history: GaRecord[];
  /** The best founder of the last finished generation, if any. */
  best: { fitness: number; genes: number[] } | null;
}

/** Founders breed in tournaments of this many. */
const TOURNAMENT = 3;
/** Chance a child mixes two parents rather than copying one. */
const CROSSOVER = 0.7;

export class GeneticRun {
  world: World;
  gen = 0;
  settings: GaSettings;
  /** Settings to use from the next generation on. */
  private next: GaSettings;
  readonly history: GaRecord[] = [];
  best: GaStatus['best'] = null;
  private readonly rng: Rng;
  private readonly seed: string;
  /** Each founder's starting point (x, z), for the distance score. */
  private start: Float32Array;

  constructor(seed: string, params: Partial<Params>, settings: GaSettings) {
    this.seed = seed;
    this.settings = { ...settings };
    this.next = { ...settings };
    this.rng = new Rng(hashSeed(`${seed}-ga`));
    // Generation 0 is the pond's usual random start.
    this.world = new World(`${seed}-g0`, { ...params, startingCells: settings.population });
    this.start = this.markFounders();
  }

  /** New settings take effect when the next generation starts. */
  update(settings: GaSettings): void {
    this.next = { ...settings };
  }

  status(): GaStatus {
    return { gen: this.gen, tick: this.world.tick, settings: this.settings, history: this.history, best: this.best };
  }

  /** Runs one tick; returns true when a new generation started. */
  step(): boolean {
    this.world.step();
    if (this.world.tick < this.settings.duration) return false;
    this.nextGeneration();
    return true;
  }

  /** Scores each founder's family in the current pond. */
  scores(): Float64Array {
    const w = this.world;
    const pop = this.settings.population;
    const score = new Float64Array(pop);
    const weight = new Float64Array(pop);
    const W = w.p.width;
    const away = (k: number, x: number, z: number) =>
      Math.hypot(wrapDelta(x - this.start[k * 2], W), wrapDelta(z - this.start[k * 2 + 1], W));
    const kind = this.settings.fitness;
    w.findColonies();
    for (let i = 0; i < w.n; i++) {
      const k = w.clan[i];
      if (w.dead[i] || k < 0 || k >= pop) continue;
      weight[k]++;
      if (kind === 'distance') score[k] += away(k, w.x[i], w.z[i]);
      else if (kind === 'cells') score[k]++;
      else if (kind === 'energy') score[k] += w.energy[i];
      else score[k] = Math.max(score[k], w.colonySize[i]);
    }
    for (const b of w.bodies) {
      const k = b.clan;
      if (b.dead || k < 0 || k >= pop) continue;
      const c = bodyCells(b);
      weight[k] += c;
      if (kind === 'distance') score[k] += c * away(k, b.x, b.z);
      else if (kind === 'cells') score[k] += c;
      else if (kind === 'energy') score[k] += b.energy;
      else score[k] = Math.max(score[k], c);
    }
    // Distance is the family's average, so a big family doesn't win by size alone.
    if (kind === 'distance') for (let k = 0; k < pop; k++) if (weight[k] > 0) score[k] /= weight[k];
    return score;
  }

  private nextGeneration(): void {
    const w = this.world;
    const G = GENE_COUNT;
    const pop = this.settings.population;
    const score = this.scores();
    // The founders' genomes are where each family started.
    const founders = this.founderGenes;
    let best = 0;
    let sum = 0;
    let survivors = 0;
    const alive = new Uint8Array(pop);
    for (let i = 0; i < w.n; i++) if (!w.dead[i] && w.clan[i] >= 0 && w.clan[i] < pop) alive[w.clan[i]] = 1;
    for (const b of w.bodies) if (!b.dead && b.clan >= 0 && b.clan < pop) alive[b.clan] = 1;
    for (let k = 0; k < pop; k++) {
      sum += score[k];
      survivors += alive[k];
      if (score[k] > score[best]) best = k;
    }
    this.history.push({ gen: this.gen, best: score[best], mean: sum / pop, survivors });
    this.best = { fitness: score[best], genes: Array.from(founders.subarray(best * G, (best + 1) * G)) };

    // Breed the next population.
    this.settings = { ...this.next };
    const size = this.settings.population;
    const order = Array.from({ length: pop }, (_, k) => k).sort((a, b) => score[b] - score[a]);
    const elites = Math.min(size, Math.round(this.settings.elite * size));
    const child = new Float32Array(size * G);
    const rng = this.rng;
    const pick = () => {
      let winner = rng.int(pop);
      for (let t = 1; t < TOURNAMENT; t++) {
        const c = rng.int(pop);
        if (score[c] > score[winner]) winner = c;
      }
      return winner;
    };
    for (let k = 0; k < size; k++) {
      if (k < elites) {
        child.set(founders.subarray(order[k % pop] * G, (order[k % pop] + 1) * G), k * G);
        continue;
      }
      const a = pick();
      if (rng.chance(CROSSOVER)) recombine(child, k * G, founders, a * G, founders, pick() * G, rng);
      else child.set(founders.subarray(a * G, (a + 1) * G), k * G);
      mutate(child, k * G, traitsOf(founders, a * G).mutationRate, w.p.mutationStep, rng);
    }

    // A fresh pond, seeded with the new founders.
    this.gen++;
    const live = { ...w.p };
    const nw = new World(`${this.seed}-g${this.gen}`, { ...live, startingCells: size });
    for (let k = 0; k < nw.n; k++) {
      nw.genes.set(child.subarray(k * G, (k + 1) * G), k * G);
      nw.refreshTraitsFor(k);
      nw.energy[k] = 0.55 * nw.maxE[k];
      nw.age[k] = 0;
      nw.lifespan[k] = Math.round(nw.p.lifespan * lifeFactorOf(child[k * G + Gene.Lifespan]));
    }
    nw.speciesTracker.recluster(nw);
    this.world = nw;
    this.start = this.markFounders();
  }

  /** Founder genomes of the current generation, captured at its start. */
  private founderGenes = new Float32Array(0);

  private markFounders(): Float32Array {
    const w = this.world;
    const start = new Float32Array(w.n * 2);
    for (let k = 0; k < w.n; k++) {
      w.clan[k] = k;
      start[k * 2] = w.x[k];
      start[k * 2 + 1] = w.z[k];
    }
    this.founderGenes = w.genes.slice(0, w.n * GENE_COUNT);
    return start;
  }
}

function wrapDelta(d: number, w: number): number {
  if (d > w / 2) return d - w;
  if (d < -w / 2) return d + w;
  return d;
}
