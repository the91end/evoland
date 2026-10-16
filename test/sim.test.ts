import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import {
  GENE_COUNT,
  Gene,
  OUTPUTS,
  SWITCHES,
  SWITCH_BASE,
  SWITCH_BLOCK,
  mutate,
  recombine,
  runSwitches,
  swapGenes,
  traitsOf,
  lifeFactorOf,
} from '../src/sim/genome';
import { World, sunAt } from '../src/sim/world';

const SMALL = { startingCells: 120, cellCap: 1500 };

describe('Rng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('genome', () => {
  it('keeps mutated genes inside [0, 1]', () => {
    const g = new Float32Array(GENE_COUNT).fill(0.99);
    const r = new Rng(1);
    for (let k = 0; k < 200; k++) mutate(g, 0, 1, 0.3, r);
    for (const v of g) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('maps the lifespan gene from 0.25x to 4x, 1x at the midpoint', () => {
    expect(lifeFactorOf(0)).toBeCloseTo(0.25);
    expect(lifeFactorOf(0.5)).toBeCloseTo(1);
    expect(lifeFactorOf(1)).toBeCloseTo(4);
  });

  it('normalises feeding shares to sum to 1', () => {
    const g = new Float32Array(GENE_COUNT).fill(0.5);
    g[Gene.Light] = 0.9;
    g[Gene.Vent] = 0.3;
    g[Gene.Engulf] = 0;
    const t = traitsOf(g);
    expect(t.light + t.vent + t.engulf).toBeCloseTo(1);
    expect(t.light).toBeCloseTo(0.75);
  });

  it('maps traits onto the ranges in the design doc', () => {
    const lo = traitsOf(new Float32Array(GENE_COUNT).fill(0));
    const hi = traitsOf(new Float32Array(GENE_COUNT).fill(1));
    expect([lo.radius, hi.radius]).toEqual([1, 4]);
    expect([lo.tolerance, hi.tolerance]).toEqual([0, 0.5]);
    expect(lo.divThreshold).toBeCloseTo(0.5);
    expect(hi.divThreshold).toBeCloseTo(0.95);
    expect(lo.mutationRate).toBeCloseTo(0.01);
    expect(hi.mutationRate).toBeCloseTo(0.3);
  });

  it('swaps a run of 1 to 4 genes', () => {
    const r = new Rng(3);
    for (let k = 0; k < 50; k++) {
      const a = new Float32Array(GENE_COUNT).fill(0);
      const b = new Float32Array(GENE_COUNT).fill(1);
      swapGenes(a, 0, b, 0, r);
      const copied = [...a].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
      expect(copied.length).toBeGreaterThanOrEqual(1);
      expect(copied.length).toBeLessThanOrEqual(4);
      expect(copied[copied.length - 1] - copied[0]).toBe(copied.length - 1);
    }
  });
});

describe('World', () => {
  it('replays exactly from its seed', () => {
    const a = new World('replay', SMALL);
    const b = new World('replay', SMALL);
    for (let t = 0; t < 400; t++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.n).toBe(b.n);
  });

  it('diverges for different seeds', () => {
    const a = new World('one', SMALL);
    const b = new World('two', SMALL);
    for (let t = 0; t < 100; t++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).not.toBe(b.checksum());
  });

  it('starts with one light-feeding species that trusts its kin', () => {
    const w = new World(5, SMALL);
    expect(w.n).toBe(SMALL.startingCells);
    for (let i = 0; i < w.n; i++) {
      expect(w.shareL[i]).toBeGreaterThan(0.6);
      const o = i * GENE_COUNT;
      expect(w.genes[o + Gene.LikeR]).toBe(w.genes[o + Gene.TagR]);
    }
  });

  it('keeps cells inside the pond, within energy limits and under the cap', () => {
    const w = new World('bounds', SMALL);
    for (let t = 0; t < 600; t++) w.step();
    expect(w.n).toBeGreaterThan(0);
    expect(w.n).toBeLessThanOrEqual(SMALL.cellCap);
    for (let i = 0; i < w.n; i++) {
      expect(w.dead[i]).toBe(0);
      expect(w.x[i]).toBeGreaterThanOrEqual(0);
      expect(w.x[i]).toBeLessThan(w.p.width);
      expect(w.z[i]).toBeGreaterThanOrEqual(0);
      expect(w.z[i]).toBeLessThan(w.p.width);
      expect(w.y[i]).toBeGreaterThanOrEqual(0);
      expect(w.y[i]).toBeLessThanOrEqual(w.p.depth);
      expect(w.energy[i]).toBeGreaterThan(0);
      expect(w.energy[i]).toBeLessThanOrEqual(w.maxE[i] + 1e-3);
    }
  });

  it('cells divide and record their parents', () => {
    const w = new World('lineage', SMALL);
    for (let t = 0; t < 600; t++) w.step();
    expect(w.totalBorn).toBeGreaterThan(SMALL.startingCells);
    let withParent = 0;
    for (let i = 0; i < w.n; i++) if (w.parent[i] > 0) withParent++;
    expect(withParent).toBeGreaterThan(0);
  });

  it('assigns every living cell to a species', () => {
    const w = new World('species', { ...SMALL, speciesEvery: 100 });
    for (let t = 0; t < 300; t++) w.step();
    const ids = new Set(w.livingSpecies().map((s) => s.id));
    for (let i = 0; i < w.n; i++) expect(ids.has(w.species[i])).toBe(true);
  });
});

describe('sun', () => {
  it('is up for the first half of the day and down for the second', () => {
    expect(sunAt(750, 3000)).toBeCloseTo(1);
    expect(sunAt(2250, 3000)).toBe(0);
  });
});

describe('colonies and partners', () => {
  it('keeps every bond two-sided and pointing at a living cell', () => {
    const w = new World('bonds', SMALL);
    for (let t = 0; t < 600; t++) w.step();
    let bonds = 0;
    for (let i = 0; i < w.n; i++) {
      expect(w.bondCount[i]).toBeLessThanOrEqual(w.mb);
      for (let s = 0; s < w.bondCount[i]; s++) {
        const j = w.bondTo[i * w.mb + s];
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThan(w.n);
        expect(j).not.toBe(i);
        expect(w.bondSlot(j, i)).toBeGreaterThanOrEqual(0);
        bonds++;
      }
    }
    expect(bonds).toBeGreaterThan(0);
  });

  it('labels bonded cells as one colony', () => {
    const w = new World('colony', SMALL);
    for (let t = 0; t < 300; t++) w.step();
    w.findColonies();
    for (let i = 0; i < w.n; i++)
      for (let s = 0; s < w.bondCount[i]; s++) {
        const j = w.bondTo[i * w.mb + s];
        expect(w.colony[j]).toBe(w.colony[i]);
        expect(w.colonySize[i]).toBeGreaterThan(1);
      }
  });

  it('keeps guest counts within the limit', () => {
    const w = new World('guests', { ...SMALL, startTolerance: 0 });
    for (let t = 0; t < 600; t++) w.step();
    for (let i = 0; i < w.n; i++) expect(w.guestCount[i]).toBeLessThanOrEqual(w.mg);
  });
});

describe('multicellular genes', () => {
  it('keeps switch outputs inside the shared budget', () => {
    const r = new Rng(3);
    const g = new Float32Array(GENE_COUNT);
    const state = new Float32Array(SWITCHES).fill(0.5);
    const out = new Float32Array(OUTPUTS);
    for (let t = 0; t < 50; t++) {
      for (let k = 0; k < GENE_COUNT; k++) g[k] = r.next();
      runSwitches(g, 0, [r.next(), r.next(), r.next(), r.next(), r.next(), 1, r.next(), 2 * r.next() - 1, r.next()], state, 0, out, 0);
      expect(out.reduce((s, v) => s + Math.abs(v), 0)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('passes each switch on as one block during sex', () => {
    const a = new Float32Array(GENE_COUNT).fill(0);
    const b = new Float32Array(GENE_COUNT).fill(1);
    const child = new Float32Array(GENE_COUNT);
    recombine(child, 0, a, 0, b, 0, new Rng(9));
    for (let s = 0; s < SWITCHES; s++) {
      const block = child.subarray(SWITCH_BASE + s * SWITCH_BLOCK, SWITCH_BASE + (s + 1) * SWITCH_BLOCK);
      expect(new Set(block).size).toBe(1);
    }
  });

  it('runs with cell types counted in the stats', () => {
    const w = new World('types', SMALL);
    for (let t = 0; t < 100; t++) w.step();
    const last = w.history[w.history.length - 1];
    expect(last.types.reduce((s, v) => s + v, 0)).toBe(last.cells);
  });
});

describe('development', () => {
  it('starts a body from the egg state and stops growing at adult size', () => {
    const w = new World('dev', { startingCells: 1, cellCap: 300, mutationStep: 0 });
    const g = w.genes;
    // A sticky cell whose body plan says "grow to 4 cells".
    g[Gene.Adhesion] = 1;
    g[Gene.ColonySize] = 0.1; // 2 * 1024^0.1 = 4 cells
    w.refreshTraitsFor(0);
    w.energy[0] = w.maxE[0];
    w.age[0] = 0;
    w.lifespan[0] = 1e6;
    for (let t = 0; t < 600 && w.n > 0; t++) {
      for (let i = 0; i < w.n; i++) {
        w.energy[i] = w.maxE[i];
        w.lifespan[i] = 1e6;
      }
      w.step();
    }
    w.findColonies();
    expect(Math.max(...w.colonySize.subarray(0, w.n))).toBeLessThanOrEqual(4);
    expect(w.stage[0]).toBeGreaterThan(0);
  });

  it('turns a body past the threshold into a big organism', () => {
    const w = new World('big', { startingCells: 1, cellCap: 300, mutationStep: 0, bodyThreshold: 4 });
    const g = w.genes;
    g[Gene.Adhesion] = 1;
    g[Gene.ColonySize] = 0.3; // grows to 16 cells
    w.refreshTraitsFor(0);
    for (let t = 0; t < 600 && w.bodiesFormed === 0; t++) {
      for (let i = 0; i < w.n; i++) {
        w.energy[i] = w.maxE[i];
        w.lifespan[i] = 1e6;
      }
      w.step();
    }
    expect(w.bodiesFormed).toBeGreaterThan(0);
  });
});

describe('save and load', () => {
  it('carries on exactly as the saved pond would have', async () => {
    const { saveWorld, loadWorld } = await import('../src/sim/save');
    const a = new World('save', SMALL);
    for (let t = 0; t < 120; t++) a.step();
    const file = await saveWorld(a);
    const b = await loadWorld(file);
    expect(b.tick).toBe(a.tick);
    expect(b.checksum()).toBe(a.checksum());
    for (let t = 0; t < 120; t++) {
      a.step();
      b.step();
    }
    expect(b.checksum()).toBe(a.checksum());
    expect(b.speciesTracker.list().length).toBe(a.speciesTracker.list().length);
  });
});

describe('zip', () => {
  it('round-trips one stored file', async () => {
    const { zipOne, unzipOne } = await import('../src/zip');
    const data = new Uint8Array([1, 2, 3, 250, 0, 7]);
    expect(Array.from(unzipOne(zipOne('pond.evoland', data)))).toEqual(Array.from(data));
  });
});
