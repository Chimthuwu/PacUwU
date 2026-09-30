// Renderer3D — real 3D (Three.js) synthwave renderer for the maze game.
// Game logic stays in engine.ts; this class only consumes a per-frame
// RenderState snapshot and draws it with WebGL + UnrealBloom glow.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Dir, GameState, GhostState } from './engine';
import { COLS, GRID, ROWS, TILE } from './constants';

// ------------------------------------------------------------------ world scale

const WALL_H = 34; // extrusion height of maze walls (world units)
const PAC_R = 11;
const PAC_Y = 15;
const GHOST_H = 22;
const GHOST_R = 9.5;
const GHOST_Y = 13; // ghost rig origin height (bottom of body)

// floor extends this far beyond the maze on each side (a tight pedestal)
const FLOOR_MARGIN = 3 * TILE;
// camera rig
const CAM_POS = new THREE.Vector3(COLS * TILE / 2, 833, 1185);
const CAM_LOOK = new THREE.Vector3(COLS * TILE / 2, 20, ROWS * TILE / 2);

const PALLETTE = ['#ff2a6d', '#05d9e8', '#ffd319', '#00ff9f'];
const SCARED_BLUE = '#2356ff';
const PINK = '#ff2a6d';
const CYAN = '#05d9e8';

// Direction vectors in (col, row) space — same order as engine.Dir.
const DIR_XY: ReadonlyArray<[number, number]> = [
  [0, -1], // Up
  [0, 1], // Down
  [-1, 0], // Left
  [1, 0], // Right
];

function heading(d: Dir): number {
  const [dx, dz] = DIR_XY[d];
  return Math.atan2(dx, dz);
}

function hsl(hue: number, s = 100, l = 62): THREE.Color {
  return new THREE.Color().setHSL(((hue % 360) / 360), s / 100, l / 100);
}

function makeCircleTexture(
  stops: Array<[number, string]>,
  size = 256,
): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTextTexture(text: string, color: string, px = 46): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.font = `700 ${px}px Orbitron, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 22;
  g.fillStyle = color;
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ types

export interface RenderPac {
  x: number;
  y: number;
  dir: Dir;
  chompT: number;
}
export interface RenderGhost {
  x: number;
  y: number;
  dir: Dir;
  state: GhostState;
  frightened: boolean;
  color: string;
  bounce: number;
}
export interface RenderPellet {
  r: number;
  c: number;
  power: boolean;
}
export interface RenderFloat {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}
export interface RenderParticle {
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
}
export interface RenderTrail {
  x: number;
  y: number;
  hue: number;
  t: number;
  life: number;
  size: number;
}
export interface RenderState {
  state: GameState;
  level: number;
  time: number;
  dyingT: number;
  frightT: number;
  shake: number;
  pac: RenderPac;
  ghosts: RenderGhost[];
  pellets: RenderPellet[];
  floats: RenderFloat[];
  particles: RenderParticle[];
  trail: RenderTrail[];
  bonus: { x: number; y: number; t: number; life: number } | null;
}

interface GhostRig {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  feet: THREE.Mesh[];
  eyes: THREE.Group;
  pupils: THREE.Group;
  color: string;
}

// ------------------------------------------------------------------ renderer

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private disposed = false;

  // static scenery
  private stars!: THREE.Points;
  private floorGrid!: THREE.LineSegments;
  private floorGrid2!: THREE.LineSegments;
  private sun!: THREE.Sprite;

  // per-level geometry
  private wallMesh: THREE.Mesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;

  // house decor
  private houseRim!: THREE.LineSegments;
  private doorBar!: THREE.Mesh;

  // pellets
  private pelletMesh!: THREE.InstancedMesh;
  private pelletMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private pelletGeo!: THREE.BufferGeometry;
  private powerMap = new Map<number, THREE.Mesh>();
  private powerGeo!: THREE.BufferGeometry;
  private powerMat = new THREE.MeshStandardMaterial({
    color: 0xffe14d,
    emissive: 0xffb800,
    emissiveIntensity: 0.75,
    roughness: 0.3,
    metalness: 0.2,
  });

  // pac-man
  private pacGroup = new THREE.Group();
  private pacMesh: THREE.Mesh | null = null;
  private pacGeo: THREE.BufferGeometry | null = null;
  private pacMat = new THREE.MeshStandardMaterial({
    color: 0xffb800,
    emissive: 0xffd93d,
    emissiveIntensity: 0.75,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  private pacGlow!: THREE.Sprite;
  private lastMouth = -1;

  // ghosts
  private ghostRigs: GhostRig[] = [];
  private ghostBodyGeo!: THREE.BufferGeometry;
  private ghostFootGeo!: THREE.BufferGeometry;
  private eyeGeo!: THREE.BufferGeometry;
  private pupilGeo!: THREE.BufferGeometry;
  private eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private pupilMat = new THREE.MeshBasicMaterial({ color: 0x2743ff });

  // fx
  private trailGeo!: THREE.BufferGeometry;
  private trailMat!: THREE.PointsMaterial;
  private particleGeo!: THREE.BufferGeometry;
  private particleMat!: THREE.PointsMaterial;
  private floatMap = new Map<RenderFloat, THREE.Sprite>();
  private textTexCache = new Map<string, THREE.CanvasTexture>();
  private centerSprite: THREE.Sprite | null = null;
  private centerText = '';

  // bonus
  private bonusMesh!: THREE.Mesh;
  private bonusMat!: THREE.MeshStandardMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.background = new THREE.Color('#070213');

    this.camera = new THREE.PerspectiveCamera(39, canvas.width / canvas.height, 1, 5000);
    this.camera.position.copy(CAM_POS);
    this.camera.lookAt(CAM_LOOK);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(canvas.width, canvas.height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(canvas.width, canvas.height), 0.55, 0.35, 0.24);
    this.composer.addPass(this.bloom);

    // lower ambient + stronger key so wall faces shade like solid blocks
    const amb = new THREE.AmbientLight(0x2a2350, 0.7);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(320, 900, 260);
    this.scene.add(key);
    const cyanRim = new THREE.PointLight(0x05d9e8, 220, 1200, 2);
    cyanRim.position.set(620, 90, 160);
    this.scene.add(cyanRim);
    const pinkRim = new THREE.PointLight(0xff2a6d, 280, 1200, 2);
    pinkRim.position.set(60, 70, 620);
    this.scene.add(pinkRim);

    this.buildScenery();
    this.buildFx();
    this.buildPac();
    this.buildPellets();
    this.buildGhosts();
  }

  // ------------------------------------------------------------ scenery

  private buildScenery() {
    const x0 = -FLOOR_MARGIN;
    const x1 = COLS * TILE + FLOOR_MARGIN;
    const z0 = -FLOOR_MARGIN;
    const z1 = ROWS * TILE + FLOOR_MARGIN;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;

    // dark ground plane (slightly larger than the grid)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 + 24, z1 - z0 + 24),
      new THREE.MeshBasicMaterial({ color: 0x060214 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    this.scene.add(ground);

    // synthwave grid lines (crisp world-space lines on a tight pedestal)
    const step = 2 * TILE;
    const major: number[] = [];
    const minor: number[] = [];
    for (let v = x0; v <= x1 + 1; v += step) {
      major.push(v, 0.4, z0, v, 0.4, z1);
    }
    for (let v = z0; v <= z1 + 1; v += step) {
      major.push(x0, 0.4, v, x1, 0.4, v);
    }
    for (let v = x0 + step / 2; v <= x1 + 1; v += step) {
      minor.push(v, 0.35, z0, v, 0.35, z1);
    }
    for (let v = z0 + step / 2; v <= z1 + 1; v += step) {
      minor.push(x0, 0.35, v, x1, 0.35, v);
    }
    const mk = (pts: number[], color: string, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      return new THREE.LineSegments(geo, mat);
    };
    this.floorGrid = mk(major, PINK, 0.15);
    this.floorGrid2 = mk(minor, PINK, 0.06);
    this.scene.add(this.floorGrid, this.floorGrid2);

    // retrowave sun — a modest disc peeking over the far wall
    const sunTex = makeCircleTexture([
      [0, 'rgba(255,205,140,0.95)'],
      [0.35, 'rgba(255,130,120,0.75)'],
      [0.62, 'rgba(255,60,150,0.42)'],
      [0.85, 'rgba(190,50,220,0.14)'],
      [1, 'rgba(190,50,220,0)'],
    ], 512);
    const sunMat = new THREE.SpriteMaterial({
      map: sunTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.7,
    });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.position.set(COLS * TILE / 2, 250, -330);
    this.sun.scale.set(300, 300, 1);
    this.sun.renderOrder = -10;
    this.scene.add(this.sun);

    // sparse stars
    const starPos: number[] = [];
    for (let i = 0; i < 120; i++) {
      starPos.push(
        Math.random() * 2000 - 660,
        240 + Math.random() * 420,
        -55 * TILE - Math.random() * 60 * TILE,
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x9de8ff,
      size: 2.4,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    // ghost house glow pool + door bar + rim
    const poolTex = makeCircleTexture([
      [0, 'rgba(255,79,216,0.3)'],
      [0.6, 'rgba(255,79,216,0.12)'],
      [1, 'rgba(255,79,216,0)'],
    ]);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6 * TILE, 4.6 * TILE),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(14 * TILE, 1.2, 14.5 * TILE);
    this.scene.add(pool);

    this.doorBar = new THREE.Mesh(
      new THREE.BoxGeometry(2 * TILE - 6, 7, 4),
      new THREE.MeshBasicMaterial({ color: PINK }),
    );
    this.doorBar.position.set(14 * TILE, WALL_H * 0.62, 12 * TILE + TILE / 2);
    this.scene.add(this.doorBar);

    const rim: number[] = [];
    const hx0 = 10 * TILE;
    const hx1 = 18 * TILE;
    const hz0 = 11 * TILE;
    const hz1 = 17 * TILE;
    const y = 1;
    rim.push(hx0, y, hz0, hx1, y, hz0, hx1, y, hz0, hx1, y, hz1, hx1, y, hz1, hx0, y, hz1, hx0, y, hz1, hx0, y, hz0);
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
    this.houseRim = new THREE.LineSegments(
      rimGeo,        new THREE.LineBasicMaterial({ color: PINK, transparent: true, opacity: 0.4 }),
    );
    this.scene.add(this.houseRim);
  }

  // ------------------------------------------------------------ fx rigs

  private buildFx() {
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.PointsMaterial({
      size: 3.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trailPoints = new THREE.Points(this.trailGeo, this.trailMat);
    trailPoints.renderOrder = 5;
    this.scene.add(trailPoints);

    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
    this.particleGeo.setDrawRange(0, 0);
    this.particleMat = new THREE.PointsMaterial({
      size: 2.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    particlePoints.renderOrder = 5;
    this.scene.add(particlePoints);
  }

  private buildPac() {
    this.pacMat.color = new THREE.Color('#ffb800');
    this.pacGroup.add(new THREE.Mesh(this.pacGeo = this.makePacGeo(0.4), this.pacMat));
    this.pacMesh = this.pacGroup.children[0] as THREE.Mesh;
    this.scene.add(this.pacGroup);

    const glowTex = makeCircleTexture([
      [0, 'rgba(255,220,90,0.85)'],
      [0.4, 'rgba(255,190,40,0.35)'],
      [1, 'rgba(255,190,40,0)'],
    ]);
    this.pacGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.pacGlow.scale.set(54, 54, 1);
    this.pacGlow.renderOrder = 1;
    this.scene.add(this.pacGlow);
  }

  /** Sphere with a wedge removed — the mouth opens toward +z. */
  private makePacGeo(mouth: number): THREE.BufferGeometry {
    const m = Math.max(0.05, mouth);
    const geo = new THREE.SphereGeometry(PAC_R, 28, 18, Math.PI / 2 + m / 2, Math.PI * 2 - m, 0, Math.PI);
    return geo;
  }

  private buildPellets() {
    this.pelletGeo = new THREE.SphereGeometry(4.2, 10, 8);
    this.pelletMesh = new THREE.InstancedMesh(this.pelletGeo, this.pelletMat, 300);
    this.pelletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pelletMesh.count = 0;
    this.scene.add(this.pelletMesh);

    this.powerGeo = new THREE.OctahedronGeometry(6.5);
    // power pellets created on demand in render()
  }

  private buildGhosts() {
    // shared lathe ghost body: dome + tapered cylinder, hem at y=0
    const pts: THREE.Vector2[] = [];
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.sin(a) * GHOST_R, GHOST_H - GHOST_R + Math.cos(a) * GHOST_R));
    }
    const hemY = 7;
    pts.push(new THREE.Vector2(GHOST_R * 0.985, hemY));
    this.ghostBodyGeo = new THREE.LatheGeometry(pts, 22);
    this.ghostBodyGeo.translate(0, -hemY, 0);

    this.ghostFootGeo = new THREE.SphereGeometry(4.6, 12, 10);
    this.eyeGeo = new THREE.SphereGeometry(3.0, 12, 10);
    this.pupilGeo = new THREE.SphereGeometry(1.5, 10, 8);
  }

  private makeGhostRig(color: string): GhostRig {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.5),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.5,
      roughness: 0.55,
      metalness: 0.15,
    });
    const body = new THREE.Mesh(this.ghostBodyGeo, bodyMat);
    const feet: THREE.Mesh[] = [];
    for (const aDeg of [-30, 90, 210]) {
      const a = (aDeg * Math.PI) / 180;
      const f = new THREE.Mesh(this.ghostFootGeo, bodyMat);
      f.position.set(Math.cos(a) * 6.6, -4.6, Math.sin(a) * 6.6);
      f.scale.set(0.6, 0.72, 0.6);
      feet.push(f);
    }
    const eyes = new THREE.Group();
    const pupils = new THREE.Group();
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      e.position.set(side * 3.8, 8.4, 9.2);
      eyes.add(e);
      const p = new THREE.Mesh(this.pupilGeo, this.pupilMat);
      p.position.set(side * 3.8, 8.4, 10.6);
      pupils.add(p);
    }
    const group = new THREE.Group();
    group.add(body, ...feet, eyes, pupils);
    return { group, body, bodyMat, feet, eyes, pupils, color };
  }

  // ------------------------------------------------------------ level

  setLevel(level: number) {
    const neon = hsl(185 + (level - 1) * 18);

    // dispose previous level geometry
    if (this.wallMesh) {
      this.scene.remove(this.wallMesh);
      this.wallMesh.geometry.dispose();
      (this.wallMesh.material as THREE.Material).dispose();
      this.wallMesh = null;
    }
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      (this.edgeLines.material as THREE.Material).dispose();
      this.edgeLines = null;
    }

    // merged wall boxes
    const boxes: THREE.BufferGeometry[] = [];
    const edges: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (GRID[r][c] !== '#') continue;
        const box = new THREE.BoxGeometry(TILE - 2, WALL_H, TILE - 2);
        box.translate(c * TILE + TILE / 2, WALL_H / 2, r * TILE + TILE / 2);
        boxes.push(box);
        const x0 = c * TILE + 1;
        const x1 = c * TILE + TILE - 1;
        const z0 = r * TILE + 1;
        const z1 = r * TILE + TILE - 1;
        const y = WALL_H;
        edges.push(x0, y, z0, x1, y, z0);
        edges.push(x1, y, z0, x1, y, z1);
        edges.push(x1, y, z1, x0, y, z1);
        edges.push(x0, y, z1, x0, y, z0);
      }
    }
    const wallGeo = mergeGeometries(boxes);
    for (const b of boxes) b.dispose();
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x181d4a,
      roughness: 0.8,
      metalness: 0.2,
      emissive: 0x0a0630,
      emissiveIntensity: 0.45,
    });
    this.wallMesh = new THREE.Mesh(wallGeo, wallMat);
    this.scene.add(this.wallMesh);

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    this.edgeLines = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: neon, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(this.edgeLines);

    // pellet state resets (power meshes share this.powerGeo, so only remove)
    this.pelletMesh.count = 0;
    for (const m of this.powerMap.values()) this.scene.remove(m);
    this.powerMap.clear();
    if (this.bonusMesh) this.bonusMesh.visible = false;

    // house rim / door tint follow the level hue
    this.doorBar.material = new THREE.MeshBasicMaterial({ color: hsl(305 + (level - 1) * 12) });
    (this.houseRim.material as THREE.LineBasicMaterial).color.setHSL(((305 + (level - 1) * 12) % 360) / 360, 1, 0.62);
  }

  // ------------------------------------------------------------ per-frame

  render(rs: RenderState) {
    this.ensureGhostRigs(rs);
    this.updatePac(rs);
    this.updateGhosts(rs);
    this.updatePellets(rs);
    this.updateBonus(rs);
    this.updateTrail(rs);
    this.updateParticles(rs);
    this.updateFloats(rs);
    this.updateCenterMessage(rs);

    // camera shake
    if (rs.shake > 0) {
      const mag = 0.35 * rs.shake * 18;
      this.camera.position.x = CAM_POS.x + (Math.random() * 2 - 1) * mag;
      this.camera.position.z = CAM_POS.z + (Math.random() * 2 - 1) * mag;
      this.camera.position.y = CAM_POS.y + (Math.random() * 2 - 1) * mag;
      this.camera.lookAt(CAM_LOOK);
    } else {
      this.camera.position.copy(CAM_POS);
      this.camera.lookAt(CAM_LOOK);
    }

    this.composer.render();
  }

  private updatePac(rs: RenderState) {
    const dying = rs.state === 'dying';
    const t = dying ? Math.min(1, rs.dyingT / 1.7) : 0;
    const mouth = dying
      ? 0.12 + 0.5 * t
      : 0.14 + 0.6 * Math.abs(Math.sin(rs.pac.chompT));

    if (!this.pacMesh) return;
    if (Math.abs(mouth - this.lastMouth) > 0.05) {
      if (this.pacGeo) {
        this.pacMesh.geometry.dispose();
        this.pacGeo = null;
      }
      this.pacMesh.geometry = this.pacGeo = this.makePacGeo(mouth);
      this.lastMouth = mouth;
    }

    const bob = dying ? 0 : Math.sin(rs.time * 6) * 0.7;
    this.pacGroup.position.set(rs.pac.x, PAC_Y + bob, rs.pac.y);
    this.pacGroup.rotation.y = heading(rs.pac.dir) + (dying ? t * 14 : 0);
    const s = dying ? Math.max(0.06, 1 - t * 0.62) : 1;
    this.pacGroup.scale.set(s, s, s);
    this.pacMat.emissiveIntensity = dying ? 0.25 : 0.6 + 0.2 * Math.sin(rs.time * 9);

    this.pacGlow.position.set(rs.pac.x, PAC_Y - 2, rs.pac.y);
    this.pacGlow.material.opacity = 0.38 + 0.2 * Math.sin(rs.time * 9);
  }

  private updateGhosts(rs: RenderState) {
    rs.ghosts.forEach((g, i) => {
      const rig = this.ghostRigs[i];
      if (!rig) return;
      rig.group.position.set(g.x, GHOST_Y + g.bounce, g.y);
      rig.group.rotation.y = heading(g.dir);

      const flash =
        g.frightened && rs.frightT < 1.6 && Math.floor(rs.time * 10) % 2 === 0;
      if (g.frightened) {
        const base = flash ? 0xffffff : SCARED_BLUE;
        rig.bodyMat.color.set(base).multiplyScalar(0.5);
        rig.bodyMat.emissive.set(base);
        rig.bodyMat.emissiveIntensity = flash ? 1.0 : 0.7;
        rig.pupils.visible = false;
      } else {
        const col = new THREE.Color(rig.color);
        rig.bodyMat.color.copy(col).multiplyScalar(0.5);
        rig.bodyMat.emissive.copy(col);
        rig.bodyMat.emissiveIntensity = 0.5;
        rig.pupils.visible = true;
      }

      const eyesOnly = g.state === 'eyes';
      rig.body.visible = !eyesOnly;
      for (const f of rig.feet) f.visible = !eyesOnly;
      rig.eyes.visible = true;
      rig.group.visible = true;
    });
  }

  private updatePellets(rs: RenderState) {
    // non-power pellets -> instanced mesh (pulse scales per instance)
    const keys = new Set<number>();
    for (const p of rs.pellets) {
      if (p.power) continue;
      keys.add(p.r * COLS + p.c);
    }
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let i = 0;
    for (const key of keys) {
      const r = Math.floor(key / COLS);
      const c = key % COLS;
      const pulse = 1 + 0.18 * Math.sin(rs.time * 4 + (r + c) * 0.45);
      pos.set(c * TILE + TILE / 2, 4.4, r * TILE + TILE / 2);
      scale.setScalar(pulse);
      matrix.compose(pos, quat, scale);
      this.pelletMesh.setMatrixAt(i, matrix);
      this.pelletMesh.setColorAt(i, new THREE.Color(PALLETTE[(r * 13 + c * 7) % PALLETTE.length]));
      i++;
    }
    this.pelletMesh.count = i;
    this.pelletMesh.instanceMatrix.needsUpdate = true;
    if (this.pelletMesh.instanceColor) this.pelletMesh.instanceColor.needsUpdate = true;

    // power pellets -> spinning octahedrons
    const seen = new Set<number>();
    for (const p of rs.pellets) {
      if (!p.power) continue;
      const key = p.r * COLS + p.c;
      seen.add(key);
      let m = this.powerMap.get(key);
      if (!m) {
        m = new THREE.Mesh(this.powerGeo, this.powerMat);
        this.scene.add(m);
        this.powerMap.set(key, m);
      }
      m.position.set(p.c * TILE + TILE / 2, 11, p.r * TILE + TILE / 2);
      m.rotation.y = rs.time * 2.2 + p.c;
      m.rotation.z = Math.sin(rs.time * 1.7 + p.r) * 0.4;
      const pulse = 1 + 0.22 * Math.sin(rs.time * 5 + p.r + p.c);
      m.scale.setScalar(pulse);
    }
    for (const [key, m] of this.powerMap) {
      if (!seen.has(key)) {
        this.scene.remove(m);
        this.powerMap.delete(key);
      }
    }
  }

  private updateBonus(rs: RenderState) {
    if (!this.bonusMesh) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff4fd8,
        emissive: 0xff2a9d,
        emissiveIntensity: 0.75,
        roughness: 0.3,
        metalness: 0.3,
      });
      this.bonusMat = mat;
      this.bonusMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 0), mat);
      this.scene.add(this.bonusMesh);
    }
    const b = rs.bonus;
    if (!b) {
      this.bonusMesh.visible = false;
      return;
    }
    this.bonusMesh.visible = true;
    this.bonusMesh.position.set(b.x, 16 + Math.sin(rs.time * 6) * 1.5, b.y);
    this.bonusMesh.rotation.y = rs.time * 3;
    this.bonusMesh.rotation.x = rs.time * 1.4;
    this.bonusMat.emissiveIntensity = 0.8 + 0.4 * Math.sin(rs.time * 6);
  }

  private updateTrail(rs: RenderState) {
    const posAttr = this.trailGeo.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.trailGeo.getAttribute('color') as THREE.BufferAttribute;
    const n = Math.min(rs.trail.length, 64);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = rs.trail[i];
      posAttr.setXYZ(i, t.x, 2.4, t.y);
      const a = Math.max(0, 1 - t.t / t.life);
      c.setHSL((t.hue % 360) / 360, 1, 0.62);
      colAttr.setXYZ(i, c.r * a, c.g * a, c.b * a);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.trailGeo.setDrawRange(0, n);
  }

  private updateParticles(rs: RenderState) {
    const posAttr = this.particleGeo.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.particleGeo.getAttribute('color') as THREE.BufferAttribute;
    const n = Math.min(rs.particles.length, 300);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = rs.particles[i];
      posAttr.setXYZ(i, p.x, 2.6, p.y);
      const a = Math.max(0, 1 - p.t / p.life);
      c.set(p.color);
      colAttr.setXYZ(i, c.r * a, c.g * a, c.b * a);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.particleGeo.setDrawRange(0, n);
  }

  private updateFloats(rs: RenderState) {
    const alive = new Set(rs.floats);
    for (const [f, sp] of this.floatMap) {
      if (!alive.has(f)) {
        this.scene.remove(sp);
        sp.material.map?.dispose();
        sp.material.dispose();
        this.floatMap.delete(f);
      }
    }
    for (const f of rs.floats) {
      let sp = this.floatMap.get(f);
      if (!sp) {
        const key = `${f.text}|${f.color}`;
        let tex = this.textTexCache.get(key);
        if (!tex) {
          tex = makeTextTexture(f.text, f.color);
          this.textTexCache.set(key, tex);
        }
        sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        sp.scale.set(88, 22, 1);
        sp.renderOrder = 9;
        this.scene.add(sp);
        this.floatMap.set(f, sp);
      }
      sp.position.set(f.x, 44, f.y);
      sp.material.opacity = Math.max(0, 1 - f.t);
      const s = 1 + f.t * 0.4;
      sp.scale.set(88 * s, 22 * s, 1);
    }
  }

  private updateCenterMessage(rs: RenderState) {
    let text = '';
    if (rs.state === 'ready') text = 'READY!';
    else if (rs.state === 'levelClear') text = `LEVEL ${rs.level} CLEAR!`;
    if (!text) {
      if (this.centerSprite) this.centerSprite.visible = false;
      return;
    }
    if (!this.centerSprite || text !== this.centerText) {
      if (this.centerSprite) {
        this.scene.remove(this.centerSprite);
        this.centerSprite.material.map?.dispose();
        this.centerSprite.material.dispose();
      }
      const tex = makeTextTexture(text, CYAN);
      this.centerSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      this.centerSprite.scale.set(200, 50, 1);
      this.centerSprite.renderOrder = 10;
      this.scene.add(this.centerSprite);
      this.centerText = text;
    }
    this.centerSprite.position.set(COLS * TILE / 2, 128, ROWS * TILE / 2 + 10);
    this.centerSprite.material.opacity = 0.8 + 0.2 * Math.sin(rs.time * 5);
    this.centerSprite.visible = true;
  }

  // ------------------------------------------------------------ lifecycle

  private ghostRigsBuilt = false;

  private ensureGhostRigs(rs: RenderState) {
    if (this.ghostRigsBuilt) return;
    for (const g of rs.ghosts) {
      const rig = this.makeGhostRig(g.color);
      this.ghostRigs.push(rig);
      this.scene.add(rig.group);
    }
    this.ghostRigsBuilt = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
  }
}