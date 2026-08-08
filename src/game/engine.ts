import {
  BONUS_TILE,
  CANVAS_H,
  CANVAS_W,
  COLS,
  DOOR_TILES,
  GRID,
  HOUSE_CENTER,
  HOUSE_EXIT,
  ROWS,
  START_TILE,
  TILE,
  TUNNEL_ROW,
  buildPellets,
  ghostPassable,
  isDoor,
  pacmanPassable,
} from './constants';
import { Sfx } from './audio';

export const Dir = { Up: 0, Down: 1, Left: 2, Right: 3, None: 4 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export type GameState = 'idle' | 'ready' | 'playing' | 'dying' | 'levelClear' | 'gameOver' | 'won';
export type GhostState = 'house' | 'leaving' | 'active' | 'eyes' | 'entering';

export interface UiState {
  state: GameState;
  score: number;
  hiScore: number;
  level: number;
  lives: number;
  muted: boolean;
  paused: boolean;
}

const DIR_VEC: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: -1 }, // Up
  { x: 0, y: 1 }, // Down
  { x: -1, y: 0 }, // Left
  { x: 1, y: 0 }, // Right
];
const REVERSE = [1, 0, 3, 2];
// Rotation (radians) that makes a +x-facing sprite point along each direction.
const DIR_ANGLE = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];

const GHOST_DEFS = [
  { name: 'Blinky', color: '#ff3b5c', scatter: { r: 0, c: 26 }, baseSpeed: 3.95, releaseAt: 0.8, releasePellets: 0 },
  { name: 'Pinky', color: '#ff9ed2', scatter: { r: 0, c: 0 }, baseSpeed: 3.8, releaseAt: 9, releasePellets: 20 },
  { name: 'Inky', color: '#43e0ff', scatter: { r: ROWS - 1, c: 26 }, baseSpeed: 3.7, releaseAt: 18, releasePellets: 45 },
  { name: 'Psychic', color: '#43ff9e', scatter: { r: 14, c: 13 }, baseSpeed: 3.9, releaseAt: 24, releasePellets: 65 },
  { name: 'Clyde', color: '#ffb347', scatter: { r: ROWS - 1, c: 0 }, baseSpeed: 3.7, releaseAt: 27, releasePellets: 70 },
];

const HOUSE_COLS = [11, 12, 13, 14, 15];
const HOUSE_ROW = 14.5;
const PELLET_COLORS = ['#ff9ee8', '#ffe08a', '#8ee7ff', '#9dffc9'];
const HS_KEY = 'pacuwu_hiscore';
const MAX_LEVEL = 5;
const SHAKE_DURATION = 0.35;

interface Tile {
  r: number;
  c: number;
}

interface Mover {
  r: number;
  c: number;
  p: number;
  dir: Dir;
  isGhost: boolean;
}

interface Pac extends Mover {
  nextDir: Dir;
  chompT: number;
}

interface Ghost extends Mover {
  name: string;
  color: string;
  scatter: Tile;
  state: GhostState;
  frightened: boolean;
  path: Tile[];
  houseCol: number;
  bouncePhase: number;
  releaseAt: number;
  releasePellets: number;
  baseSpeed: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  color: string;
  size: number;
}

interface TrailDot {
  x: number;
  y: number;
  hue: number;
  t: number;
  life: number;
  size: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private sfx = new Sfx();
  private onUi: (u: UiState) => void;
  private raf = 0;
  private last = 0;
  private time = 0;

  private state: GameState = 'idle';
  private paused = false;
  private score = 0;
  private hiScore = 0;
  private level = 1;
  private lives = 3;

  private pellets = new Map<number, boolean>();
  private pelletsLeft = 0;
  private pelletsEaten = 0;
  private mazeLayer: HTMLCanvasElement | null = null;
  private pelletLayer: HTMLCanvasElement | null = null;

  private pac: Pac = {
    r: START_TILE.r,
    c: START_TILE.c,
    p: 0,
    dir: Dir.Left,
    nextDir: Dir.None,
    isGhost: false,
    chompT: 0,
  };
  private ghosts: Ghost[] = [];

  private floats: FloatText[] = [];
  private particles: Particle[] = [];
  private readyT = 0;
  private deathT = 0;
  private levelClearT = 0;
  private timeSinceLevel = 0;
  private frightT = 0;
  private frightSndT = 0;
  private ghostMode: 'scatter' | 'chase' = 'scatter';
  private ghostModeT = 4;
  private ghostCombo = 0;
  private chompAlt = 0;
  private nextExtraLife = 10000;
  private bonus: { tile: Tile; t: number; life: number } | null = null;
  private bonusSpawned = 0;
  private destroyed = false;
  private trail: TrailDot[] = [];
  private trailDist = 0;
  private lastPacX = 0;
  private lastPacY = 0;
  private shakeT = 0;
  private shakeMag = 6;

  constructor(canvas: HTMLCanvasElement, onUi: (u: UiState) => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.onUi = onUi;
    try {
      this.hiScore = Number(localStorage.getItem(HS_KEY) ?? 0) || 0;
    } catch {
      this.hiScore = 0;
    }
    try {
      void document.fonts.load('700 12px Quicksand');
      void document.fonts.load('14px "Press Start 2P"');
    } catch {
      /* ignore */
    }
    this.setupLevel();
    this.emit();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
  }

  // ------------------------------------------------------------------ public

  canStart(): boolean {
    return this.state === 'idle' || this.state === 'gameOver' || this.state === 'won';
  }

  start() {
    this.sfx.unlock();
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.nextExtraLife = 10000;
    this.paused = false;
    this.frightT = 0;
    this.ghostCombo = 0;
    this.setupLevel();
    this.state = 'ready';
    this.readyT = 2.4;
    this.sfx.start();
    this.emit();
  }

  setDir(d: number) {
    if (d < 0 || d > 3) return;
    this.pac.nextDir = d as Dir;
  }

  togglePause() {
    if (this.state !== 'playing' && this.state !== 'ready') return;
    this.paused = !this.paused;
    this.emit();
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      this.emit();
    }
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this.emit();
    }
  }

  toggleMute() {
    this.sfx.unlock();
    this.sfx.setMuted(!this.sfx.muted);
    this.emit();
  }

  // ------------------------------------------------------------------ setup

  private snapshot(): UiState {
    return {
      state: this.state,
      score: this.score,
      hiScore: this.hiScore,
      level: this.level,
      lives: this.lives,
      muted: this.sfx.muted,
      paused: this.paused,
    };
  }

  private emit() {
    this.onUi(this.snapshot());
  }

  private setupLevel() {
    const spots = buildPellets();
    this.pellets.clear();
    for (const s of spots) this.pellets.set(s.r * COLS + s.c, s.power);
    this.pelletsLeft = spots.length;
    this.pelletsEaten = 0;
    this.timeSinceLevel = 0;
    this.frightT = 0;
    this.ghostCombo = 0;
    this.bonus = null;
    this.bonusSpawned = 0;
    this.ghostMode = 'scatter';
    this.ghostModeT = 4;

    this.pac.r = START_TILE.r;
    this.pac.c = START_TILE.c;
    this.pac.p = 0;
    this.pac.dir = Dir.Left;
    this.pac.nextDir = Dir.None;
    this.pac.chompT = 0;
    this.trail = [];
    this.trailDist = 0;
    this.lastPacX = START_TILE.c * TILE + TILE / 2;
    this.lastPacY = START_TILE.r * TILE + TILE / 2;
    this.shakeT = 0;

    this.ghosts = GHOST_DEFS.map((def, i) => ({
      r: 14,
      c: HOUSE_COLS[i],
      p: 0,
      dir: Dir.Up as Dir,
      isGhost: true,
      name: def.name,
      color: def.color,
      scatter: def.scatter,
      state: 'house' as GhostState,
      frightened: false,
      path: [],
      houseCol: HOUSE_COLS[i],
      bouncePhase: i * 1.7,
      releaseAt: def.releaseAt,
      releasePellets: def.releasePellets,
      baseSpeed: def.baseSpeed,
    }));

    this.floats = [];
    this.particles = [];
    this.buildMazeLayer();
    this.rebuildPelletLayer();
  }

  private resetPositions() {
    this.pac.r = START_TILE.r;
    this.pac.c = START_TILE.c;
    this.pac.p = 0;
    this.pac.dir = Dir.Left;
    this.pac.nextDir = Dir.None;
    for (const g of this.ghosts) {
      g.r = 14;
      g.c = g.houseCol;
      g.p = 0;
      g.dir = Dir.Up;
      g.state = 'house';
      g.frightened = false;
      g.path = [];
    }
    this.frightT = 0;
    this.ghostCombo = 0;
    this.trail = [];
    this.trailDist = 0;
    this.lastPacX = START_TILE.c * TILE + TILE / 2;
    this.lastPacY = START_TILE.r * TILE + TILE / 2;
  }

  // ------------------------------------------------------------------ speeds

  private pacSpeed() {
    return Math.min(4.1 + (this.level - 1) * 0.22, 5.6);
  }

  private frightSpeed() {
    return Math.min(2.05 + (this.level - 1) * 0.08, 3.0);
  }

  private eyesSpeed() {
    return 5.4;
  }

  private pathSpeed() {
    return 4.8;
  }

  private powerDuration() {
    return Math.max(2.2, 6.2 - (this.level - 1) * 0.5);
  }

  private ghostSpeed(g: Ghost) {
    if (g.state === 'eyes') return this.eyesSpeed();
    if (g.state === 'leaving' || g.state === 'entering') return this.pathSpeed();
    const base = g.frightened ? this.frightSpeed() : g.baseSpeed + Math.min((this.level - 1) * 0.18, 1.2);
    if (g.r === TUNNEL_ROW) return base * 0.55;
    return base;
  }

  // ------------------------------------------------------------------ loop

  private loop = (ts: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016);
    this.last = ts;
    if (!this.paused) this.update(dt);
    this.render();
  };

  private update(dt: number) {
    this.time += dt;
    this.updateFx(dt);
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    for (const g of this.ghosts) {
      if (g.state === 'house') g.bouncePhase += dt * 2;
    }

    switch (this.state) {
      case 'idle':
        this.pac.chompT += dt * 3;
        break;
      case 'ready':
        this.readyT -= dt;
        this.pac.chompT += dt * 4;
        if (this.readyT <= 0) {
          this.state = 'playing';
          this.emit();
        }
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'dying':
        this.deathT += dt;
        if (this.deathT > 1.7) this.afterDeath();
        break;
      case 'levelClear':
        this.levelClearT += dt;
        if (this.levelClearT > 3) this.nextLevel();
        break;
      default:
        break;
    }
  }

  private updatePlaying(dt: number) {
    this.timeSinceLevel += dt;

    // Pac-Man
    const m = this.pac;
    if (m.nextDir !== Dir.None && m.nextDir === REVERSE[m.dir]) {
      m.dir = m.nextDir;
      m.p = 1 - m.p;
      m.nextDir = Dir.None;
    }
    const crossed = this.advance(m, this.pacSpeed(), dt);
    if (m.nextDir !== Dir.None && (crossed || m.p <= 0.001)) {
      const v = DIR_VEC[m.nextDir];
      if (pacmanPassable(m.r + v.y, m.c + v.x)) {
        m.dir = m.nextDir;
        m.nextDir = Dir.None;
      }
    }
    m.chompT += dt * 9;
    this.spawnTrail();

    this.eatTile();
    this.updateBonus(dt);

    for (const g of this.ghosts) {
      if (g.state === 'house') continue;
      this.updateGhost(g, dt);
    }

    if (this.frightT > 0) {
      this.frightT -= dt;
      this.frightSndT -= dt;
      if (this.frightSndT <= 0) {
        this.sfx.frightTick();
        this.frightSndT = 0.16;
      }
      if (this.frightT <= 0) this.endFright();
    }

    this.ghostModeT -= dt;
    if (this.ghostModeT <= 0) this.toggleGhostMode();

    this.checkGhostRelease();
    this.checkCollisions();
    // Guard: eating the last pellet and being caught in the same frame must
    // still clear the level instead of silently deadlocking with no pellets left.
    if (this.pelletsLeft === 0 && this.state === 'playing') {
      this.startLevelClear();
    }
  }

  // ------------------------------------------------------------------ movement

  private advance(m: Mover, speed: number, dt: number): boolean {
    m.p += speed * dt;
    const v = DIR_VEC[m.dir];
    let nr = m.r + v.y;
    let nc = m.c + v.x;
    if (m.r === TUNNEL_ROW) {
      if (nc < 0) nc = COLS - 1;
      else if (nc >= COLS) nc = 0;
    }
    const pass = m.isGhost ? ghostPassable(nr, nc) : pacmanPassable(nr, nc);
    if (!pass) {
      // hug the wall boundary (half a tile from the current center)
      m.p = Math.min(m.p, 0.5);
      return false;
    }
    let crossed = false;
    while (m.p >= 1) {
      m.r = nr;
      m.c = nc;
      m.p -= 1;
      crossed = true;
      if (m.p < 1) break;
      nr = m.r + v.y;
      nc = m.c + v.x;
      if (m.r === TUNNEL_ROW) {
        if (nc < 0) nc = COLS - 1;
        else if (nc >= COLS) nc = 0;
      }
      const nextPass = m.isGhost ? ghostPassable(nr, nc) : pacmanPassable(nr, nc);
      if (!nextPass) {
        m.p = 0.5;
        break;
      }
    }
    return crossed;
  }

  private posOf(m: Mover): { x: number; y: number } {
    const v = DIR_VEC[m.dir];
    return {
      x: m.c * TILE + TILE / 2 + v.x * TILE * m.p,
      y: m.r * TILE + TILE / 2 + v.y * TILE * m.p,
    };
  }

  private updateGhost(g: Ghost, dt: number) {
    const speed = this.ghostSpeed(g);
    const crossed = this.advance(g, speed, dt);
    if (crossed || g.p <= 0.001) {
      if (g.state === 'active') {
        this.chooseGhostDir(g);
      } else if (g.state === 'eyes' || g.state === 'leaving' || g.state === 'entering') {
        this.stepPath(g);
      }
    }
  }

  private chooseGhostDir(g: Ghost) {
    const opts: number[] = [];
    const rev = REVERSE[g.dir];
    for (let d = 0; d < 4; d++) {
      if (d === rev) continue;
      const nr = g.r + DIR_VEC[d].y;
      const nc = g.c + DIR_VEC[d].x;
      if (!ghostPassable(nr, nc)) continue;
      if (g.state === 'active' && isDoor(nr, nc)) continue;
      opts.push(d);
    }
    if (opts.length === 0) {
      g.dir = rev as Dir;
      return;
    }
    if (g.frightened) {
      g.dir = opts[Math.floor(Math.random() * opts.length)] as Dir;
      return;
    }
    const target = this.ghostTarget(g);
    let best = opts[0];
    let bestS = Infinity;
    for (const d of opts) {
      const nr = g.r + DIR_VEC[d].y;
      const nc = g.c + DIR_VEC[d].x;
      let s = (nr - target.r) ** 2 + (nc - target.c) ** 2;
      if (d === g.dir) s -= 0.001;
      if (s < bestS) {
        bestS = s;
        best = d;
      }
    }
    g.dir = best as Dir;
  }

  private ghostTarget(g: Ghost): Tile {
    const p = this.pac;
    if (this.ghostMode === 'scatter') return g.scatter;
    const pv = DIR_VEC[p.dir];
    switch (g.name) {
      case 'Blinky':
        return { r: p.r, c: p.c };
      case 'Pinky':
        return { r: p.r + pv.y * 4, c: p.c + pv.x * 4 };
      case 'Inky': {
        const m = { r: p.r + pv.y * 2, c: p.c + pv.x * 2 };
        const bl = this.ghosts[0];
        return { r: m.r * 2 - bl.r, c: m.c * 2 - bl.c };
      }
      case 'Psychic': {
        // Mind-reader: predicts where Pac-Man is heading. Uses his queued
        // direction when a turn is buffered, falling back to his current
        // direction, and aims 3 tiles out — so it commits to the turn
        // before Pac-Man has actually taken it.
        const d = p.nextDir !== Dir.None ? p.nextDir : p.dir;
        const dv = DIR_VEC[d];
        return { r: p.r + dv.y * 3, c: p.c + dv.x * 3 };
      }
      default: {
        const d2 = (g.r - p.r) ** 2 + (g.c - p.c) ** 2;
        return d2 > 64 ? { r: p.r, c: p.c } : g.scatter;
      }
    }
  }

  private stepPath(g: Ghost) {
    if (g.path.length === 0) return;
    if (g.path[0].r === g.r && g.path[0].c === g.c) g.path.shift();
    if (g.path.length === 0) {
      this.checkPathArrival(g);
      return;
    }
    const t = g.path[0];
    g.dir = t.r !== g.r ? (t.r > g.r ? Dir.Down : Dir.Up) : t.c > g.c ? Dir.Right : Dir.Left;
  }

  private checkPathArrival(g: Ghost) {
    if (g.state === 'eyes') {
      g.state = 'entering';
      g.path = this.bfs({ r: g.r, c: g.c }, HOUSE_CENTER);
    } else if (g.state === 'entering') {
      g.state = 'house';
      g.frightened = false;
      g.r = 14;
      g.c = g.houseCol;
      g.p = 0;
      g.dir = Dir.Up;
      g.path = [];
      g.releaseAt = this.timeSinceLevel + 8;
      g.releasePellets = Infinity;
    } else if (g.state === 'leaving') {
      g.state = 'active';
    }
  }

  private bfs(start: Tile, goal: Tile): Tile[] {
    if (start.r === goal.r && start.c === goal.c) return [];
    const q: Tile[] = [start];
    const prev = new Map<number, Tile>();
    const seen = new Set<number>([start.r * COLS + start.c]);
    const gk = goal.r * COLS + goal.c;
    while (q.length) {
      const cur = q.shift()!;
      for (let d = 0; d < 4; d++) {
        const nr = cur.r + DIR_VEC[d].y;
        const nc = cur.c + DIR_VEC[d].x;
        if (!ghostPassable(nr, nc)) continue;
        const k = nr * COLS + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, cur);
        if (k === gk) {
          const path: Tile[] = [];
          let t: Tile = { r: nr, c: nc };
          while (!(t.r === start.r && t.c === start.c)) {
            path.unshift(t);
            t = prev.get(t.r * COLS + t.c)!;
          }
          return path;
        }
        q.push({ r: nr, c: nc });
      }
    }
    return [];
  }

  private nearestDoorPath(tile: Tile): Tile[] {
    const a = this.bfs(tile, DOOR_TILES[0]);
    const b = this.bfs(tile, DOOR_TILES[1]);
    return a.length <= b.length ? a : b;
  }

  private checkGhostRelease() {
    for (const g of this.ghosts) {
      if (g.state !== 'house') continue;
      if (this.timeSinceLevel < g.releaseAt && this.pelletsEaten < g.releasePellets) continue;
      g.state = 'leaving';
      g.r = 14;
      g.c = g.houseCol;
      g.p = 0;
      g.dir = Dir.Up;
      g.path = this.bfs({ r: 14, c: g.houseCol }, HOUSE_EXIT);
    }
  }

  private toggleGhostMode() {
    this.ghostMode = this.ghostMode === 'scatter' ? 'chase' : 'scatter';
    this.ghostModeT = this.ghostMode === 'scatter' ? 4 : 7;
    for (const g of this.ghosts) {
      if (g.state === 'active' || g.state === 'leaving') this.reverseGhost(g);
    }
  }

  private reverseGhost(g: Ghost) {
    g.dir = REVERSE[g.dir] as Dir;
    g.p = 1 - g.p;
  }

  // ------------------------------------------------------------------ pellets

  private eatTile() {
    const px = this.posOf(this.pac);
    const r = Math.round((px.y - TILE / 2) / TILE);
    const c = Math.round((px.x - TILE / 2) / TILE);
    const key = r * COLS + c;
    if (!this.pellets.has(key)) return;
    const power = this.pellets.get(key)!;
    this.pellets.delete(key);
    this.pelletsLeft--;
    this.pelletsEaten++;
    this.score += power ? 50 : 10;
    this.burst(r, c, power ? '#ffe08a' : '#ff9ee8', power ? 12 : 5);
    if (power) {
      this.startFright();
      this.sfx.power();
    } else {
      this.sfx.chomp(this.chompAlt++);
    }
    this.checkExtraLife();
    this.rebuildPelletLayer();
    this.emit();
    if (this.pelletsLeft === 0) this.startLevelClear();
  }

  private startLevelClear() {
    this.endFright();
    this.state = 'levelClear';
    this.levelClearT = 0;
    this.sfx.levelClear();
    this.emit();
  }

  private checkExtraLife() {
    while (this.score >= this.nextExtraLife) {
      this.lives++;
      this.nextExtraLife += 10000;
      const p = this.posOf(this.pac);
      this.floats.push({ x: p.x, y: p.y - 14, text: '1UP!', color: '#4dffc3', t: 0 });
      this.sfx.extraLife();
      this.emit();
    }
  }

  private startFright() {
    this.frightT = this.powerDuration();
    this.ghostCombo = 0;
    for (const g of this.ghosts) {
      if (g.state === 'active' || g.state === 'leaving') {
        g.frightened = true;
        this.reverseGhost(g);
      }
    }
  }

  private endFright() {
    for (const g of this.ghosts) {
      if (g.frightened) {
        g.frightened = false;
        this.reverseGhost(g);
      }
    }
    this.frightT = 0;
    this.ghostCombo = 0;
  }

  // ------------------------------------------------------------------ bonus

  private updateBonus(dt: number) {
    if (this.bonus) {
      this.bonus.t += dt;
      if (this.bonus.t > this.bonus.life) {
        this.bonus = null;
        return;
      }
      const px = this.posOf(this.pac);
      const br = this.bonus.tile.r;
      const bc = this.bonus.tile.c;
      if (Math.round((px.y - TILE / 2) / TILE) === br && Math.round((px.x - TILE / 2) / TILE) === bc) {
        this.score += 500;
        this.floats.push({ x: bc * TILE + TILE / 2, y: br * TILE + TILE / 2 - 8, text: '+500', color: '#ff4fd8', t: 0 });
        this.sfx.bonus();
        this.bonus = null;
        this.checkExtraLife();
        this.emit();
      }
      return;
    }
    const targets = [70, 170];
    if (this.bonusSpawned < targets.length && this.pelletsEaten >= targets[this.bonusSpawned]) {
      this.bonus = { tile: BONUS_TILE, t: 0, life: 9 };
      this.bonusSpawned++;
    }
  }

  // ------------------------------------------------------------------ combat

  private checkCollisions() {
    const px = this.posOf(this.pac);
    for (const g of this.ghosts) {
      if (g.state !== 'active' && g.state !== 'leaving') continue;
      const gp = this.posOf(g);
      const dx = gp.x - px.x;
      const dy = gp.y - px.y;
      if (dx * dx + dy * dy < (TILE * 0.52) ** 2) {
        if (g.frightened) this.eatGhost(g);
        else this.killPacman();
        return;
      }
    }
  }

  private eatGhost(g: Ghost) {
    this.ghostCombo++;
    const pts = 200 * Math.pow(2, this.ghostCombo - 1);
    this.score += pts;
    const gp = this.posOf(g);
    this.floats.push({ x: gp.x, y: gp.y - 10, text: `+${pts}`, color: '#4de1ff', t: 0 });
    this.burst(g.r, g.c, g.color, 14);
    this.sfx.eatGhost(this.ghostCombo);
    this.shakeT = SHAKE_DURATION;
    this.shakeMag = Math.min(4 + this.ghostCombo * 1.5, 9);
    g.frightened = false;
    g.state = 'eyes';
    g.path = this.nearestDoorPath({ r: g.r, c: g.c });
    this.checkExtraLife();
    this.emit();
  }

  private killPacman() {
    this.state = 'dying';
    this.deathT = 0;
    this.trail = [];
    this.endFright();
    const px = this.posOf(this.pac);
    for (let i = 0; i < 16; i++) {
      this.particles.push({
        x: px.x,
        y: px.y,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120,
        t: 0,
        life: 0.8,
        color: '#ffd93d',
        size: 3,
      });
    }
    this.sfx.death();
    this.emit();
  }

  private afterDeath() {
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'gameOver';
      this.saveHiScore();
    } else {
      this.resetPositions();
      this.state = 'ready';
      this.readyT = 2.2;
    }
    this.emit();
  }

  private nextLevel() {
    if (this.level >= MAX_LEVEL) {
      this.state = 'won';
      this.sfx.win();
      this.saveHiScore();
    } else {
      this.level++;
      this.setupLevel();
      this.state = 'ready';
      this.readyT = 2.2;
      this.sfx.start();
    }
    this.emit();
  }

  private saveHiScore() {
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      try {
        localStorage.setItem(HS_KEY, String(this.hiScore));
      } catch {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------------ fx

  private updateFx(dt: number) {
    for (const f of this.floats) {
      f.t += dt;
      f.y -= 22 * dt;
    }
    this.floats = this.floats.filter((f) => f.t < 1);
    for (const pt of this.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 70 * dt;
    }
    this.particles = this.particles.filter((pt) => pt.t < pt.life);
    for (const t of this.trail) {
      t.t += dt;
      t.hue = (t.hue + dt * 200) % 360;
    }
    this.trail = this.trail.filter((t) => t.t < t.life);
  }

  private spawnTrail() {
    const p = this.posOf(this.pac);
    const dx = p.x - this.lastPacX;
    const dy = p.y - this.lastPacY;
    this.lastPacX = p.x;
    this.lastPacY = p.y;
    const traveled = Math.hypot(dx, dy);
    if (traveled <= 0) return;
    const step = 5;
    // Place dots at every `step` pixels of accumulated travel, interpolated
    // along this frame's movement segment (handles multi-crossing frames too).
    let remaining = step - this.trailDist;
    while (remaining <= traveled) {
      const f = remaining / traveled;
      this.trail.push({
        x: p.x - dx * (1 - f),
        y: p.y - dy * (1 - f),
        hue: (this.time * 200) % 360,
        t: 0,
        life: 0.45,
        size: 2.6 + Math.random() * 1.4,
      });
      remaining += step;
    }
    this.trailDist = traveled - (remaining - step);
    if (this.trail.length > 60) this.trail.splice(0, this.trail.length - 60);
  }

  private burst(r: number, c: number, color: string, n: number) {
    const x = c * TILE + TILE / 2;
    const y = r * TILE + TILE / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 60;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        t: 0,
        life: 0.5 + Math.random() * 0.3,
        color,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  // ------------------------------------------------------------------ layers

  private buildMazeLayer() {
    const layer = document.createElement('canvas');
    layer.width = CANVAS_W;
    layer.height = CANVAS_H;
    const g = layer.getContext('2d');
    if (!g) return;
    this.mazeLayer = layer;

    // floor
    const grad = g.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#0b0e26');
    grad.addColorStop(1, '#070a1c');
    g.fillStyle = grad;
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // neon color shifts slightly per level
    const hue = (185 + (this.level - 1) * 18) % 360;
    const neon = `hsl(${hue} 100% 62%)`;

    // walls
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.isWallChar(r, c)) {
          const x = c * TILE;
          const y = r * TILE;
          g.shadowColor = neon;
          g.shadowBlur = 10;
          g.fillStyle = '#131a3e';
          roundRect(g, x + 2, y + 2, TILE - 4, TILE - 4, 6);
          g.fill();
          g.shadowBlur = 0;
          g.strokeStyle = neon;
          g.lineWidth = 1.6;
          g.globalAlpha = 0.9;
          roundRect(g, x + 2.5, y + 2.5, TILE - 5, TILE - 5, 5.5);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    }

    // ghost house tint + door
    g.fillStyle = 'rgba(255,79,140,0.06)';
    roundRect(g, 11 * TILE, 13 * TILE, 6 * TILE, 4 * TILE, 10);
    g.fill();
    g.strokeStyle = 'rgba(255,79,140,0.35)';
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    roundRect(g, 11 * TILE, 13 * TILE, 6 * TILE, 4 * TILE, 10);
    g.stroke();
    g.setLineDash([]);
    // door bar
    g.shadowColor = '#ff4fd8';
    g.shadowBlur = 12;
    g.fillStyle = '#ff4fd8';
    roundRect(g, 13 * TILE + 2, 13 * TILE + 2, 2 * TILE - 4, 6, 3);
    g.fill();
    g.shadowBlur = 0;
  }

  private isWallChar(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS && this.gridChar(r, c) === '#';
  }

  private gridChar(r: number, c: number): string {
    return GRID[r][c];
  }

  private rebuildPelletLayer() {
    const layer = document.createElement('canvas');
    layer.width = CANVAS_W;
    layer.height = CANVAS_H;
    const g = layer.getContext('2d');
    if (!g) return;
    this.pelletLayer = layer;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this.pellets.forEach((power, key) => {
      if (power) return; // OwO power pellets drawn dynamically for pulse
      const r = Math.floor(key / COLS);
      const c = key % COLS;
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2 + 1;
      const color = PELLET_COLORS[(r * 13 + c * 7) % PELLET_COLORS.length];
      g.font = '700 9px Quicksand, "Segoe UI", sans-serif';
      g.shadowColor = color;
      g.shadowBlur = 7;
      g.fillStyle = color;
      g.fillText('UwU', x, y);
      g.shadowBlur = 0;
    });
  }

  // ------------------------------------------------------------------ render

  private render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#070a1c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // screen shake (decays over time)
    const s = this.shakeT > 0 ? this.shakeT / SHAKE_DURATION : 0;
    ctx.save();
    if (s > 0) {
      ctx.translate((Math.random() * 2 - 1) * this.shakeMag * s, (Math.random() * 2 - 1) * this.shakeMag * s);
    }
    if (this.mazeLayer) ctx.drawImage(this.mazeLayer, 0, 0);
    if (this.pelletLayer) ctx.drawImage(this.pelletLayer, 0, 0);
    this.drawPowerPellets(ctx);
    this.drawBonus(ctx);
    this.drawTrail(ctx);

    for (const g of this.ghosts) {
      if (g.state === 'house') this.drawHouseGhost(ctx, g);
      else this.drawGhost(ctx, g);
    }
    if (this.state === 'dying') this.drawDyingPac(ctx);
    else this.drawPac(ctx);

    this.drawFloats(ctx);
    this.drawParticles(ctx);
    this.drawCenterMessage(ctx);
    ctx.restore();
  }

  private drawTrail(ctx: CanvasRenderingContext2D) {
    for (const t of this.trail) {
      const a = Math.max(0, 1 - t.t / t.life);
      const hue = t.hue % 360;
      ctx.save();
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = `hsl(${hue} 100% 65%)`;
      ctx.shadowColor = `hsl(${hue} 100% 60%)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.size * a + 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHouseGhost(ctx: CanvasRenderingContext2D, g: Ghost) {
    const x = (g.houseCol + 0.5) * TILE;
    const y = (HOUSE_ROW + 0.5) * TILE + Math.sin(g.bouncePhase) * TILE * 0.55;
    this.drawGhostBody(ctx, x, y, g.color, 1, g.dir, g.frightened);
  }

  private drawGhost(ctx: CanvasRenderingContext2D, g: Ghost) {
    const p = this.posOf(g);
    if (g.state === 'eyes') {
      this.drawEyes(ctx, p.x, p.y, TILE * 0.48, g.dir);
    } else {
      this.drawGhostBody(ctx, p.x, p.y, g.color, 1, g.dir, g.frightened);
    }
  }

  private drawEyes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: Dir) {
    const ex = Math.cos(DIR_ANGLE[dir]) * 2;
    const ey = Math.sin(DIR_ANGLE[dir]) * 2;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.2, r * 0.22, r * 0.3, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.3, y - r * 0.2, r * 0.22, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2743ff';
    ctx.beginPath();
    ctx.arc(x - r * 0.3 + ex, y - r * 0.2 + ey, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3 + ex, y - r * 0.2 + ey, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGhostBody(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    scale: number,
    dir: Dir,
    frightened: boolean,
  ) {
    const r = TILE * 0.48 * scale;
    const flash =
      frightened && this.frightT < 1.6 && Math.floor(this.time * 10) % 2 === 0;

    ctx.save();
    ctx.shadowColor = frightened ? '#2e4fff' : color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = flash ? '#ffffff' : frightened ? '#2e4fff' : color;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.15, r, Math.PI, 0);
    for (let i = 0; i < 3; i++) {
      const bx = x - r + (i * 2 * r) / 3 + r / 3;
      ctx.arc(bx, y + r * 0.15, r / 3, 0, Math.PI);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // eyes
    const ex = Math.cos(DIR_ANGLE[dir]) * 1.5;
    const ey = Math.sin(DIR_ANGLE[dir]) * 1.5;
    if (frightened) {
      // scared face
      ctx.fillStyle = flash ? '#2e4fff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.32, y - r * 0.35, r * 0.16, 0, Math.PI * 2);
      ctx.arc(x + r * 0.32, y - r * 0.35, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = flash ? '#2e4fff' : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.42, y + r * 0.28);
      for (let i = 0; i < 4; i++) {
        const bx = x - r * 0.42 + (i * r * 0.28);
        ctx.lineTo(bx + r * 0.14, y + r * 0.28 + (i % 2 === 0 ? 3 : -3));
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.32, y - r * 0.35, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.32, y - r * 0.35, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2743ff';
      ctx.beginPath();
      ctx.arc(x - r * 0.32 + ex, y - r * 0.35 + ey, r * 0.1, 0, Math.PI * 2);
      ctx.arc(x + r * 0.32 + ex, y - r * 0.35 + ey, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPac(ctx: CanvasRenderingContext2D) {
    const p = this.posOf(this.pac);
    const r = TILE * 0.48;
    const chomp = 0.16 + 0.3 * Math.abs(Math.sin(this.pac.chompT));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(DIR_ANGLE[this.pac.dir]);
    ctx.shadowColor = '#ffd93d';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(0, 0, r, chomp, Math.PI * 2 - chomp);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.18, -r * 0.45, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(r * 0.18, -r * 0.45, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawDyingPac(ctx: CanvasRenderingContext2D) {
    const p = this.posOf(this.pac);
    const t = Math.min(1, this.deathT / 1.7);
    const r = TILE * 0.48 * (1.15 - 1.0 * t) * Math.max(0.01, 1 - t * 0.4);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.deathT * 6);
    ctx.fillStyle = '#ffd93d';
    ctx.shadowColor = '#ffd93d';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    const mouth = 0.05 + t * 0.4;
    ctx.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawPowerPellets(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.pellets.forEach((power, key) => {
      if (!power) return;
      const r = Math.floor(key / COLS);
      const c = key % COLS;
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      const pulse = 1 + Math.sin(this.time * 5 + r + c) * 0.12;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = '#ffe08a';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff7d6';
      ctx.font = '700 15px Quicksand, "Segoe UI", sans-serif';
      ctx.fillText('OwO', 0, 1);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,224,138,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  private drawBonus(ctx: CanvasRenderingContext2D) {
    if (!this.bonus) return;
    const b = this.bonus;
    const x = b.tile.c * TILE + TILE / 2;
    const y = b.tile.r * TILE + TILE / 2 + Math.sin(this.time * 6) * 2;
    const fade = b.life - b.t < 2 ? 0.4 + 0.6 * Math.abs(Math.sin(this.time * 8)) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fd8';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff8fd8';
    ctx.font = '700 14px Quicksand, "Segoe UI", sans-serif';
    ctx.fillText('XD', x, y);
    ctx.restore();
  }

  private drawFloats(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const a = Math.max(0, 1 - f.t);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = f.color;
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const pt of this.particles) {
      const a = Math.max(0, 1 - pt.t / pt.life);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * a + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCenterMessage(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'ready' && this.state !== 'levelClear') return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = 20 * TILE + TILE / 2;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = '#4de1ff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#4de1ff';
    ctx.font = '13px "Press Start 2P", monospace';
    ctx.fillText(this.state === 'ready' ? 'READY! uwu' : `LEVEL ${this.level} CLEAR!`, CANVAS_W / 2, y);
    ctx.restore();
  }
}

// re-export GRID for any consumers
export { GRID } from './constants';
