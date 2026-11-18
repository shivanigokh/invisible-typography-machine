// One Euro filter (Casiez et al.): low jitter when still, low lag when moving fast.
function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor(minCutoff = 1, beta = 0.01, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.t = null;
    this.x = 0;
    this.dx = 0;
  }
  filter(v, t) {
    if (this.t === null) {
      this.t = t;
      this.x = v;
      this.dx = 0;
      return v;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// Least-squares velocity over a short time window: real px/s, robust to single-frame noise.
export class VelocityTracker {
  constructor(win = 0.1) {
    this.win = win;
    this.s = [];
  }
  reset() {
    this.s.length = 0;
  }
  push(t, x, y) {
    this.s.push({ t, x, y });
    while (this.s.length > 2 && t - this.s[0].t > this.win) this.s.shift();
  }
  get() {
    const s = this.s;
    const n = s.length;
    if (n < 2) return { vx: 0, vy: 0 };
    let tm = 0, xm = 0, ym = 0;
    for (const p of s) { tm += p.t; xm += p.x; ym += p.y; }
    tm /= n; xm /= n; ym /= n;
    let stt = 0, stx = 0, sty = 0;
    for (const p of s) {
      const dt = p.t - tm;
      stt += dt * dt;
      stx += dt * (p.x - xm);
      sty += dt * (p.y - ym);
    }
    if (stt < 1e-9) return { vx: 0, vy: 0 };
    return { vx: stx / stt, vy: sty / stt };
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
