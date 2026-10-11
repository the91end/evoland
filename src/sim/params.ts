/**
 * Tunable world parameters. Defaults follow the design doc's
 * "Default parameters" table; the energy constants are first-pass tuning.
 */
export interface Params {
  /** Pond width and length (x and z), wraps at the sides. */
  width: number;
  /** Pond depth (y from floor at 0 to surface at depth). */
  depth: number;
  ticksPerSecond: number;
  /** Full day+night cycle length in ticks (half day, half night). */
  dayLength: number;
  startingCells: number;
  cellCap: number;
  ventCount: number;
  /** Mean vent lifetime in ticks. */
  ventLifetime: number;
  /** Light halves every this many units of depth. */
  lightHalfDepth: number;
  /** Spatial hash cell size. */
  hashCell: number;

  // Energy
  /** Max energy = energyPerVolume * radius^3. */
  energyPerVolume: number;
  /** Basal cost per tick = kBasal * radius^2. */
  kBasal: number;
  /** Swimming cost per tick = kSwim * force^2 * radius^2. */
  kSwim: number;
  /** Light gain per tick at full sun = kLight * eff * radius^2. */
  kLight: number;
  /** Vent gain per tick at full food = kVent * eff * radius^2. */
  kVent: number;
  /**
   * Most light energy one water column (hashCell x hashCell) can hand out
   * per tick at full sun; crowded columns share it.
   */
  lightPerColumn: number;
  /** Width (std dev) of the food plume around a vent. */
  ventSpread: number;
  /** Plume food falls by e every this many units above the floor. */
  ventPlume: number;
  /** Food a vent can hold, and how fast it refills per tick. */
  ventStock: number;
  ventRegen: number;
  /** Fraction of prey energy an engulfer gains. */
  engulfGain: number;
  /** Fraction of a cell's energy left as debris when it dies. */
  debrisFraction: number;

  // Life cycle
  divisionLoss: number;
  divisionCooldown: number;
  lifespan: number;
  mutationStep: number;
  maxSpeed: number;
  senseRadius: number;
  speciesDistance: number;
  speciesEvery: number;
}

export const DEFAULT_PARAMS: Params = {
  width: 800,
  depth: 300,
  ticksPerSecond: 30,
  dayLength: 3000,
  startingCells: 300,
  cellCap: 5000,
  ventCount: 5,
  ventLifetime: 20000,
  lightHalfDepth: 75,
  hashCell: 20,

  energyPerVolume: 5,
  kBasal: 0.004,
  kSwim: 0.005,
  kLight: 0.1,
  kVent: 0.4,
  lightPerColumn: 0.45,
  ventSpread: 50,
  ventPlume: 150,
  ventStock: 3000,
  ventRegen: 8,
  engulfGain: 0.6,
  debrisFraction: 0.3,

  divisionLoss: 0.1,
  divisionCooldown: 60,
  lifespan: 3000,
  mutationStep: 0.05,
  maxSpeed: 2,
  senseRadius: 20,
  speciesDistance: 0.15,
  speciesEvery: 500,
};
