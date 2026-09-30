# 🟡 PAC-NEON

A true-3D synthwave Pac-Man built with React + Vite + TypeScript + Three.js. The whole maze is a real WebGL scene — extruded neon walls, a glowing grid floor, a retrowave sun on the horizon — rendered with UnrealBloom post-processing.

## Play

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

## Controls

| Action        | Key                       |
| ------------- | ------------------------- |
| Move          | `↑ ↓ ← →` or `W A S D`    |
| Pause         | `P` / `Esc`               |
| Mute          | `M`                       |
| CRT scanlines | `C`                       |
| Start/restart | `Enter` / `Space`         |

On touch screens, an on-screen d-pad appears.

## How it works

- Glowing data orbs: 10 points each. Power orbs: 50 points + scare the ghosts so you can chomp them for 200 → 1600 points.
- 5 ghosts, each with a different personality: Blinky chases you, Pinky ambushes 4 tiles ahead, Inky mirrors Blinky's position, **Psychic** reads your *queued* direction and predicts your next turn, and Clyde gets shy up close.
- A bonus artifact appears twice per level (70 & 170 orbs eaten) for 500 points.
- 5 levels, then victory. Ghosts get faster and fright gets shorter each level.
- Hi-score is saved in `localStorage`.
- All sounds are synthesized with the Web Audio API — no audio files needed.

### Project layout

```
src/
  game/constants.ts   maze grid + passability helpers
  game/audio.ts       Web Audio synth sfx
  game/engine.ts      game loop, movement, ghost AI
  game/renderer.ts    Three.js 3D scene, bloom, sprites and particles
  App.tsx             HUD, overlays, keyboard + touch controls
  index.css           synthwave theme
```