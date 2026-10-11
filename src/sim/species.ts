import { GENE_COUNT, Gene } from './genome';
import type { World } from './world';

/** Clusters smaller than this fold into their nearest species instead of founding one. */
const MIN_FOUNDERS = 5;
const DIM = 6;

export interface SpeciesInfo {
  id: number;
  /** Species it split from, or 0 for the founding species. */
  parent: number;
  born: number;
  /** Tick it went extinct, or -1 while alive. */
  extinct: number;
  count: number;
  /** Mean tag colour (RGB 0..1). */
  tag: [number, number, number];
  /** Mean light / vent / engulfing shares. */
  feeding: [number, number, number];
  meanRadius: number;
  peak: number;
}

/**
 * Groups cells into species by their tag colour and feeding shares, and
 * keeps species ids stable between reclusterings so a family tree of
 * species can be drawn. Ids only change when a group has drifted further
 * than `distance` from every existing species.
 */
export class Species {
  private nextId = 1;
  private readonly all = new Map<number, SpeciesInfo>();
  private centroids: { id: number; c: Float64Array }[] = [];

  constructor(private readonly distance: number) {}

  list(): SpeciesInfo[] {
    return [...this.all.values()];
  }

  get(id: number): SpeciesInfo | undefined {
    return this.all.get(id);
  }

  recluster(w: World): void {
    const n = w.n;
    const feat = new Float64Array(n * DIM);
    for (let i = 0; i < n; i++) features(w, i, feat, i * DIM);

    const thr2 = this.distance * this.distance;
    const assign = new Int32Array(n).fill(-1);

    // 1. Keep cells in the existing species they are still close to.
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bestD = thr2;
      for (const s of this.centroids) {
        const d = dist2(feat, i * DIM, s.c, 0);
        if (d <= bestD) {
          bestD = d;
          best = s.id;
        }
      }
      assign[i] = best;
    }

    // 2. Leader-cluster the rest; big enough groups found new species.
    const leaders: { c: Float64Array; members: number[] }[] = [];
    for (let i = 0; i < n; i++) {
      if (assign[i] >= 0) continue;
      let best: (typeof leaders)[number] | null = null;
      let bestD = thr2;
      for (const L of leaders) {
        const d = dist2(feat, i * DIM, L.c, 0);
        if (d <= bestD) {
          bestD = d;
          best = L;
        }
      }
      if (best) best.members.push(i);
      else leaders.push({ c: feat.slice(i * DIM, i * DIM + DIM), members: [i] });
    }
    const newCentroids: { id: number; c: Float64Array }[] = [];
    const stragglers: number[] = [];
    for (const L of leaders) {
      if (L.members.length < MIN_FOUNDERS && (this.centroids.length > 0 || newCentroids.length > 0)) {
        stragglers.push(...L.members);
        continue;
      }
      const parent = mostCommon(L.members.map((i) => w.species[i]));
      const id = this.nextId++;
      this.all.set(id, {
        id,
        parent: parent > 0 ? parent : 0,
        born: w.tick,
        extinct: -1,
        count: 0,
        tag: [0, 0, 0],
        feeding: [0, 0, 0],
        meanRadius: 0,
        peak: 0,
      });
      for (const i of L.members) assign[i] = id;
      newCentroids.push({ id, c: L.c });
    }

    // 3. Stragglers join their nearest species, whatever the distance.
    const pool = [...this.centroids, ...newCentroids];
    for (const i of stragglers) {
      let best = pool[0]?.id ?? -1;
      let bestD = Infinity;
      for (const s of pool) {
        const d = dist2(feat, i * DIM, s.c, 0);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
      assign[i] = best;
    }

    // 4. Recompute centroids and stats.
    const sums = new Map<number, { c: Float64Array; r: number; count: number }>();
    for (let i = 0; i < n; i++) {
      const id = assign[i];
      w.species[i] = id;
      const rec = w.lineage.get(w.id[i]);
      if (rec) rec.species = id;
      let s = sums.get(id);
      if (!s) sums.set(id, (s = { c: new Float64Array(DIM), r: 0, count: 0 }));
      for (let k = 0; k < DIM; k++) s.c[k] += feat[i * DIM + k];
      s.r += w.radius[i];
      s.count++;
    }
    this.centroids = [];
    for (const info of this.all.values()) {
      const s = sums.get(info.id);
      if (!s) {
        info.count = 0;
        if (info.extinct < 0) info.extinct = w.tick;
        continue;
      }
      for (let k = 0; k < DIM; k++) s.c[k] /= s.count;
      info.count = s.count;
      info.peak = Math.max(info.peak, s.count);
      info.tag = [s.c[0], s.c[1], s.c[2]];
      info.feeding = [s.c[3], s.c[4], s.c[5]];
      info.meanRadius = s.r / s.count;
      info.extinct = -1;
      this.centroids.push({ id: info.id, c: s.c });
    }
  }
}

function features(w: World, i: number, out: Float64Array, o: number): void {
  const g = i * GENE_COUNT;
  out[o] = w.genes[g + Gene.TagR];
  out[o + 1] = w.genes[g + Gene.TagG];
  out[o + 2] = w.genes[g + Gene.TagB];
  out[o + 3] = w.shareL[i];
  out[o + 4] = w.shareV[i];
  out[o + 5] = w.shareE[i];
}

function dist2(a: Float64Array, ao: number, b: Float64Array, bo: number): number {
  let s = 0;
  for (let k = 0; k < DIM; k++) {
    const d = a[ao + k] - b[bo + k];
    s += d * d;
  }
  return s;
}

function mostCommon(xs: number[]): number {
  const counts = new Map<number, number>();
  let best = 0;
  let bestN = 0;
  for (const x of xs) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > bestN) {
      bestN = c;
      best = x;
    }
  }
  return best;
}
