// 2D canvases: a static drafting grid behind the type, and a live overlay above it
// (hand cursors, glyph echoes, specimen captions, selection brackets, shockwaves).

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

function css(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function drawGrid(canvas, W, H, dpr) {
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const unit = 24, major = unit * 8;
  const line = css('--grid', 'rgba(0,0,0,0.035)');
  const lineStrong = css('--grid-strong', 'rgba(0,0,0,0.075)');
  const mark = css('--mark', 'rgba(0,0,0,0.45)');

  // baseline grid: dotted intersections rather than full lines
  g.fillStyle = line;
  for (let x = unit; x < W; x += unit) for (let y = unit; y < H; y += unit) g.fillRect(x, y, 1, 1);
  g.strokeStyle = lineStrong;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = major + 0.5; x < W; x += major) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = major + 0.5; y < H; y += major) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();

  // rulers along the left and bottom edges
  g.strokeStyle = mark;
  g.beginPath();
  for (let x = 0; x < W; x += 8) {
    const len = x % major === 0 ? 10 : x % (unit * 2) === 0 ? 5 : 2.5;
    g.moveTo(x + 0.5, H); g.lineTo(x + 0.5, H - len);
  }
  for (let y = 0; y < H; y += 8) {
    const len = y % major === 0 ? 10 : y % (unit * 2) === 0 ? 5 : 2.5;
    g.moveTo(0, y + 0.5); g.lineTo(len, y + 0.5);
  }
  // registration crosses at major intersections
  for (let x = major; x < W; x += major) {
    for (let y = major; y < H; y += major) {
      g.moveTo(x - 5.5, y + 0.5); g.lineTo(x + 6.5, y + 0.5);
      g.moveTo(x + 0.5, y - 5.5); g.lineTo(x + 0.5, y + 6.5);
    }
  }
  g.stroke();
  // registration target in the centre
  const cx = Math.round(W / 2) + 0.5, cy = Math.round(H / 2) + 0.5;
  g.globalAlpha = 0.5;
  g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 16, cy); g.lineTo(cx + 16, cy); g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 16); g.stroke();
  g.globalAlpha = 1;

  g.fillStyle = mark;
  g.font = `9px ${MONO}`;
  g.textBaseline = 'bottom';
  for (let x = major; x < W - 40; x += major) g.fillText(String(x).padStart(4, '0'), x + 4, H - 12);
  g.textBaseline = 'top';
  for (let y = major; y < H - 30; y += major) g.fillText(String(y).padStart(4, '0'), 14, y + 4);
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
    this.ink = css('--ink', '#0b0b0c');
    this.accent = css('--accent', '#1f3bff');
    this.soft = css('--soft', 'rgba(11,11,12,0.45)');
    this.paper = css('--paper', '#efede8');
  }

  now() { return performance.now() / 1000; }

  shock(x, y, R, speed) { this.fx.push({ k: 'shock', x, y, R, speed, t0: this.now() }); }
  swipe(x, y, vx) { this.fx.push({ k: 'swipe', x, y, vx, t0: this.now() }); }
  throwFx() {}

  draw(pointers, world, debug, time) {
    const g = this.g;
    const t = this.now();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.lineCap = 'round';

    this.echoes(world, time);
    this.captions(world);

    // effects
    this.fx = this.fx.filter((f) => {
      const age = t - f.t0;
      if (f.k === 'shock') {
        const r = age * f.speed;
        if (r > f.R * 1.15) return false;
        const a = 1 - r / (f.R * 1.15);
        g.strokeStyle = this.accent;
        g.globalAlpha = a * 0.9;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(f.x, f.y, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = this.ink;
        g.globalAlpha = a * 0.4;
        g.lineWidth = 1;
        g.setLineDash([1, 7]);
        g.beginPath(); g.arc(f.x, f.y, r * 0.7, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        // radial ticks
        g.globalAlpha = a * 0.5;
        g.beginPath();
        for (let i = 0; i < 48; i++) {
          const an = (i / 48) * Math.PI * 2;
          g.moveTo(f.x + Math.cos(an) * r, f.y + Math.sin(an) * r);
          g.lineTo(f.x + Math.cos(an) * (r + 8), f.y + Math.sin(an) * (r + 8));
        }
        g.stroke();
        g.globalAlpha = 1;
        return true;
      }
      if (f.k === 'swipe') {
        if (age > 0.55) return false;
        const a = 1 - age / 0.55;
        const len = Math.min(this.W * 0.75, Math.abs(f.vx) * 0.28) * (0.4 + age * 1.6);
        const dir = Math.sign(f.vx);
        g.strokeStyle = this.ink;
        g.lineWidth = 1;
        for (let i = -4; i <= 4; i++) {
          g.globalAlpha = a * (0.55 - Math.abs(i) * 0.06);
          const l = len * (1 - Math.abs(i) * 0.08);
          g.beginPath();
          g.moveTo(f.x - dir * l * 0.15, f.y + i * 10);
          g.lineTo(f.x + dir * l, f.y + i * 10);
          g.stroke();
        }
        g.globalAlpha = 1;
        return true;
      }
      return false;
    });

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
      if (b.holders.length !== 2 || !b.hold || !b.hold.two) continue;
      const [A, B] = b.holders;
      g.strokeStyle = this.accent;
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      g.setLineDash([]);
      for (const P of [A, B]) { g.beginPath(); g.arc(P.x, P.y, 3, 0, Math.PI * 2); g.fillStyle = this.accent; g.fill(); }
      g.font = `500 11px ${MONO}`;
      g.textAlign = 'center';
      const deg = Math.round((b.a * 180) / Math.PI);
      const s = b.hold.axis === 'x' ? b.sxRest : b.syRest;
      const lbl = `${b.hold.axis === 'x' ? '↔' : '↕'} ×${s.toFixed(2)}   ${deg}°`;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 16;
      const w = g.measureText(lbl).width + 12;
      g.fillStyle = this.accent;
      g.fillRect(mx - w / 2, my - 10, w, 18);
      g.fillStyle = this.paper;
      g.textBaseline = 'middle';
      g.fillText(lbl, mx, my);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    }

    // hands
    for (const p of pointers) {
      if (!p.present || p.kind !== 'hand' || !p.lm) continue;
      this.hand(p, t, debug);
    }
  }

  // ghost copies of fast-moving glyphs, drawn from each letter's ink canvas
  echoes(world, time) {
    const g = this.g;
    for (const b of world.bodies) {
      const n = b.trail.length;
      if (!n) continue;
      const letters = b.word ? b.word.letters : [b.letter];
      for (let i = 0; i < n; i++) {
        const s = b.trail[i];
        const age = time - s.t;
        const a = Math.max(0, 0.22 * (1 - age / 0.28)) * ((i + 1) / n);
        if (a <= 0.005) continue;
        g.save();
        g.globalAlpha = a;
        g.translate(s.x, s.y);
        g.rotate(s.a);
        g.scale(s.sx, s.sy);
        for (const L of letters) {
          const lx = b.word ? L.lx : 0;
          g.drawImage(L.ink, lx - L.cw / 2, -L.chh / 2, L.cw, L.chh);
        }
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }

  // small specimen captions that travel with each whole word
  captions(world) {
    if (this.W < 700) return;
    const g = this.g;
    g.font = `9px ${MONO}`;
    g.fillStyle = this.ink;
    g.textBaseline = 'bottom';
    for (const w of world.words) {
      if (!w.bound || w.letters.length < 2) continue;
      const b = w.body;
      const sp = Math.hypot(b.vx, b.vy);
      const target = b.held ? 0 : Math.max(0, 0.5 - sp / 600);
      b.capA = (b.capA === undefined ? target : b.capA + (target - b.capA) * 0.15);
      if (b.capA < 0.02) continue;
      const hw = (b.w * (b.vsx || b.sx)) / 2, hh = (b.h * (b.vsy || b.sy)) / 2;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const x = b.x + c * -hw - s * -hh, y = b.y + (b.bob || 0) + s * -hw + c * -hh;
      g.save();
      g.globalAlpha = b.capA;
      g.translate(x, y - 6);
      g.rotate(b.a);
      let txt = w.caption;
      if (Math.abs(b.sx - 1) > 0.03 || Math.abs(b.sy - 1) > 0.03) txt += `  ${Math.round(b.sx * 100)}/${Math.round(b.sy * 100)}%`;
      g.fillText(txt, 0, 0);
      g.restore();
    }
    g.textBaseline = 'alphabetic';
  }

  brackets(b) {
    const g = this.g;
    const pad = 10;
    const hw = (b.w * (b.vsx || b.sx)) / 2 + pad, hh = (b.h * (b.vsy || b.sy)) / 2 + pad;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const oy = b.bob || 0;
    const P = (lx, ly) => [b.x + c * lx - s * ly, b.y + oy + s * lx + c * ly];
    const L = Math.min(16, hw * 0.5, hh * 0.5);
    g.strokeStyle = b.held ? this.accent : this.ink;
    g.lineWidth = b.held ? 1.5 : 1;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x0, y0] = P(sx * hw, sy * hh);
      const [x1, y1] = P(sx * (hw - L), sy * hh);
      const [x2, y2] = P(sx * hw, sy * (hh - L));
      g.moveTo(x1, y1); g.lineTo(x0, y0); g.lineTo(x2, y2);
    }
    g.stroke();
    // centre mark
    const [cx, cy] = P(0, 0);
    g.beginPath(); g.moveTo(cx - 4, cy); g.lineTo(cx + 4, cy); g.moveTo(cx, cy - 4); g.lineTo(cx, cy + 4); g.stroke();
    const [lx, ly] = P(-hw, hh);
    g.fillStyle = b.held ? this.accent : this.soft;
    g.font = `9px ${MONO}`;
    g.textBaseline = 'top';
    const deg = Math.round((b.a * 180) / Math.PI);
    const txt = `X ${String(Math.round(b.x)).padStart(4, '0')}  Y ${String(Math.round(b.y)).padStart(4, '0')}  R ${deg}°`;
    g.save();
    g.translate(lx, ly + 4);
    g.rotate(b.a);
    g.fillText(txt, 0, 0);
    g.restore();
    g.textBaseline = 'alphabetic';
  }

  // The hand cursor is an aperture: its ring is the gap between thumb and index,
  // closing into a solid point when you pinch. Ticks around it turn with the wrist.
  hand(p, t, debug) {
    const g = this.g;
    const S = p.lm;
    // faint skeleton
    g.strokeStyle = this.ink;
    g.globalAlpha = 0.12;
    g.lineWidth = 1;
    g.beginPath();
    for (const [a, b] of BONES) { g.moveTo(S[a].x, S[a].y); g.lineTo(S[b].x, S[b].y); }
    g.stroke();
    g.globalAlpha = 0.35;
    g.fillStyle = this.ink;
    for (const i of [12, 16, 20]) { g.beginPath(); g.arc(S[i].x, S[i].y, 1.8, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;

    const col = p.pinch ? this.accent : this.ink;
    const open = p.pinchAmt === undefined ? 1 : p.pinchAmt;
    const target = p.pinch ? 6 : 10 + open * 26;
    p.ap = p.ap === undefined ? target : p.ap + (target - p.ap) * 0.35;
    const r = p.ap;

    // thumb and index tips with tension line
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 1;
    g.beginPath(); g.arc(S[4].x, S[4].y, 3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(S[8].x, S[8].y, 3, 0, Math.PI * 2); g.fill();
    if (!p.pinch) {
      g.globalAlpha = 0.4;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(S[4].x, S[4].y); g.lineTo(S[8].x, S[8].y); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // aperture ring
    g.lineWidth = p.pinch ? 2 : 1.25;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
    if (p.pinch) {
      g.beginPath(); g.arc(p.x, p.y, 3.2, 0, Math.PI * 2); g.fill();
    }
    // rotating ticks show the wrist angle
    const ticks = 12;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < ticks; i++) {
      const an = p.angle + (i / ticks) * Math.PI * 2;
      const l = i === 0 ? 9 : 4;
      g.moveTo(p.x + Math.cos(an) * (r + 3), p.y + Math.sin(an) * (r + 3));
      g.lineTo(p.x + Math.cos(an) * (r + 3 + l), p.y + Math.sin(an) * (r + 3 + l));
    }
    g.stroke();

    let tag = p.label ? p.label + ' ' : '';
    if (p.gesture === 'fist') {
      g.strokeStyle = this.accent;
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const ph = (t * 1.1 + i / 4) % 1;
        g.globalAlpha = ph;
        g.beginPath(); g.arc(p.palmX, p.palmY, 110 * (1 - ph) + 10, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      tag += 'FIST · ASSEMBLE';
    } else if (p.gesture === 'open') {
      const R = 46;
      g.strokeStyle = this.ink;
      g.globalAlpha = 0.3;
      g.lineWidth = 1;
      g.setLineDash([2, 4]);
      g.beginPath(); g.arc(p.palmX, p.palmY, R, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      if (p.charge > 0) {
        g.strokeStyle = this.accent;
        g.lineWidth = 3;
        g.beginPath(); g.arc(p.palmX, p.palmY, R, -Math.PI / 2, -Math.PI / 2 + p.charge * Math.PI * 2); g.stroke();
      }
      tag += p.armed ? `OPEN ${Math.round(p.charge * 100)}%` : 'OPEN · CLOSE TO RE-ARM';
    } else if (p.pinch) tag += p.held ? `HOLD ${p.held.label}` : 'PINCH';
    else tag += `${Math.round(open * 100)}`;

    g.fillStyle = col;
    g.font = `500 10px ${MONO}`;
    g.fillText(tag, p.x + r + 14, p.y + 4);

    if (debug && p.metrics && p.metrics.curls) {
      const m = p.metrics;
      g.fillStyle = this.soft;
      g.font = `10px ${MONO}`;
      g.fillText(`pinch ${m.pinchR.toFixed(2)}  curls ${m.curls.map((c) => c.toFixed(2)).join(' ')}  folds ${m.folds.map((c) => c.toFixed(2)).join(' ')}  thumb ${m.thumbOut.toFixed(2)}`, p.x + 16, p.y + 40);
      g.fillText(`v ${Math.round(p.vx)},${Math.round(p.vy)}  palm v ${Math.round(p.pvx)}  angle ${((p.angle * 180) / Math.PI).toFixed(0)}°`, p.x + 16, p.y + 54);
    }
  }
}
