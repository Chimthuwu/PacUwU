// Tiny Web-Audio sound effects synthesizer — no external assets needed.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('pacuwu_muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture before sounds can play. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('pacuwu_muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.22, this.ctx.currentTime, 0.02);
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    vol = 0.5,
    slideTo = 0,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  /** Alternating high/low "waka waka" chomp. */
  chomp(alt: number) {
    this.tone(alt % 2 === 0 ? 560 : 430, 0.055, 'square', 0.4);
  }

  power() {
    this.tone(160, 1.4, 'sawtooth', 0.5, 620);
    this.tone(320, 0.9, 'square', 0.25, 500, 0.06);
  }

  frightTick() {
    this.tone(210 + Math.random() * 40, 0.06, 'square', 0.3);
  }

  eatGhost(combo: number) {
    const base = 300 * Math.pow(1.25, Math.min(combo, 4));
    for (let i = 0; i < 3; i++) {
      this.tone(base / (i + 1), 0.1, 'square', 0.45, 0, i * 0.08);
    }
  }

  bonus() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.13, 'triangle', 0.45, 0, i * 0.09));
  }

  extraLife() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.45, 0, i * 0.1));
  }

  death() {
    this.tone(640, 0.55, 'sawtooth', 0.5, 90);
    this.tone(430, 0.75, 'sawtooth', 0.45, 60, 0.28);
    this.tone(280, 0.9, 'sawtooth', 0.4, 40, 0.6);
  }

  levelClear() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.5, 0, i * 0.11));
  }

  win() {
    const seq = [523, 659, 784, 1046, 784, 1046, 1318, 1568];
    seq.forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.5, 0, i * 0.13));
    seq.forEach((f, i) => this.tone(f * 0.5, 0.2, 'square', 0.18, 0, i * 0.13 + 0.02));
  }

  start() {
    this.tone(392, 0.1, 'square', 0.4);
    this.tone(523, 0.14, 'square', 0.4, 0, 0.1);
    this.tone(659, 0.18, 'square', 0.4, 0, 0.2);
  }
}
