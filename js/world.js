import * as THREE from 'three';
import { clamp, wrapAngle } from './filters.js';

// Screen space is y-down pixels. Angle `a` is clockwise-positive in screen space.
// Three.js uses an orthographic camera with y-up, so render at (x, -y) with rotation -a.

export const INK = new THREE.Color('#111111');
export const ACCENT = new THREE.Color('#ff3b1f');

const SANS = '"Inter Tight", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';

export const STYLES = {
  'sans-heavy': { font: (s) => `800 ${s}px ${SANS}`, track: -0.045 },
  'sans-semi': { font: (s) => `600 ${s}px ${SANS}`, track: -0.03 },
  'sans-light': { font: (s) => `300 ${s}px ${SANS}`, track: 0.05 },
  'serif': { font: (s) => `400 ${s}px ${SERIF}`, track: -0.01 },
  'serif-italic': { font: (s) => `italic 400 ${s}px ${SERIF}`, track: -0.015 },
};

// nx/ny = normalized centre, k = size multiplier, a = degrees
export const LAYOUT = [
  { text: 'MOVE', style: 'sans-heavy', k: 1.25, nx: 0.17, ny: 0.25, a: -4 },
  { text: 'PLAY', style: 'serif-italic', k: 1.4, nx: 0.46, ny: 0.17, a: 0 },
  { text: 'FORM', style: 'serif', k: 1.3, nx: 0.79, ny: 0.22, a: 3 },
  { text: 'EVERYTHING', style: 'serif-italic', k: 0.8, nx: 0.56, ny: 0.33, a: -1 },
  { text: 'CHAOS', style: 'sans-heavy', k: 1.55, nx: 0.33, ny: 0.48, a: 0 },
  { text: 'TOUCH', style: 'serif-italic', k: 1.35, nx: 0.76, ny: 0.48, a: -2 },
  { text: 'SPACE', style: 'sans-light', k: 0.85, nx: 0.13, ny: 0.67, a: 0 },
  { text: 'SHIFT', style: 'sans-heavy', k: 0.95, nx: 0.5, ny: 0.66, a: 2 },
  { text: 'FEEL', style: 'serif-italic', k: 1.15, nx: 0.86, ny: 0.69, a: 5 },
  { text: 'CREATE', style: 'sans-semi', k: 0.95, nx: 0.28, ny: 0.86, a: 0 },
  { text: 'NOTHING', style: 'serif', k: 0.85, nx: 0.68, ny: 0.87, a: 0 },
  { text: 'MATERIAL', style: 'sans-light', k: 0.55, nx: 0.22, ny: 0.1, a: 0 },
  // individual letters
  { text: 'A', style: 'serif-italic', k: 1.9, nx: 0.05, ny: 0.45, a: 0 },
  { text: '&', style: 'serif', k: 1.5, nx: 0.95, ny: 0.37, a: -6 },
  { text: '?', style: 'sans-heavy', k: 1.0, nx: 0.62, ny: 0.07, a: 8 },
  { text: 'R', style: 'serif', k: 1.15, nx: 0.4, ny: 0.72, a: -8 },
  { text: 'o', style: 'sans-light', k: 1.3, nx: 0.06, ny: 0.9, a: 0 },
  { text: '*', style: 'sans-heavy', k: 1.2, nx: 0.95, ny: 0.88, a: 0 },
  { text: 'g', style: 'serif-italic', k: 1.2, nx: 0.6, ny: 0.77, a: 6 },
];

const PLANE = new THREE.PlaneGeometry(1, 1);
let NEXT_ID = 1;

export class Body {
  constructor(kind, obj, w, h, mass) {
    this.id = NEXT_ID++;
    this.kind = kind; // 'word' | 'letter'
    this.obj = obj;
    this.w = w; // unscaled collision/visual box
    this.h = h;
    this.mass = mass;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.a = 0; this.va = 0;
    this.sx = 1; this.sxv = 0; this.sxRest = 1;
    this.tx = 0; this.ty = 0; this.ta = 0;
    this.held = false;
    this.holders = [];
    this.holdKey = '';
    this.hold = null;
    this.docked = false;
    this.asmDelay = 0;
    this.active = false;
    this.lift = 0;
    this.tint = 0;
    this.z = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.word = null;
    this.letter = null;
  }
  get label() {
    return this.word ? this.word.text : this.letter.ch;
  }
}

export class World {
  constructor(scene, cfg) {
    this.scene = scene;
    this.cfg = cfg;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.words = [];
    this.bodies = [];
    this.pending = [];
    this.t = 0;
    this.W = 1; this.H = 1; this.base = 100;
    this.assembling = false;
    this.asmT = 0;
    this.forceAsm = 0;
    this.zCounter = 0;
    this.mctx = document.createElement('canvas').getContext('2d');
  }

  get speedScale() { return this.W / 1440; }

  // ---------- construction ----------
  build(W, H) {
    this.clear();
    this.W = W; this.H = H;
    let base = clamp(Math.min(W * 0.078, H * 0.135), 30, 160);
    let specs;
    for (let i = 0; i < 8; i++) {
      specs = LAYOUT.map((L) => this.measure(L, base, W, H));
      const area = specs.reduce((s, p) => s + p.w * p.h, 0);
      if (area < W * H * 0.26) break;
      base *= 0.9;
    }
    this.base = base;
    this.relax(specs, W, H);
    for (const s of specs) this.words.push(this.createWord(s));
  }

  clear() {
    for (const w of this.words) {
      for (const L of w.letters) { L.mat.map.dispose(); L.mat.dispose(); }
    }
    this.root.clear();
    this.words = [];
    this.bodies = [];
    this.pending = [];
  }

  measure(L, base, W, H) {
    const st = STYLES[L.style];
    const size = Math.round(base * L.k);
    const font = st.font(size);
    const g = this.mctx;
    g.font = font;
    const track = st.track * size;
    const m = g.measureText(L.text);
    const asc = Math.ceil(m.actualBoundingBoxAscent);
    const desc = Math.ceil(m.actualBoundingBoxDescent);
    const letters = [];
    let prev = 0;
    for (let i = 0; i < L.text.length; i++) {
      const wNext = g.measureText(L.text.slice(0, i + 1)).width;
      letters.push({ ch: L.text[i], x0: prev + track * i, adv: wNext - prev });
      prev = wNext;
    }
    const w = prev + track * (L.text.length - 1);
    return { L, text: L.text, size, font, w, h: asc + desc, asc, desc, letters, x: L.nx * W, y: L.ny * H, a: (L.a * Math.PI) / 180 };
  }

  // push overlapping layout boxes apart so the initial composition never collides
  relax(specs, W, H) {
    const top = 70, bottom = 46, side = 22, gap = Math.max(12, this.base * 0.14);
    const clampIn = (s) => {
      s.x = clamp(s.x, side + s.w / 2, Math.max(side + s.w / 2, W - side - s.w / 2));
      s.y = clamp(s.y, top + s.h / 2, Math.max(top + s.h / 2, H - bottom - s.h / 2));
    };
    for (let it = 0; it < 400; it++) {
      let moved = false;
      for (let i = 0; i < specs.length; i++) {
        for (let j = i + 1; j < specs.length; j++) {
          const A = specs[i], B = specs[j];
          const dx = B.x - A.x, dy = B.y - A.y;
          const ox = (A.w + B.w) / 2 + gap - Math.abs(dx);
          const oy = (A.h + B.h) / 2 + gap - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox / (A.w + B.w) < oy / (A.h + B.h)) {
              const s = (dx >= 0 ? 1 : -1) * ox * 0.5;
              A.x -= s; B.x += s;
            } else {
              const s = (dy >= 0 ? 1 : -1) * oy * 0.5;
              A.y -= s; B.y += s;
            }
          }
        }
      }
      specs.forEach(clampIn);
      if (!moved) break;
    }
  }

  createWord(s) {
    const W = this.W, H = this.H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pad = Math.ceil(s.size * 0.22);
    const group = new THREE.Group();
    this.root.add(group);
    const word = { text: s.text, spec: s, letters: [], bound: true, nx: s.x / W, ny: s.y / H, homeX: s.x, homeY: s.y, homeA: s.a, group, body: null };
    const unit = this.base * this.base * 1.2;
    s.letters.forEach((Lt, i) => {
      const cw = Math.ceil(Lt.adv + pad * 2);
      const ch = Math.ceil(s.h + pad * 2);
      const c = document.createElement('canvas');
      c.width = Math.ceil(cw * dpr);
      c.height = Math.ceil(ch * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      g.font = s.font;
      g.fillStyle = '#ffffff';
      g.textBaseline = 'alphabetic';
      g.fillText(Lt.ch, pad, pad + s.asc);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: INK.clone(), transparent: true, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(PLANE, mat);
      mesh.scale.set(cw, ch, 1);
      const holder = new THREE.Group();
      holder.add(mesh);
      const lx = Lt.x0 + Lt.adv / 2 - s.w / 2;
      holder.position.set(lx, 0, 0);
      group.add(holder);
      const bw = Math.max(Lt.adv * 0.9, s.size * 0.22);
      const body = new Body('letter', holder, bw, s.h, clamp((bw * s.h) / unit, 0.15, 1.4));
      const letter = { ch: Lt.ch, index: i, lx, word, holder, mesh, mat, body, docked: false };
      body.letter = letter;
      word.letters.push(letter);
    });
    const wb = new Body('word', group, s.w, s.h, clamp((s.w * s.h) / unit, 0.35, 4));
    wb.word = word;
    word.body = wb;
    wb.x = s.x; wb.y = s.y; wb.a = s.a; wb.ta = s.a;
    this.add(wb);
    return word;
  }

  add(b) {
    if (b.active) return;
    b.active = true;
    b.z = ++this.zCounter * 0.001;
    this.bodies.push(b);
  }
  remove(b) {
    if (!b.active) return;
    b.active = false;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  bringToFront(b) {
    b.z = ++this.zCounter * 0.001;
  }

  resize(W, H) {
    const oldW = this.W, oldH = this.H;
    this.W = W; this.H = H;
    for (const w of this.words) {
      w.homeX = w.nx * W;
      w.homeY = w.ny * H;
    }
    for (const b of this.bodies) {
      b.x *= W / oldW;
      b.y *= H / oldH;
    }
  }

  // ---------- word <-> letters ----------
  breakWord(word) {
    if (!word.bound || word.letters.length < 2) return [word.body];
    const b = word.body;
    this.remove(b);
    word.bound = false;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const out = [];
    for (const L of word.letters) {
      const ox = L.lx * b.sx;
      const lb = L.body;
      const rx = c * ox, ry = s * ox;
      lb.x = b.x + rx; lb.y = b.y + ry;
      lb.vx = b.vx - b.va * ry;
      lb.vy = b.vy + b.va * rx;
      lb.a = b.a; lb.ta = b.a; lb.va = b.va;
      lb.sx = b.sx; lb.sxRest = 1; lb.sxv = 0;
      lb.held = false; lb.holders = []; lb.docked = false; L.docked = false;
      lb.tint = b.tint; lb.lift = b.lift;
      word.group.remove(L.holder);
      this.root.add(L.holder);
      this.add(lb);
      out.push(lb);
    }
    return out;
  }

  rebind(word) {
    for (const L of word.letters) {
      this.remove(L.body);
      L.docked = false;
      L.body.docked = false;
      this.root.remove(L.holder);
      word.group.add(L.holder);
      L.holder.position.set(L.lx, 0, 0);
      L.holder.rotation.set(0, 0, 0);
      L.holder.scale.set(1, 1, 1);
    }
    const b = word.body;
    word.bound = true;
    b.x = word.homeX; b.y = word.homeY; b.a = word.homeA; b.ta = word.homeA;
    b.vx = b.vy = b.va = 0;
    b.sx = 1; b.sxRest = 1; b.sxv = 0;
    b.held = false; b.holders = [];
    this.add(b);
  }

  homeOf(b) {
    if (b.word) return { x: b.word.homeX, y: b.word.homeY, a: b.word.homeA };
    const w = b.letter.word;
    const c = Math.cos(w.homeA), s = Math.sin(w.homeA);
    return { x: w.homeX + c * b.letter.lx, y: w.homeY + s * b.letter.lx, a: w.homeA };
  }

  // ---------- gestures that act on the world ----------
  explode(x, y) {
    const R = Math.hypot(this.W, this.H) * this.cfg.explodeRadius;
    for (const b of this.bodies) {
      if (b.held) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > R + Math.max(b.w * b.sx, b.h) / 2) continue;
      this.pending.push({ at: this.t + d / (this.cfg.shockSpeed * this.speedScale), kind: 'blast', b, x, y, R });
    }
    this.forceAsm = 0;
  }

  applyBlast(b, x, y, R) {
    const cfg = this.cfg;
    const k = this.speedScale;
    let dx = b.x - x, dy = b.y - y;
    let d = Math.hypot(dx, dy);
    if (d < 1) { const r = Math.random() * Math.PI * 2; dx = Math.cos(r); dy = Math.sin(r); d = 1; }
    const f = clamp(1 - d / R, 0, 1);
    const sp = ((cfg.blastMin + cfg.blastMax * f * f) * k) / Math.sqrt(b.mass) * (0.8 + Math.random() * 0.4);
    const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.7;
    b.vx += Math.cos(ang) * sp;
    b.vy += Math.sin(ang) * sp;
    b.va += (Math.random() - 0.5) * cfg.blastSpin * (0.35 + f);
    b.sxv += (Math.random() - 0.5) * 5 * f;
    b.docked = false;
    if (b.letter) b.letter.docked = false;
  }

  swipe(x, y, vx, vy) {
    const band = this.H * 0.32;
    const s = Math.sign(vx);
    for (const b of this.bodies) {
      if (b.held) continue;
      const dy = b.y - y;
      if (Math.abs(dy) > band) continue;
      const ahead = (b.x - x) * s;
      if (ahead < -this.W * 0.12) continue;
      const f = 1 - Math.abs(dy) / band;
      this.pending.push({
        at: this.t + Math.max(0, ahead) / (3800 * this.speedScale),
        kind: 'push', b,
        vx: vx * this.cfg.swipeGain * (0.35 + 0.65 * f),
        vy: vy * 0.25 * f + dy * 0.6 * f,
        spin: s * (0.4 + Math.random()) * 4 * f,
      });
    }
  }

  setAssembling(on, strength = 1) {
    if (on && !this.assembling) {
      this.asmT = 0;
      const diag = Math.hypot(this.W, this.H);
      for (const b of this.bodies) {
        const h = this.homeOf(b);
        b.asmDelay = Math.random() * 0.3 + (Math.hypot(h.x - b.x, h.y - b.y) / diag) * 0.35;
      }
    }
    this.assembling = on;
    this.asmStrength = strength;
  }

  reset() {
    this.pending = [];
    this.forceAsm = 2.2;
    this.setAssembling(true, 1.8);
  }

  hardReset() {
    this.pending = [];
    this.forceAsm = 0;
    for (const w of this.words) {
      if (!w.bound) this.rebind(w);
      else {
        const b = w.body;
        b.x = w.homeX; b.y = w.homeY; b.a = b.ta = w.homeA;
        b.vx = b.vy = b.va = 0; b.sx = b.sxRest = 1; b.sxv = 0;
      }
    }
  }

  // ---------- queries ----------
  hitTest(x, y, tol, only = null) {
    let best = null, bestScore = Infinity;
    const list = only ? [only] : this.bodies;
    for (const b of list) {
      const dx = x - b.x, dy = y - b.y;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const lx = c * dx + s * dy, ly = -s * dx + c * dy;
      const hw = (b.w * b.sx) / 2, hh = b.h / 2;
      const ox = Math.max(0, Math.abs(lx) - hw), oy = Math.max(0, Math.abs(ly) - hh);
      const d = Math.hypot(ox, oy);
      if (d > tol) continue;
      // inside wins; among insides prefer smaller and front-most; outside: nearest
      const score = d > 0 ? d + 1e6 : hw * hh * 1e-6 - b.z;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  // ---------- simulation ----------
  step(dt) {
    const cfg = this.cfg;
    this.t += dt;
    if (this.forceAsm > 0) {
      this.forceAsm -= dt;
      if (this.forceAsm <= 0) { this.setAssembling(false); this.hardReset(); }
    }
    if (this.assembling) this.asmT += dt;

    // delayed impulses (shockwaves travel outward)
    if (this.pending.length) {
      const keep = [];
      for (const p of this.pending) {
        if (this.t < p.at) { keep.push(p); continue; }
        let targets = [p.b];
        if (!p.b.active || p.b.held) continue;
        if (p.kind === 'blast' && p.b.word && p.b.word.bound) targets = this.breakWord(p.b.word);
        for (const b of targets) {
          if (p.kind === 'blast') this.applyBlast(b, p.x, p.y, p.R);
          else {
            const m = Math.sqrt(b.mass);
            b.vx += p.vx / m; b.vy += p.vy / m; b.va += p.spin;
            b.docked = false; if (b.letter) b.letter.docked = false;
          }
        }
      }
      this.pending = keep;
    }

    const W = this.W, H = this.H;
    const fr = Math.exp(-cfg.friction * dt);
    const afr = Math.exp(-cfg.angFriction * dt);
    for (const b of this.bodies) {
      if (b.docked) continue;
      let ax = 0, ay = 0, aa = 0;
      b.asmActive = false;
      if (b.held) {
        const k = cfg.holdK / Math.max(0.6, Math.sqrt(b.mass));
        const c = 2 * Math.sqrt(k) * cfg.holdDamp;
        ax = k * (b.tx - b.x) - c * b.vx;
        ay = k * (b.ty - b.y) - c * b.vy;
        const ka = cfg.holdAngK;
        aa = ka * wrapAngle(b.ta - b.a) - 2 * Math.sqrt(ka) * b.va;
      } else if (this.assembling && this.asmT > b.asmDelay) {
        b.asmActive = true;
        const ramp = Math.min(1, (this.asmT - b.asmDelay) / 0.35) * (this.asmStrength || 1);
        const h = this.homeOf(b);
        const k = cfg.asmK * ramp * ramp;
        const c = 2 * Math.sqrt(cfg.asmK) * cfg.asmDamp * ramp;
        const dx = h.x - b.x, dy = h.y - b.y;
        const dist = Math.hypot(dx, dy);
        ax = k * dx - c * b.vx;
        ay = k * dy - c * b.vy;
        // gentle swirl far away, vanishing near the target → organic arcs
        const swirl = Math.min(1, dist / 400) * 0.35 * k * ((b.id % 2) * 2 - 1);
        ax += -dy * swirl * 0.25;
        ay += dx * swirl * 0.25;
        aa = k * 1.4 * wrapAngle(h.a - b.a) - c * 1.2 * b.va;
        b.sxRest += (1 - b.sxRest) * Math.min(1, dt * 3 * ramp);
        // cap acceleration to keep it smooth
        const am = Math.hypot(ax, ay), cap = 9000 * this.speedScale;
        if (am > cap) { ax *= cap / am; ay *= cap / am; }
      } else {
        b.vx *= fr; b.vy *= fr; b.va *= afr;
      }
      b.vx += ax * dt; b.vy += ay * dt; b.va += aa * dt;
      b.va = clamp(b.va, -30, 30);
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;

      // elastic horizontal scale
      const sxa = cfg.sxK * (b.sxRest - b.sx) - 2 * Math.sqrt(cfg.sxK) * cfg.sxDamp * b.sxv;
      b.sxv += sxa * dt;
      b.sx = clamp(b.sx + b.sxv * dt, 0.15, 7);

      if (!b.held) this.walls(b, W, H);
      if (!b.held && !b.asmActive && Math.abs(b.vx) + Math.abs(b.vy) < 2) { b.vx = 0; b.vy = 0; }
    }

    this.collide();
    this.dock();
  }

  walls(b, W, H) {
    const e = this.cfg.wallBounce;
    const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
    const hw = (b.w * b.sx) / 2, hh = b.h / 2;
    const ex = Math.min(c * hw + s * hh, W / 2), ey = Math.min(s * hw + c * hh, H / 2);
    if (b.x < ex) { b.x = ex; if (b.vx < 0) { b.vx = -b.vx * e; b.va += b.vy * 0.002; b.sxv -= 0.4; } }
    if (b.x > W - ex) { b.x = W - ex; if (b.vx > 0) { b.vx = -b.vx * e; b.va -= b.vy * 0.002; b.sxv -= 0.4; } }
    if (b.y < ey) { b.y = ey; if (b.vy < 0) { b.vy = -b.vy * e; b.va -= b.vx * 0.002; } }
    if (b.y > H - ey) { b.y = H - ey; if (b.vy > 0) { b.vy = -b.vy * e; b.va += b.vx * 0.002; } }
  }

  collide() {
    const list = this.bodies;
    const n = list.length;
    const e = this.cfg.collideBounce;
    for (let i = 0; i < n; i++) {
      const A = list[i];
      if (A.docked || A.asmActive) continue;
      const rA = Math.hypot((A.w * A.sx) / 2, A.h / 2);
      for (let j = i + 1; j < n; j++) {
        const B = list[j];
        if (B.docked || B.asmActive) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const rB = Math.hypot((B.w * B.sx) / 2, B.h / 2);
        if (dx * dx + dy * dy > (rA + rB) * (rA + rB)) continue;
        const hit = sat(A, B, dx, dy);
        if (!hit) continue;
        const imA = A.held ? 0 : 1 / A.mass, imB = B.held ? 0 : 1 / B.mass;
        const im = imA + imB;
        if (im === 0) continue;
        const { nx, ny, pen } = hit;
        const corr = (Math.max(pen - 0.5, 0) * 0.6) / im;
        A.x -= nx * corr * imA; A.y -= ny * corr * imA;
        B.x += nx * corr * imB; B.y += ny * corr * imB;
        const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          const jn = (-(1 + e) * rv) / im;
          A.vx -= jn * nx * imA; A.vy -= jn * ny * imA;
          B.vx += jn * nx * imB; B.vy += jn * ny * imB;
          const spin = Math.min(jn, 4000) * 0.0012;
          A.va += (Math.random() - 0.5) * spin * imA;
          B.va += (Math.random() - 0.5) * spin * imB;
          if (jn > 200) { A.sxv -= 0.15 * imA; B.sxv -= 0.15 * imB; }
        }
      }
    }
  }

  dock() {
    if (!this.assembling) return;
    const lim = this.cfg.dockDist;
    for (const b of this.bodies) {
      if (!b.letter || b.docked || b.held || !b.asmActive) continue;
      const h = this.homeOf(b);
      if (Math.hypot(h.x - b.x, h.y - b.y) < lim && Math.hypot(b.vx, b.vy) < 60 && Math.abs(wrapAngle(h.a - b.a)) < 0.05 && Math.abs(b.sx - 1) < 0.06) {
        b.x = h.x; b.y = h.y; b.a = h.a; b.vx = b.vy = b.va = 0; b.sx = b.sxRest = 1; b.sxv = 0;
        b.docked = true; b.letter.docked = true;
      }
    }
    for (const w of this.words) {
      if (!w.bound && w.letters.every((L) => L.docked)) this.rebind(w);
    }
  }

  // ---------- rendering ----------
  sync(dt, time) {
    const k = Math.min(1, dt * 12);
    for (const b of this.bodies) {
      b.lift += ((b.held ? 1 : 0) - b.lift) * k;
      b.tint += ((b.held ? 1 : 0) - b.tint) * Math.min(1, dt * 8);
      const bob = !b.held && !b.asmActive && Math.abs(b.vx) + Math.abs(b.vy) < 1 ? Math.sin(time * 0.8 + b.phase) * this.base * 0.025 : 0;
      b.bob = (b.bob || 0) + (bob - (b.bob || 0)) * Math.min(1, dt * 3);
      const lift = 1 + b.lift * 0.05;
      const sy = Math.pow(b.sx, -0.2) * lift;
      b.obj.position.set(b.x, -(b.y + b.bob), b.held ? 50 : b.z);
      b.obj.rotation.z = -b.a;
      b.obj.scale.set(b.sx * lift, sy, 1);
      const mats = b.word ? b.word.letters.map((L) => L.mat) : [b.letter.mat];
      for (const m of mats) m.color.lerpColors(INK, ACCENT, b.tint);
    }
  }
}

// Separating-axis test for two oriented rectangles. Normal points from A to B.
function sat(A, B, dx, dy) {
  const ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);
  const hwA = (A.w * A.sx) / 2 * 0.96, hhA = A.h / 2 * 0.96;
  const hwB = (B.w * B.sx) / 2 * 0.96, hhB = B.h / 2 * 0.96;
  const axes = [[ca, sa], [-sa, ca], [cb, sb], [-sb, cb]];
  let best = Infinity, bx = 0, by = 0;
  for (const [ax, ay] of axes) {
    const pA = hwA * Math.abs(ca * ax + sa * ay) + hhA * Math.abs(-sa * ax + ca * ay);
    const pB = hwB * Math.abs(cb * ax + sb * ay) + hhB * Math.abs(-sb * ax + cb * ay);
    const d = dx * ax + dy * ay;
    const o = pA + pB - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; bx = ax * sg; by = ay * sg; }
  }
  return { nx: bx, ny: by, pen: best };
}
