/**
 * Runs the simulation without a browser and prints a summary, for tuning
 * and for checking the Phase 1 goal: distinct species with different tags
 * and feeding modes coexisting.
 *
 *   npm run headless -- [seed] [ticks]
 *   PARAMS='{"kLight":0.05}' npm run headless -- 1 20000
 */
import { World } from '../src/sim/world';
import { GENE_COUNT, Gene } from '../src/sim/genome';

const seed = process.argv[2] ?? '1';
const ticks = Number(process.argv[3] ?? 30000);
const every = Math.max(500, Math.round(ticks / 30));

const overrides = process.env.PARAMS ? JSON.parse(process.env.PARAMS) : {};
const w = new World(seed, overrides);
const t0 = performance.now();
let last = t0;
console.log(`seed ${seed}, ${ticks} ticks`, overrides);
console.log('tick     cells  light   vent engulf debris  r̄    species(≥10)  ms/tick  mean share L/V/E');
for (let t = 1; t <= ticks; t++) {
  w.step();
  if (t % every === 0 || t === ticks) {
    const h = w.history[w.history.length - 1];
    const now = performance.now();
    const sp = w.livingSpecies(10).length;
    console.log(
      [
        String(w.tick).padEnd(8),
        String(w.n).padStart(5),
        String(h.light).padStart(6),
        String(h.vent).padStart(6),
        String(h.engulf).padStart(6),
        String(w.nd).padStart(6),
        h.meanRadius.toFixed(2).padStart(5),
        String(sp).padStart(10),
        ((now - last) / every).toFixed(2).padStart(10),
        '  ' + meanShares(),
      ].join(' '),
    );
    last = now;
    if (w.n === 0) break;
  }
}
console.log(`\n${((performance.now() - t0) / 1000).toFixed(1)}s total, ${w.totalBorn} born, ${w.engulfed} engulfed, ${w.swaps} gene swaps`);
console.log('\nSpecies with 10+ cells:');
for (const s of w.livingSpecies(10).sort((a, b) => b.count - a.count)) {
  const f = s.feeding.map((v) => v.toFixed(2)).join('/');
  const tag = s.tag.map((v) => v.toFixed(2)).join(',');
  console.log(`  #${s.id} (from #${s.parent}) ${s.count} cells, tag (${tag}), feeding L/V/E ${f}, r ${s.meanRadius.toFixed(2)}`);
}

function meanShares(): string {
  let l = 0,
    v = 0,
    e = 0;
  for (let i = 0; i < w.n; i++) {
    l += w.shareL[i];
    v += w.shareV[i];
    e += w.shareE[i];
  }
  const n = w.n || 1;
  let tol = 0;
  const mean = [0, 0, 0];
  for (let i = 0; i < w.n; i++) {
    tol += w.tol[i];
    for (let k = 0; k < 3; k++) mean[k] += w.genes[i * GENE_COUNT + Gene.TagR + k] / n;
  }
  let spread = 0;
  for (let i = 0; i < w.n; i++)
    for (let k = 0; k < 3; k++) spread += (w.genes[i * GENE_COUNT + Gene.TagR + k] - mean[k]) ** 2 / n;
  return (
    [l, v, e].map((x) => (x / n).toFixed(2)).join('/') +
    `  tol ${(tol / n).toFixed(3)}  tag sd ${Math.sqrt(spread).toFixed(3)}`
  );
}
