import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Params } from '../sim/params';
import { currentAt } from '../sim/world';
import type { BodyFrame, Frame } from '../protocol';

export type ColourMode = 'tag' | 'species' | 'feeding' | 'energy' | 'colony' | 'type' | 'multi';

/** Most organism members outlined around a followed cell. */
const MAX_MEMBERS = 512;
/** Most tissue parts drawn for big organisms. */
const MAX_BODY_PARTS = 4000;

/** Cell type colours, in CELL_TYPES order. */
export const TYPE_COLOURS = ['#6f8794', '#e8d94a', '#5fb8ff', '#5fd3c6', '#ff7a5c', '#b06cf0', '#ffffff', '#ff5fc8'];

const DRIFT_PARTICLES = 1600;
const FEED_COLOURS = [new THREE.Color('#e8d94a'), new THREE.Color('#f0703a'), new THREE.Color('#b06cf0')];
const DAY_BG = new THREE.Color('#0b3550');
const NIGHT_BG = new THREE.Color('#020b13');

/**
 * Everything 3D: the pond, the cells, debris, vents, drifting particles and
 * the camera. Positions are interpolated between the last two frames from
 * the worker so motion stays smooth at any tick rate.
 */
export class Pond {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  colourMode: ColourMode = 'tag';
  /** Id of the cell the camera follows, or null. */
  followId: number | null = null;

  private p: Params;
  private cells!: THREE.InstancedMesh;
  private tails!: THREE.InstancedMesh;
  private debris!: THREE.Points;
  private bonds!: THREE.LineSegments;
  private guests!: THREE.InstancedMesh;
  private drift!: THREE.Points;
  private ventSprites: THREE.Sprite[] = [];
  private ventTexture = radialTexture();
  private selection: THREE.Mesh;
  /** Big organisms: one sphere per tissue part. */
  private bodyParts!: THREE.InstancedMesh;
  /** Wire shells around every other cell of the followed cell's organism. */
  private members: THREE.InstancedMesh;
  private sunLight: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private surface!: THREE.Mesh;
  private world = new THREE.Group();

  private prev: Frame | null = null;
  private curr: Frame | null = null;
  private prevAt = 0;
  private currAt = 0;
  private prevIndex = new Map<number, number>();
  /** Interpolated positions of the last drawn frame (for picking and following). */
  private drawn = new Float32Array(0);
  private drawnIds: Uint32Array = new Uint32Array(0);
  private driftTick = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tailPos = new THREE.Vector3();
  private readonly tmp = new Float64Array(3);

  constructor(container: HTMLElement, params: Params) {
    this.p = params;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.background = DAY_BG.clone();
    this.scene.fog = new THREE.Fog(DAY_BG.clone(), 600, 2600);
    this.ambient = new THREE.HemisphereLight('#9fd8ff', '#1a2a20', 0.5);
    this.sunLight = new THREE.DirectionalLight('#fff6dc', 1.5);
    this.sunLight.position.set(0.3, 1, 0.2);
    this.scene.add(this.ambient, this.sunLight, this.world);

    this.selection = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.6 }),
    );
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.members = new THREE.InstancedMesh(
      this.selection.geometry,
      new THREE.MeshBasicMaterial({ color: '#ffe680', wireframe: true, transparent: true, opacity: 0.45 }),
      MAX_MEMBERS,
    );
    this.members.count = 0;
    this.members.frustumCulled = false;
    this.scene.add(this.members);

    this.build(params);
    window.addEventListener('resize', () => this.resize(container));
  }

  /** (Re)builds the pond for new parameters. */
  build(p: Params): void {
    this.p = p;
    this.world.clear();
    this.ventSprites = [];
    this.prev = this.curr = null;
    this.followId = null;
    this.selection.visible = false;
    this.members.count = 0;
    const W = p.width;
    const H = p.depth;
    const centre = new THREE.Vector3(W / 2, H / 2, W / 2);

    // Water volume: a box seen from inside or out, shaded light to dark with depth.
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, W),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: { sun: { value: 1 } },
        vertexShader: `
          varying float vY;
          void main() {
            vY = position.y / ${H.toFixed(1)} + 0.5;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform float sun;
          varying float vY;
          void main() {
            vec3 deep = vec3(0.01, 0.05, 0.09);
            vec3 shallow = mix(vec3(0.03, 0.12, 0.2), vec3(0.18, 0.55, 0.7), sun);
            gl_FragColor = vec4(mix(deep, shallow, pow(vY, 1.6)), 0.55);
          }`,
      }),
    );
    water.position.copy(centre);
    water.renderOrder = -1;
    this.world.add(water);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, W)),
      new THREE.LineBasicMaterial({ color: '#4c8aa6', transparent: true, opacity: 0.35 }),
    );
    edges.position.copy(centre);
    this.world.add(edges);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, W),
      new THREE.MeshStandardMaterial({ color: '#2b2a22', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, W / 2);
    this.world.add(floor);

    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(W, W),
      new THREE.MeshBasicMaterial({
        color: '#bfeaff',
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.set(W / 2, H, W / 2);
    this.world.add(this.surface);

    // Cells: one instanced sphere mesh.
    this.cells = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.0 }),
      p.cellCap,
    );
    this.cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.cellCap * 3), 3);
    this.cells.frustumCulled = false;
    this.cells.count = 0;
    this.world.add(this.cells);

    // Tails on motile cells: a cone pointing backwards from the cell.
    const cone = new THREE.ConeGeometry(0.5, 1, 6);
    cone.translate(0, -0.5, 0); // tip at origin pointing down
    cone.rotateX(Math.PI); // base at origin, tip along +y
    this.tails = new THREE.InstancedMesh(
      cone,
      new THREE.MeshBasicMaterial({ color: '#cfe9f2', transparent: true, opacity: 0.45 }),
      p.cellCap,
    );
    this.tails.frustumCulled = false;
    this.tails.count = 0;
    this.world.add(this.tails);

    // Bonds: a line between each bonded pair.
    const bondGeo = new THREE.BufferGeometry();
    bondGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.cellCap * p.maxBonds * 3), 3));
    bondGeo.setDrawRange(0, 0);
    this.bonds = new THREE.LineSegments(
      bondGeo,
      new THREE.LineBasicMaterial({ color: '#e9f6ff', transparent: true, opacity: 0.7 }),
    );
    this.bonds.frustumCulled = false;
    this.world.add(this.bonds);

    // Guests: small glowing beads set into their host's surface.
    this.guests = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial(),
      p.cellCap * p.maxGuests,
    );
    this.guests.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.cellCap * p.maxGuests * 3), 3);
    this.guests.frustumCulled = false;
    this.guests.count = 0;
    this.world.add(this.guests);

    this.bodyParts = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.92 }),
      MAX_BODY_PARTS,
    );
    this.bodyParts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BODY_PARTS * 3), 3);
    this.bodyParts.frustumCulled = false;
    this.bodyParts.count = 0;
    this.world.add(this.bodyParts);

    const debrisGeo = new THREE.BufferGeometry();
    debrisGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.cellCap * 3), 3));
    debrisGeo.setDrawRange(0, 0);
    this.debris = new THREE.Points(
      debrisGeo,
      new THREE.PointsMaterial({ color: '#8a7a66', size: 1.6, transparent: true, opacity: 0.8 }),
    );
    this.debris.frustumCulled = false;
    this.world.add(this.debris);

    const dp = new Float32Array(DRIFT_PARTICLES * 3);
    for (let i = 0; i < DRIFT_PARTICLES; i++) {
      dp[i * 3] = Math.random() * W;
      dp[i * 3 + 1] = Math.random() * H;
      dp[i * 3 + 2] = Math.random() * W;
    }
    const driftGeo = new THREE.BufferGeometry();
    driftGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.drift = new THREE.Points(
      driftGeo,
      new THREE.PointsMaterial({ color: '#cfefff', size: 0.9, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.drift.frustumCulled = false;
    this.world.add(this.drift);

    this.controls.target.copy(centre);
    this.camera.position.set(W * 1.35, H * 1.9, W * 1.55);
    this.camera.far = W * 8;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = W * 3.5;
    this.controls.minDistance = 10;
  }

  resize(container: HTMLElement): void {
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  /** The newest frame received from the worker. */
  get latest(): Frame | null {
    return this.curr;
  }

  pushFrame(f: Frame): void {
    this.prev = this.curr;
    this.prevAt = this.currAt;
    this.curr = f;
    this.currAt = performance.now();
    this.prevIndex.clear();
    if (this.prev) {
      const ids = this.prev.ids;
      for (let i = 0; i < this.prev.n; i++) this.prevIndex.set(ids[i], i);
    }
  }

  /** Returns the id of the cell or big organism under a screen point, or null. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // Big organisms first: they are what you see when you tap one.
    let bodyHit: number | null = null;
    let bodyAlong = Infinity;
    const c = new THREE.Vector3();
    for (const b of this.curr?.bodies ?? []) {
      c.set(b.x, b.y, b.z);
      const along = c.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (ray.ray.distanceToPoint(c) < b.radius * 1.1 && along < bodyAlong) {
        bodyAlong = along;
        bodyHit = b.id;
      }
    }
    if (bodyHit !== null) return bodyHit;
    // Pad hits a little so small cells are clickable.
    const hits = ray.intersectObject(this.cells);
    if (hits.length && hits[0].instanceId !== undefined) return this.drawnIds[hits[0].instanceId];
    let best: number | null = null;
    let bestD = Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.drawnIds.length; i++) {
      p.set(this.drawn[i * 3], this.drawn[i * 3 + 1], this.drawn[i * 3 + 2]);
      const d = ray.ray.distanceToPoint(p);
      const along = p.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      const tol = 0.012 * along + 2;
      if (d < tol && along < bestD) {
        bestD = along;
        best = this.drawnIds[i];
      }
    }
    return best;
  }

  render(speciesColour: (id: number) => THREE.Color): void {
    const f = this.curr;
    if (f) this.drawCells(f, speciesColour);
    this.updateEnvironment(f);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private drawCells(f: Frame, speciesColour: (id: number) => THREE.Color): void {
    const prev = this.prev;
    const span = Math.max(16, this.currAt - this.prevAt);
    const a = prev ? Math.min(1, (performance.now() - this.currAt) / span) : 1;
    const W = this.p.width;
    const n = f.n;
    if (this.drawn.length < n * 3) this.drawn = new Float32Array(n * 3 * 2);
    this.drawnIds = f.ids;

    let tails = 0;
    let guestN = 0;
    let followed = -1;
    const colors = this.cells.instanceColor!.array as Float32Array;
    for (let i = 0; i < n; i++) {
      let x = f.pos[i * 3],
        y = f.pos[i * 3 + 1],
        z = f.pos[i * 3 + 2];
      if (prev) {
        const j = this.prevIndex.get(f.ids[i]);
        if (j !== undefined) {
          const px = prev.pos[j * 3],
            py = prev.pos[j * 3 + 1],
            pz = prev.pos[j * 3 + 2];
          // Skip interpolation across the wrapped edge.
          if (Math.abs(x - px) < W / 2 && Math.abs(z - pz) < W / 2) {
            x = px + (x - px) * a;
            y = py + (y - py) * a;
            z = pz + (z - pz) * a;
          }
        }
      }
      this.drawn[i * 3] = x;
      this.drawn[i * 3 + 1] = y;
      this.drawn[i * 3 + 2] = z;
      const r = f.radius[i];
      this.m.makeScale(r, r, r).setPosition(x, y, z);
      this.cells.setMatrixAt(i, this.m);
      this.cellColour(f, i, speciesColour);
      colors[i * 3] = this.c.r;
      colors[i * 3 + 1] = this.c.g;
      colors[i * 3 + 2] = this.c.b;
      if (f.ids[i] === this.followId) followed = i;

      for (let s = 0; s < f.guests[i]; s++) {
        const d = GUEST_DIRS[s % GUEST_DIRS.length];
        this.m.makeScale(r * 0.38, r * 0.38, r * 0.38).setPosition(x + d[0] * r * 0.72, y + d[1] * r * 0.72, z + d[2] * r * 0.72);
        this.guests.setMatrixAt(guestN, this.m);
        const o = (i * f.maxGuests + s) * 3;
        this.c.setRGB(f.guestTag[o], f.guestTag[o + 1], f.guestTag[o + 2]).offsetHSL(0, 0, 0.15);
        this.guests.setColorAt(guestN++, this.c);
      }

      // Tail behind motile, moving cells.
      const vx = f.vel[i * 3],
        vy = f.vel[i * 3 + 1],
        vz = f.vel[i * 3 + 2];
      const sp = Math.hypot(vx, vy, vz);
      if (f.motility[i] > 0.25 && sp > 0.15) {
        this.v.set(-vx / sp, -vy / sp, -vz / sp);
        this.q.setFromUnitVectors(this.up, this.v);
        const len = r * (0.8 + 1.6 * f.motility[i]);
        this.s.set(r * 0.45, len, r * 0.45);
        this.v.multiplyScalar(r * 0.6).add(this.tailPos.set(x, y, z));
        this.m.compose(this.v, this.q, this.s);
        this.tails.setMatrixAt(tails++, this.m);
      }
    }
    this.cells.count = n;
    this.cells.instanceMatrix.needsUpdate = true;
    this.cells.instanceColor!.needsUpdate = true;
    this.tails.count = tails;
    this.tails.instanceMatrix.needsUpdate = true;

    const dpos = this.debris.geometry.getAttribute('position') as THREE.BufferAttribute;
    (dpos.array as Float32Array).set(f.debris.subarray(0, Math.min(f.debris.length, dpos.array.length)));
    dpos.needsUpdate = true;
    this.debris.geometry.setDrawRange(0, Math.min(f.nd, dpos.count));

    this.guests.count = guestN;
    this.guests.instanceMatrix.needsUpdate = true;
    if (this.guests.instanceColor) this.guests.instanceColor.needsUpdate = true;

    const bpos = this.bonds.geometry.getAttribute('position') as THREE.BufferAttribute;
    const barr = bpos.array as Float32Array;
    let nb = 0;
    for (let k = 0; k + 1 < f.bonds.length && (nb + 2) * 3 <= barr.length; k += 2) {
      const a = f.bonds[k] * 3;
      const b = f.bonds[k + 1] * 3;
      // Skip bonds that wrap across the pond edge.
      if (Math.abs(this.drawn[a] - this.drawn[b]) > W / 2 || Math.abs(this.drawn[a + 2] - this.drawn[b + 2]) > W / 2) continue;
      barr.set(this.drawn.subarray(a, a + 3), nb++ * 3);
      barr.set(this.drawn.subarray(b, b + 3), nb++ * 3);
    }
    bpos.needsUpdate = true;
    this.bonds.geometry.setDrawRange(0, nb);

    const followedBody = this.drawBodies(f, speciesColour);
    if (this.followId !== null && followedBody) {
      this.v.set(followedBody.x, followedBody.y, followedBody.z);
      this.selection.visible = true;
      this.selection.position.copy(this.v);
      this.selection.scale.setScalar(followedBody.radius * 1.3 + 2);
      this.members.count = 0;
      this.moveCameraTo(W);
    } else if (this.followId !== null && followed >= 0) {
      const r = f.radius[followed];
      this.v.set(this.drawn[followed * 3], this.drawn[followed * 3 + 1], this.drawn[followed * 3 + 2]);
      this.selection.visible = true;
      this.selection.position.copy(this.v);
      this.selection.scale.setScalar(r * 1.8 + 1);
      let nm = 0;
      if (f.colonySize[followed] >= 2) {
        const col = f.colony[followed];
        for (let i = 0; i < n && nm < MAX_MEMBERS; i++) {
          if (i === followed || f.colony[i] !== col) continue;
          const ri = f.radius[i] * 1.5 + 0.5;
          this.m.makeScale(ri, ri, ri).setPosition(this.drawn[i * 3], this.drawn[i * 3 + 1], this.drawn[i * 3 + 2]);
          this.members.setMatrixAt(nm++, this.m);
        }
      }
      this.members.count = nm;
      this.members.instanceMatrix.needsUpdate = true;
      this.moveCameraTo(W);
    } else {
      this.selection.visible = false;
      this.members.count = 0;
    }
  }

  /** Eases the camera toward this.v, jumping when the target wrapped across the pond. */
  private moveCameraTo(W: number): void {
    const delta = this.v.clone().sub(this.controls.target);
    if (delta.length() <= W / 3) delta.multiplyScalar(0.15);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  /** Draws big organisms as tissue parts; returns the followed one, if any. */
  private drawBodies(f: Frame, speciesColour: (id: number) => THREE.Color): BodyFrame | null {
    let k = 0;
    let followed: BodyFrame | null = null;
    const colors = this.bodyParts.instanceColor!.array as Float32Array;
    for (const b of f.bodies) {
      if (b.id === this.followId) followed = b;
      for (const part of b.parts) {
        if (k >= MAX_BODY_PARTS) break;
        // Each tissue is a ball of its cells' volume, placed where those cells sat.
        const r = b.cellRadius * Math.cbrt(part.n) * 1.15;
        const spread = Math.max(0, b.radius - r) * 0.9;
        this.m
          .makeScale(r, r, r)
          .setPosition(b.x + part.ox * spread, b.y + part.oy * spread, b.z + part.oz * spread);
        this.bodyParts.setMatrixAt(k, this.m);
        this.bodyColour(b, part.type, speciesColour);
        colors[k * 3] = this.c.r;
        colors[k * 3 + 1] = this.c.g;
        colors[k * 3 + 2] = this.c.b;
        k++;
      }
    }
    this.bodyParts.count = k;
    this.bodyParts.instanceMatrix.needsUpdate = true;
    this.bodyParts.instanceColor!.needsUpdate = true;
    return followed;
  }

  private bodyColour(b: BodyFrame, type: number, speciesColour: (id: number) => THREE.Color): void {
    switch (this.colourMode) {
      case 'tag':
        this.c.setRGB(b.tag[0], b.tag[1], b.tag[2]);
        break;
      case 'species':
        this.c.copy(speciesColour(b.species));
        break;
      case 'feeding':
        this.c.setRGB(
          b.feed[0] * FEED_COLOURS[0].r + b.feed[1] * FEED_COLOURS[1].r + b.feed[2] * FEED_COLOURS[2].r,
          b.feed[0] * FEED_COLOURS[0].g + b.feed[1] * FEED_COLOURS[1].g + b.feed[2] * FEED_COLOURS[2].g,
          b.feed[0] * FEED_COLOURS[0].b + b.feed[1] * FEED_COLOURS[1].b + b.feed[2] * FEED_COLOURS[2].b,
        );
        break;
      case 'colony':
        this.c.setHSL((b.id * 0.61803) % 1, 0.7, 0.55);
        break;
      case 'energy':
        this.c.setHSL(0.55 - 0.45 * b.energy, 0.8, 0.25 + 0.4 * b.energy);
        break;
      default:
        this.c.set(TYPE_COLOURS[type]);
    }
  }

  private cellColour(f: Frame, i: number, speciesColour: (id: number) => THREE.Color): void {
    switch (this.colourMode) {
      case 'tag':
        this.c.setRGB(f.tag[i * 3], f.tag[i * 3 + 1], f.tag[i * 3 + 2]);
        break;
      case 'species':
        this.c.copy(speciesColour(f.species[i]));
        break;
      case 'feeding': {
        const l = f.feed[i * 3],
          v = f.feed[i * 3 + 1],
          e = f.feed[i * 3 + 2];
        this.c.setRGB(
          l * FEED_COLOURS[0].r + v * FEED_COLOURS[1].r + e * FEED_COLOURS[2].r,
          l * FEED_COLOURS[0].g + v * FEED_COLOURS[1].g + e * FEED_COLOURS[2].g,
          l * FEED_COLOURS[0].b + v * FEED_COLOURS[1].b + e * FEED_COLOURS[2].b,
        );
        break;
      }
      case 'colony':
        if (f.colonySize[i] < 2) this.c.setRGB(0.35, 0.42, 0.46);
        else this.c.setHSL((f.colony[i] * 0.61803) % 1, 0.7, 0.55);
        break;
      case 'type':
        this.c.set(TYPE_COLOURS[f.cellType[i]]);
        break;
      case 'multi':
        // Only colonies with 2+ cell types light up, coloured by cell type.
        if (f.colonyTypes[i] >= 2) this.c.set(TYPE_COLOURS[f.cellType[i]]);
        else this.c.setRGB(0.16, 0.2, 0.23);
        break;
      case 'energy':
        this.c.setHSL(0.55 - 0.45 * f.energy[i], 0.8, 0.25 + 0.4 * f.energy[i]);
        break;
    }
  }

  private updateEnvironment(f: Frame | null): void {
    const sun = f?.sun ?? 1;
    const bg = this.scene.background as THREE.Color;
    bg.copy(NIGHT_BG).lerp(DAY_BG, sun);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.sunLight.intensity = 0.2 + 1.6 * sun;
    this.ambient.intensity = 0.45 + 0.35 * sun;
    (this.surface.material as THREE.MeshBasicMaterial).opacity = 0.04 + 0.1 * sun;
    const water = this.world.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    water.material.uniforms.sun.value = sun;

    if (f) {
      // Vents: glowing patches on the floor.
      while (this.ventSprites.length < f.vents.length) {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.ventTexture,
            color: '#ff8a3c',
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
          }),
        );
        this.world.add(s);
        this.ventSprites.push(s);
      }
      this.ventSprites.forEach((s, k) => {
        const v = f.vents[k];
        s.visible = !!v;
        if (!v) return;
        const size = this.p.ventSpread * 3 * (0.3 + 0.7 * v.strength);
        s.position.set(v.x, 6, v.z);
        s.scale.set(size, size * 0.6, 1);
        (s.material as THREE.SpriteMaterial).opacity = 0.25 + 0.6 * v.strength * (0.3 + 0.7 * v.stock);
      });

      // Drift particles follow the current at the sim's pace.
      const dt = this.driftTick ? Math.max(0, Math.min(60, f.tick - this.driftTick)) : 0;
      this.driftTick = f.tick;
      if (dt > 0) {
        const pos = this.drift.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const W = this.p.width;
        for (let i = 0; i < DRIFT_PARTICLES; i++) {
          currentAt(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2], f.tick, this.p, this.tmp);
          arr[i * 3] = (arr[i * 3] + this.tmp[0] * dt + W) % W;
          arr[i * 3 + 1] = Math.min(this.p.depth, Math.max(0, arr[i * 3 + 1] + this.tmp[1] * dt));
          arr[i * 3 + 2] = (arr[i * 3 + 2] + this.tmp[2] * dt + W) % W;
        }
        pos.needsUpdate = true;
      }
    }
  }
}

const GUEST_DIRS = [
  [0.6, 0.6, 0.5],
  [-0.6, 0.3, -0.6],
  [0.2, -0.7, 0.6],
  [-0.4, -0.5, -0.7],
];

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
