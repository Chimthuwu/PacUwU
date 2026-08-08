# 🟡 PAC-UwU

A modern neon Pac-Man built with React + Vite + TypeScript — except the dots are **UwU** and the power pellets are **OwO**.

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

- **UwU** pellets: 10 points each. **OwO** power pellets: 50 points + scare the ghosts so you can chomp them for 200 → 1600 points.
- 5 ghosts, each with a different personality: Blinky chases you, Pinky ambushes 4 tiles ahead, Inky mirrors Blinky's position, **Psychic** reads your *queued* direction and predicts your next turn, and Clyde gets shy up close.
- **XD** bonus item appears twice per level (70 & 170 pellets eaten) for 500 points.
- 5 levels, then victory. Ghosts get faster and fright gets shorter each level.
- Hi-score is saved in `localStorage`.
- All sounds are synthesized with the Web Audio API — no audio files needed.

### Project layout

```
src/
  game/constants.ts   maze grid + passability helpers
  game/audio.ts       Web Audio synth sfx
  game/engine.ts      game loop, movement, ghost AI, rendering
  App.tsx             HUD, overlays, keyboard + touch controls
  index.css           neon theme
```
