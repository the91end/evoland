import { World } from './world';

/**
 * Saves a whole World (cells, bodies, debris, vents, lineage, species,
 * history and the random number generator) to a gzipped file, and loads
 * it back. A loaded pond carries on exactly as the saved one would have.
 *
 * Format: "EVO1", a u32 header length, a JSON header, then every typed
 * array's bytes, 8-byte aligned; the whole thing gzipped.
 */

const MAGIC = 'EVO1';
/**
 * 2: the lifespan gene shifted the switch genes by one.
 * 3: weight, crawling and rhythm genes, the rhythm input and the muscle and grip outputs.
 */
const VERSION = 3;

/** Scratch buffers rebuilt every tick: not worth saving. */
const SKIP = new Set(['near', 'tmp', 'bucketStart', 'bucketOf', 'cursor', 'sorted', 'order']);

type Typed =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Uint8Array;

const TYPED: Record<string, new (b: ArrayBuffer, o: number, n: number) => Typed> = {
  Float32Array,
  Float64Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Uint8Array,
};

interface BlobInfo {
  type: string;
  offset: number;
  length: number;
}

function encode(v: unknown, blobs: Typed[]): unknown {
  if (ArrayBuffer.isView(v)) {
    blobs.push(v as Typed);
    return { $t: v.constructor.name, $i: blobs.length - 1 };
  }
  if (v instanceof Map) return { $m: [...v.entries()].map(([k, x]) => [k, encode(x, blobs)]) };
  if (Array.isArray(v)) return v.map((x) => encode(x, blobs));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = encode(x, blobs);
    return o;
  }
  return v;
}

function decode(v: unknown, blobs: Typed[]): unknown {
  if (Array.isArray(v)) return v.map((x) => decode(x, blobs));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$t' in o) return blobs[o.$i as number];
    if ('$m' in o) return new Map((o.$m as [unknown, unknown][]).map(([k, x]) => [k, decode(x, blobs)]));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = decode(x, blobs);
    return out;
  }
  return v;
}

/** The world's state as a plain object, with class instances flattened to their fields. */
function stateOf(w: World): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) {
    if (SKIP.has(k)) continue;
    state[k] = k === 'rng' || k === 'speciesTracker' ? { ...(v as object) } : v;
  }
  return state;
}

export async function saveWorld(w: World): Promise<Uint8Array> {
  const blobs: Typed[] = [];
  const state = encode(stateOf(w), blobs);
  const layout: BlobInfo[] = [];
  let offset = 0;
  for (const b of blobs) {
    layout.push({ type: b.constructor.name, offset, length: b.length });
    offset += Math.ceil(b.byteLength / 8) * 8;
  }
  const header = new TextEncoder().encode(
    JSON.stringify({ version: VERSION, seed: w.seed, params: w.p, layout, state }),
  );
  const start = 8 + Math.ceil(header.byteLength / 8) * 8;
  const raw = new Uint8Array(start + offset);
  raw.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(raw.buffer).setUint32(4, header.byteLength, true);
  raw.set(header, 8);
  blobs.forEach((b, k) => raw.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), start + layout[k].offset));
  return gzip(raw);
}

export async function loadWorld(file: Uint8Array): Promise<World> {
  const raw = await gunzip(file);
  if (new TextDecoder().decode(raw.subarray(0, 4)) !== MAGIC) throw new Error('This is not an evoland save file.');
  const len = new DataView(raw.buffer, raw.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + len)));
  if (header.version !== VERSION) throw new Error(`Save file version ${header.version} is not supported.`);
  const start = 8 + Math.ceil(len / 8) * 8;
  // Copy the data section so typed arrays start 8-byte aligned.
  const data = raw.slice(start).buffer;
  const blobs = (header.layout as BlobInfo[]).map((b) => new TYPED[b.type](data, b.offset, b.length));
  const state = decode(header.state, blobs) as Record<string, unknown>;

  const w = new World(header.seed, header.params);
  const target = w as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(state)) {
    if (k === 'rng' || k === 'speciesTracker') Object.assign(target[k] as object, v);
    else target[k] = v;
  }
  return w;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'));
const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'));
