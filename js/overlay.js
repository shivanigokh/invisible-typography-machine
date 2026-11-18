// 2D canvases: a static grid behind the type, and a live overlay above it
// (hand skeletons, cursors, selection brackets, shockwaves).

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawGrid(canvas, W, H, dpr) {
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const minor = 40, major = 200;
  const line = css('--grid') || 'rgba(0,0,0,0.05)';
  const lineStrong = css('--grid-strong') || 'rgba(0,0,0,0.09)';
  const mark = css('--mark') || 'rgba(0,0,0,0.4)';
  g.lineWidth = 1;
  g.strokeStyle = line;
  g.beginPath();
  for (let x = 0.5; x < W; x += minor) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0.5; y < H; y += minor) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  g.strokeStyle = lineStrong;
  g.beginPath();
  for (let x = 0.5; x < W; x += major) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0.5; y < H; y += major) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  // crosses at major intersections
  g.strokeStyle = mark;
  g.beginPath();
  for (let x = major; x < W; x += major) {
    for (let y = major; y < H; y += major) {
      g.moveTo(x - 4.5, y + 0.5); g.lineTo(x + 5.5, y + 0.5);
      g.moveTo(x + 0.5, y - 4.5); g.lineTo(x + 0.5, y + 5.5);
    }
  }
  g.stroke();
  // coordinate labels along the left and bottom edges
  g.fillStyle = mark;
  g.font = `9px ${MONO}`;
  g.textBaseline = 'top';
  for (let x = major; x < W - 40; x += major) g.fillText(String(x).padStart(4, '0'), x + 4, H - 14);
  for (let y = major; y < H - 30; y += major) g.fillText(String(y).padStart(4, '0'), 6, y + 4);
}

export class Overlay {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.fx = [];
    this.W = 1; this.H = 1;
  }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.c.width = Math.round(W * dpr);
    this.c.height = Math.round(H * dpr);
    this.ink = css('--ink') || '#111';
    this.accent = css('--accent') || '#ff3b1f';
    this.soft = css('--soft') || 'rgba(0,0,0,0.35)';
  }

  now() { return performance.now() / 1000; }

  shock(x, y, R, speed) { this.fx.push({ k: 'shock', x, y, R, speed, t0: this.now() }); }
  swipe(x, y, vx) { this.fx.push({ k: 'swipe', x, y, vx, t0: this.now() }); }
  throwFx(b) { this.fx.push({ k: 'throw', b, t0: this.now() }); }

  draw(pointers, world, debug) {
    const g = this.g;
    const t = this.now();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.lineCap = 'round';

    // effects
    this.fx = this.fx.filter((f) => {
      const age = t - f.t0;
      if (f.k === 'shock') {
        const r = age * f.speed;
        if (r > f.R * 1.15) return false;
        const a = 1 - r / (f.R * 1.15);
        g.strokeStyle = this.ink;
        g.globalAlpha = a * 0.7;
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(f.x, f.y, r, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = a * 0.35;
        g.setLineDash([2, 6]);
        g.beginPath(); g.arc(f.x, f.y, r * 0.72, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        return true;
      }
      if (f.k === 'swipe') {
        if (age > 0.5) return false;
        const a = 1 - age / 0.5;
        const len = Math.min(this.W * 0.7, Math.abs(f.vx) * 0.25) * (0.4 + age * 1.6);
        const dir = Math.sign(f.vx);
        g.strokeStyle = this.ink;
        for (let i = -2; i <= 2; i++) {
          g.globalAlpha = a * (0.5 - Math.abs(i) * 0.08);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(f.x - dir * len * 0.2, f.y + i * 14);
          g.lineTo(f.x + dir * len, f.y + i * 14);
          g.stroke();
        }
        g.globalAlpha = 1;
        return true;
      }
      if (f.k === 'throw') {
        return age < 0.9 && f.b.active;
      }
      return false;
    });

    // speed lines behind fast-moving glyphs
    g.strokeStyle = this.ink;
    g.lineWidth = 1;
    for (const b of world.bodies) {
      const sp = Math.hypot(b.vx, b.vy);
      if (b.held || sp < 700 * world.speedScale) continue;
      const ux = b.vx / sp, uy = b.vy / sp;
      const len = Math.min(sp * 0.06, 160);
      const hh = b.h * 0.35;
      g.globalAlpha = Math.min(0.5, (sp - 700) / 2500);
      for (const o of [-1, 0, 1]) {
        const ox = -uy * o * hh, oy = ux * o * hh;
        const sx = b.x - ux * (b.w * b.sx * 0.3) + ox, sy = b.y - uy * (b.w * b.sx * 0.1) + oy;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - ux * len * (o ? 0.6 : 1), sy - uy * len * (o ? 0.6 : 1)); g.stroke();
      }
    }
    g.globalAlpha = 1;

    // brackets around hovered / held glyphs
    const marked = new Set();
    for (const p of pointers) {
      if (!p.present) continue;
      if (p.held) marked.add(p.held);
      else if (p.hover) marked.add(p.hover);
    }
    for (const b of marked) this.brackets(b);

    // two-hand stretch guide
    for (const b of world.bodies) {
      if (b.holders.length !== 2) continue;
      const [A, B] = b.holders;
      g.strokeStyle = this.accent;
      g.lineWidth = 1;
      g.setLineDash([3, 5]);
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = this.accent;
      g.font = `10px ${MONO}`;
      g.textAlign = 'center';
      const deg = Math.round(((b.a * 180) / Math.PI) % 360);
      g.fillText(`×${b.sxRest.toFixed(2)}  ${deg}°`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 10);
      g.textAlign = 'left';
    }

    // hands
    for (const p of pointers) {
      if (!p.present || p.kind !== 'hand' || !p.lm) continue;
      this.hand(p, t, debug);
    }
  }

  brackets(b) {
    const g = this.g;
    const pad = 10;
    const hw = (b.w * b.sx) / 2 + pad, hh = b.h / 2 + pad;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const P = (lx, ly) => [b.x + c * lx - s * ly, b.y + s * lx + c * ly];
    const L = Math.min(14, hw * 0.5, hh * 0.5);
    g.strokeStyle = b.held ? this.accent : this.ink;
    g.lineWidth = 1.25;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x0, y0] = P(sx * hw, sy * hh);
      const [x1, y1] = P(sx * (hw - L), sy * hh);
      const [x2, y2] = P(sx * hw, sy * (hh - L));
      g.moveTo(x1, y1); g.lineTo(x0, y0); g.lineTo(x2, y2);
    }
    g.stroke();
    const [lx, ly] = P(-hw, -hh);
    g.fillStyle = b.held ? this.accent : this.soft;
    g.font = `10px ${MONO}`;
    g.textBaseline = 'bottom';
    const deg = Math.round((b.a * 180) / Math.PI);
    let txt = `${b.label}  ${String(Math.round(b.x)).padStart(4, '0')},${String(Math.round(b.y)).padStart(4, '0')}  ${deg}°`;
    if (Math.abs(b.sx - 1) > 0.02) txt += `  ×${b.sx.toFixed(2)}`;
    g.save();
    g.translate(lx, ly - 4);
    g.rotate(b.a);
    g.fillText(txt, 0, 0);
    g.restore();
    g.textBaseline = 'alphabetic';
  }

  hand(p, t, debug) {
    const g = this.g;
    const S = p.lm;
    // faint skeleton
    g.strokeStyle = this.ink;
    g.globalAlpha = 0.16;
    g.lineWidth = 1;
    g.beginPath();
    for (const [a, b] of BONES) { g.moveTo(S[a].x, S[a].y); g.lineTo(S[b].x, S[b].y); }
    g.stroke();
    g.globalAlpha = 0.45;
    g.fillStyle = this.ink;
    for (const i of [4, 8, 12, 16, 20]) { g.beginPath(); g.arc(S[i].x, S[i].y, 2.2, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;

    const col = p.pinch ? this.accent : this.ink;
    // thumb–index tension line
    g.strokeStyle = col;
    g.lineWidth = 1;
    if (!p.pinch) g.setLineDash([2, 4]);
    g.beginPath(); g.moveTo(S[4].x, S[4].y); g.lineTo(S[8].x, S[8].y); g.stroke();
    g.setLineDash([]);

    // cursor
    g.strokeStyle = col;
    g.fillStyle = col;
    if (p.pinch) {
      g.beginPath(); g.arc(p.x, p.y, 5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(p.x, p.y, 11, 0, Math.PI * 2); g.stroke();
    } else {
      g.beginPath(); g.arc(p.x, p.y, 9, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      g.moveTo(p.x - 15, p.y); g.lineTo(p.x - 11, p.y); g.moveTo(p.x + 11, p.y); g.lineTo(p.x + 15, p.y);
      g.moveTo(p.x, p.y - 15); g.lineTo(p.x, p.y - 11); g.moveTo(p.x, p.y + 11); g.lineTo(p.x, p.y + 15);
      g.stroke();
    }

    let tag = p.label ? p.label + ' · ' : '';
    if (p.gesture === 'fist') {
      g.strokeStyle = this.accent;
      g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.2 + i / 3) % 1;
        g.globalAlpha = 1 - ph;
        g.beginPath(); g.arc(p.palmX, p.palmY, 70 * (1 - ph) + 8, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      tag += 'FIST';
    } else if (p.gesture === 'open') {
      g.strokeStyle = this.ink;
      g.lineWidth = 1;
      g.globalAlpha = 0.35;
      g.beginPath(); g.arc(p.palmX, p.palmY, 34, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
      if (p.charge > 0) {
        g.strokeStyle = this.accent;
        g.lineWidth = 2;
        g.beginPath(); g.arc(p.palmX, p.palmY, 34, -Math.PI / 2, -Math.PI / 2 + p.charge * Math.PI * 2); g.stroke();
      }
      tag += p.armed ? 'OPEN' : 'OPEN · CLOSE TO RE-ARM';
    } else if (p.pinch) tag += p.held ? 'HOLD' : 'PINCH';
    else tag += 'HOVER';

    g.fillStyle = col;
    g.font = `10px ${MONO}`;
    g.fillText(tag, p.x + 16, p.y + 22);

    if (debug && p.metrics && p.metrics.curls) {
      const m = p.metrics;
      g.fillStyle = this.soft;
      g.fillText(`pinch ${m.pinchR.toFixed(2)}  curls ${m.curls.map((c) => c.toFixed(2)).join(' ')}  folds ${m.folds.map((c) => c.toFixed(2)).join(' ')}  thumb ${m.thumbOut.toFixed(2)}`, p.x + 16, p.y + 36);
      g.fillText(`v ${Math.round(p.vx)},${Math.round(p.vy)}  palm v ${Math.round(p.pvx)}  angle ${((p.angle * 180) / Math.PI).toFixed(0)}°`, p.x + 16, p.y + 50);
    }
  }
}
