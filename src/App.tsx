import { useCallback, useEffect, useRef, useState } from 'react';
import { Dir, Game, type UiState } from './game/engine';

const INITIAL_UI: UiState = {
  state: 'idle',
  score: 0,
  hiScore: 0,
  level: 1,
  lives: 3,
  muted: false,
  paused: false,
};

const KEY_DIR: Record<string, number> = {
  ArrowUp: Dir.Up,
  w: Dir.Up,
  W: Dir.Up,
  ArrowDown: Dir.Down,
  s: Dir.Down,
  S: Dir.Down,
  ArrowLeft: Dir.Left,
  a: Dir.Left,
  A: Dir.Left,
  ArrowRight: Dir.Right,
  d: Dir.Right,
  D: Dir.Right,
};

const GHOST_LEGEND = [
  { color: '#ff3b5c', name: 'Blinky', role: 'hot on your tail' },
  { color: '#ff9ed2', name: 'Pinky', role: 'ambushes ahead' },
  { color: '#43e0ff', name: 'Inky', role: 'calculates the cut' },
  { color: '#43ff9e', name: 'Psychic', role: 'reads your queued move' },
  { color: '#ffb347', name: 'Clyde', role: 'shy, kinda' },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const [scanlines, setScanlines] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pacuwu_scanlines') !== '0';
    } catch {
      return true;
    }
  });

  const toggleScanlines = useCallback(() => setScanlines((v) => !v), []);

  useEffect(() => {
    try {
      localStorage.setItem('pacuwu_scanlines', scanlines ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [scanlines]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, setUi);
    gameRef.current = game;
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      const k = e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
      if (k in KEY_DIR) {
        g.setDir(KEY_DIR[k]);
        return;
      }
      switch (k) {
        case 'p':
        case 'P':
        case 'Escape':
          g.togglePause();
          break;
        case 'm':
        case 'M':
          g.toggleMute();
          break;
        case 'c':
        case 'C':
          toggleScanlines();
          break;
        case 'Enter':
        case ' ':
          if (g.canStart()) g.start();
          else if (ui.paused) g.resume();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.paused, toggleScanlines]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) gameRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const g = () => gameRef.current;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const rot = useRef({ x: 15, y: 0 });
  const isDragging = useRef(false);

  useEffect(() => {
    const handleDown = () => (isDragging.current = true);
    const handleUp = () => (isDragging.current = false);
    const handleMove = (e: PointerEvent) => {
      if (!isDragging.current || !frameRef.current) return;
      rot.current.x = Math.max(0, Math.min(60, rot.current.x - e.movementY * 0.3));
      rot.current.y = Math.max(-40, Math.min(40, rot.current.y + e.movementX * 0.3));
      frameRef.current.style.transform = `rotateX(${rot.current.x}deg) rotateY(${rot.current.y}deg) scale(1.08)`;
    };
    
    window.addEventListener('pointerdown', handleDown);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointermove', handleMove);
    return () => {
      window.removeEventListener('pointerdown', handleDown);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointermove', handleMove);
    };
  }, []);

  return (
    <div className="app">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <header className="title-wrap">
        <h1 className="title">PAC-UwU</h1>
        <p className="subtitle">eat the UwU · dodge the ghosts · become the legend</p>
      </header>

      <div className="hud" aria-label="game status">
        <div className="chip">
          <span className="chip-label">Score</span>
          <span className="chip-value score">{String(ui.score).padStart(6, '0')}</span>
        </div>
        <div className="chip">
          <span className="chip-label">Hi-Score</span>
          <span className="chip-value hi">{String(ui.hiScore).padStart(6, '0')}</span>
        </div>
        <div className="chip">
          <span className="chip-label">Level</span>
          <span className="chip-value level">{ui.level}</span>
        </div>
        <div className="chip lives-chip">
          <span className="chip-label">Lives</span>
          <span className="chip-value lives">
            {Array.from({ length: Math.max(0, ui.lives) }).map((_, i) => (
              <span key={i} className="life-dot" />
            ))}
          </span>
        </div>
        <div className="hud-buttons">
          <button
            type="button"
            className={scanlines ? 'icon-btn' : 'icon-btn off'}
            onClick={toggleScanlines}
            title="CRT scanlines (C)"
            aria-label="toggle scanlines"
            aria-pressed={scanlines}
          >
            📺
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => g()?.toggleMute()}
            title="Mute (M)"
            aria-label="toggle sound"
          >
            {ui.muted ? '🔇' : '🔊'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => (ui.paused ? g()?.resume() : g()?.togglePause())}
            title="Pause (P)"
            aria-label="toggle pause"
            disabled={ui.state !== 'playing' && ui.state !== 'ready'}
          >
            {ui.paused ? '▶️' : '⏸️'}
          </button>
        </div>
      </div>

      <div className="frame-wrap">
        <div className="frame" ref={frameRef} style={{ transform: 'rotateX(15deg) scale(1.08)' }}>
          <canvas ref={canvasRef} width={672} height={744} className="pac-canvas" />
          {scanlines && <div className="scanlines" aria-hidden="true" />}

          {ui.state === 'idle' && (
            <div className="overlay">
              <div className="panel">
                <p className="panel-title">PAC-UwU</p>
                <p className="panel-sub">A very hungry little guy who only eats <span className="uwu">UwU</span> and <span className="owo">OwO</span></p>
                <button type="button" className="btn-primary" onClick={() => g()?.start()}>
                  ▶ START GAME
                </button>
                <p className="hint">or press <kbd>Enter</kbd></p>

                <div className="legend">
                  {GHOST_LEGEND.map((gh) => (
                    <div key={gh.name} className="legend-item">
                      <span className="ghost-dot" style={{ background: gh.color, boxShadow: `0 0 10px ${gh.color}` }} />
                      <span>
                        <b>{gh.name}</b> · {gh.role}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="howto">
                  <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> / <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
                  <span><kbd>P</kbd> pause · <kbd>M</kbd> mute · <kbd>C</kbd> CRT</span>
                </div>
              </div>
            </div>
          )}

          {ui.state === 'gameOver' && (
            <div className="overlay">
              <div className="panel">
                <p className="panel-title gameover">GAME OVER</p>
                <p className="panel-sub">the ghosts got you… or they got <i>owned</i>, depends who you ask</p>
                <div className="final-score">
                  <span>Score</span>
                  <b>{ui.score}</b>
                </div>
                <div className="final-score hi">
                  <span>Hi-Score</span>
                  <b>{ui.hiScore}</b>
                </div>
                <button type="button" className="btn-primary" onClick={() => g()?.start()}>
                  ↻ PLAY AGAIN
                </button>
                <p className="hint">or press <kbd>Enter</kbd></p>
              </div>
            </div>
          )}

          {ui.state === 'won' && (
            <div className="overlay">
              <div className="panel">
                <p className="panel-title win">YOU WIN! ｡♥‿♥｡</p>
                <p className="panel-sub">every last UwU and OwO has been devoured. absolute legend.</p>
                <div className="final-score">
                  <span>Final Score</span>
                  <b>{ui.score}</b>
                </div>
                <div className="final-score hi">
                  <span>Hi-Score</span>
                  <b>{ui.hiScore}</b>
                </div>
                <button type="button" className="btn-primary" onClick={() => g()?.start()}>
                  ↻ PLAY AGAIN
                </button>
              </div>
            </div>
          )}

          {ui.paused && ui.state !== 'gameOver' && ui.state !== 'won' && (
            <div className="overlay">
              <div className="panel">
                <p className="panel-title">PAUSED uwu</p>
                <p className="panel-sub">the UwU aren't going anywhere… ok they're literally frozen</p>
                <button type="button" className="btn-primary" onClick={() => g()?.resume()}>
                  ▶ RESUME
                </button>
                <p className="hint">press <kbd>P</kbd> or <kbd>Esc</kbd></p>
              </div>
            </div>
          )}
        </div>
      </div>

      {window.electron && (
        <footer className="electron-badge">
          ⚡ running in Electron {window.electron.versions.electron} · Chromium{' '}
          {window.electron.versions.chrome}
        </footer>
      )}

      <div className="dpad" aria-label="touch controls">
        <button type="button" className="dpad-btn dpad-up" onPointerDown={(e) => { e.preventDefault(); g()?.setDir(Dir.Up); }}>▲</button>
        <button type="button" className="dpad-btn dpad-left" onPointerDown={(e) => { e.preventDefault(); g()?.setDir(Dir.Left); }}>◀</button>
        <button type="button" className="dpad-btn dpad-right" onPointerDown={(e) => { e.preventDefault(); g()?.setDir(Dir.Right); }}>▶</button>
        <button type="button" className="dpad-btn dpad-down" onPointerDown={(e) => { e.preventDefault(); g()?.setDir(Dir.Down); }}>▼</button>
      </div>
    </div>
  );
}
