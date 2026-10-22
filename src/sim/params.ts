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
  /** Days per year. Summer days are longer and brighter, winter days shorter and dimmer. */
  yearLength: number;
  /** How strongly seasons change day length and brightness (0 = no seasons). */
  seasonSwing: number;
  /** How far the slow climate drift can brighten or dim the sun (0 = steady). */
  climateSwing: number;
  /** How far slow shifts in volcanic activity can change the number of vents. */
  volcanoSwing: number;
  /** Ticks over which climate and volcanism wander. */
  climateTime: number;
  startingCells: number;
  /**
   * Tag distance the starting cells still treat as kin. Starting picky
   * means drifting tags turn relatives into strangers (and prey) sooner.
   */
  startTolerance: number;
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
  /**
   * Basal cost per tick = kBasal * radius^2, scaled by how hard the cell
   * feeds: restCost of it when the Feed output is fully off, 1 at neutral.
   */
  kBasal: number;
  /** Share of basal cost a cell still pays when it stops feeding entirely. */
  restCost: number;
  /**
   * Repair upkeep for living longer: basal cost is multiplied by
   * 1 + repairCost * (lifespan multiplier - 1), so a 4x lifespan costs
   * 1 + 3 * repairCost and a 0.25x lifespan saves 0.75 * repairCost.
   */
  repairCost: number;
  /** Swimming cost per tick = kSwim * force^2 * radius^2. */
  kSwim: number;
  /** Flagellum upkeep per tick, even at rest = kFlagellum * motility * radius^2. */
  kFlagellum: number;
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

  // Weight, surfaces and muscle
  /** Sinking speed per tick of the heaviest cell; the lightest rises as fast. */
  gravity: number;
  /** Upkeep of floating = kFloat * lift * radius^2 (gas pockets cost protein; sinking is free). */
  kFloat: number;
  /** How much the floor holds a resting cell still (0 = slides like ice, 1 = stuck). */
  floorFriction: number;
  /** Top crawling speed along a surface, before the cell's size slows it. */
  crawlSpeed: number;
  /** Pili upkeep per tick = kCrawl * crawl * radius^2. */
  kCrawl: number;
  /** Most a muscle cell can shorten or stretch its bonds, as a fraction of touching distance. */
  muscleStrength: number;
  /** Muscle cost per tick = kMuscle * |contraction| * radius^2. */
  kMuscle: number;

  // Colonies and partners
  /** Bond upkeep per bond per tick (k_d). */
  kBond: number;
  maxBonds: number;
  /** Chance per tick that touching friends bond, scaled by both adhesion genes. */
  bondRate: number;
  /** Fraction of spare energy a full sharer passes along its bonds per tick. */
  shareRate: number;
  /** Ticks over which a policing cell compares what it gave and got back. */
  policingWindow: number;
  /** By-product released per unit of food eaten (sugar, fertiliser). */
  byproduct: number;
  maxGuests: number;
  /** Fraction of a guest's food it passes to its host. */
  guestPass: number;
  /** Host upkeep per guest per tick, times guest radius squared. */
  kGuest: number;

  // Multicellular life
  /** Energy fraction at which a germ cell leaves its colony. */
  germEnergy: number;
  /** Ticks a sex cell lives while it looks for a partner. */
  gameteLife: number;
  /** Bodies this many cells big switch to the simpler big-organism model. */
  bodyThreshold: number;
  /** Lifespan of a big organism, in ticks. */
  bodyLifespan: number;

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
  yearLength: 20,
  seasonSwing: 0.3,
  climateSwing: 0.35,
  volcanoSwing: 0.6,
  climateTime: 150000,
  startingCells: 300,
  startTolerance: 0.1,
  cellCap: 5000,
  ventCount: 5,
  ventLifetime: 20000,
  lightHalfDepth: 75,
  hashCell: 20,

  energyPerVolume: 5,
  kBasal: 0.004,
  restCost: 0.3,
  repairCost: 0.2,
  kSwim: 0.005,
  kFlagellum: 0.001,
  kLight: 0.1,
  kVent: 0.4,
  lightPerColumn: 0.45,
  ventSpread: 50,
  ventPlume: 150,
  ventStock: 3000,
  ventRegen: 8,
  engulfGain: 0.6,
  debrisFraction: 0.3,

  gravity: 0.03,
  kFloat: 0.0005,
  floorFriction: 0.5,
  crawlSpeed: 0.6,
  kCrawl: 0.0005,
  muscleStrength: 0.4,
  kMuscle: 0.0005,

  kBond: 0.002,
  maxBonds: 6,
  bondRate: 0.01,
  shareRate: 0.05,
  policingWindow: 200,
  byproduct: 0.2,
  maxGuests: 4,
  guestPass: 0.5,
  kGuest: 0.001,

  germEnergy: 0.7,
  gameteLife: 500,
  bodyThreshold: 64,
  bodyLifespan: 9000,

  divisionLoss: 0.1,
  divisionCooldown: 60,
  lifespan: 3000,
  mutationStep: 0.05,
  maxSpeed: 2,
  senseRadius: 20,
  speciesDistance: 0.15,
  speciesEvery: 500,
};
