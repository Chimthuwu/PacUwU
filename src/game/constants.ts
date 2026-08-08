// Grid constants for the Pac-UwU maze (classic Pac-Man layout, 28 x 31 tiles).
// '#' = wall, '.' = UwU pellet, 'o' = OwO power pellet, '-' = ghost-house door, ' ' = open.

export const COLS = 28;
export const ROWS = 31;
export const TILE = 24;
export const CANVAS_W = COLS * TILE;
export const CANVAS_H = ROWS * TILE;
export const TUNNEL_ROW = 15;
export const START_TILE = { r: 23, c: 13 };
export const HOUSE_EXIT = { r: 12, c: 13 };
export const HOUSE_CENTER = { r: 15, c: 13 };
export const DOOR_TILES = [
  { r: 13, c: 13 },
  { r: 13, c: 14 },
];
export const BONUS_TILE = { r: 18, c: 13 };

export const RAW_MAZE: string[] = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '######.##### ## #####.######',
  '######.##          ##.######',
  '######.## ###--### ##.######',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '######.## ######## ##.######',
  '######.##          ##.######',
  '######.## ######## ##.######',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

export const GRID: string[][] = RAW_MAZE.map((row) => row.split(''));

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

/** Whether Pac-Man can walk on a tile (walls and the ghost-house door block him). */
export function pacmanPassable(r: number, c: number): boolean {
  if (r < 0 || r >= ROWS) return false;
  if (c < 0 || c >= COLS) return r === TUNNEL_ROW;
  const ch = GRID[r][c];
  return ch !== '#' && ch !== '-';
}

/** Whether a ghost can walk on a tile (door is passable for ghosts). */
export function ghostPassable(r: number, c: number): boolean {
  if (r < 0 || r >= ROWS) return false;
  if (c < 0 || c >= COLS) return r === TUNNEL_ROW;
  return GRID[r][c] !== '#';
}

export function isDoor(r: number, c: number): boolean {
  return inBounds(r, c) && GRID[r][c] === '-';
}

export interface PelletSpot {
  r: number;
  c: number;
  power: boolean;
}

/** All pellet positions from the maze template, rebuilt for each level. */
export function buildPellets(): PelletSpot[] {
  const spots: PelletSpot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = GRID[r][c];
      if (ch === '.') spots.push({ r, c, power: false });
      else if (ch === 'o') spots.push({ r, c, power: true });
    }
  }
  return spots;
}
