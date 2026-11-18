import * as THREE from 'three';
import { clamp, wrapAngle } from './filters.js';

// Screen space is y-down pixels. Angle `a` is clockwise-positive in screen space.
// Three.js uses an orthographic camera with y-up, so render at (x, -y) with rotation -a.

export const INK = new THREE.Color('#0b0b0c');
export const ACCENT = new THREE.Color('#1f3bff');

const SERIF = '"Bodoni Moda", "Bodoni 72", Didot, "Times New Roman", serif';
const GROT = '"Archivo", "Helvetica Neue", Helvetica, Arial, sans-serif';

// stretch: CSS font-stretch keyword (Archivo is variable 62–125% wide)
export const STYLES = {
  'serif': { font: (s) => `500 ${s}px ${SERIF}`, track: -0.02, label: 'BODONI MODA 500' },
  'serif-italic': { font: (s) => `italic 400 ${s}px ${SERIF}`, track: -0.035, label: 'BODONI MODA ITALIC' },
  'wide-black': { font: (s) => `900 ${s}px ${GROT}`, stretch: 'expanded', track: -0.03, label: 'ARCHIVO 900 / 125' },
  'wide-light': { font: (s) => `200 ${s}px ${GROT}`, stretch: 'expanded', track: 0.04, label: 'ARCHIVO 200 / 125' },
  'cond-black': { font: (s) => `800 ${s}px ${GROT}`, stretch: 'extra-condensed', track: 0, label: 'ARCHIVO 800 / 62' },
  'grot': { font: (s) => `600 ${s}px ${GROT}`, track: 0, label: 'ARCHIVO 600 / 100' },
};

// nx/ny = normalized centre, k = size multiplier, a = degrees, track = override (em)
export const LAYOUT = [
  { text: 'EVERYTHING', style: 'serif-italic', k: 1.5, nx: 0.5, ny: 0.31, a: 0 },
  { text: 'NOTHING', style: 'wide-light', k: 0.42, nx: 0.71, ny: 0.45, a: 0 },
  { text: 'CHAOS', style: 'wide-black', k: 1.3, nx: 0.38, ny: 0.62, a: -3 },
  { text: 'MOVE', style: 'serif', k: 1.15, nx: 0.05, ny: 0.55, a: -90 },
  { text: 'PLAY', style: 'cond-black', k: 1.9, nx: 0.84, ny: 0.68, a: 0 },
  { text: 'FORM', style: 'serif', k: 0.95, nx: 0.2, ny: 0.13, a: 0 },
  { text: 'TOUCH', style: 'wide-light', k: 0.72, nx: 0.6, ny: 0.13, a: 0 },
  { text: 'SPACE', style: 'cond-black', k: 0.5, nx: 0.17, ny: 0.88, a: 0, track: 0.5 },
  { text: 'SHIFT', style: 'serif-italic', k: 1.0, nx: 0.62, ny: 0.84, a: 4 },
  { text: 'FEEL', style: 'serif-italic', k: 0.95, nx: 0.955, ny: 0.3, a: 90 },
  { text: 'CREATE', style: 'wide-black', k: 0.58, nx: 0.38, ny: 0.9, a: 0 },
  { text: 'MATERIAL', style: 'grot', k: 0.34, nx: 0.84, ny: 0.93, a: 0, track: 0.3 },
  // individual letters
  { text: '&', style: 'serif-italic', k: 2.5, nx: 0.88, ny: 0.15, a: 0 },
  { text: 'A', style: 'serif', k: 1.5, nx: 0.17, ny: 0.37, a: 0 },
  { text: '?', style: 'cond-black', k: 1.2, nx: 0.55, ny: 0.62, a: 8 },
  { text: 'R', style: 'wide-black', k: 0.85, nx: 0.24, ny: 0.75, a: -12 },
  { text: 'o', style: 'serif-italic', k: 1.25, nx: 0.75, ny: 0.55, a: 0 },
  { text: '*', style: 'wide-black', k: 0.9, nx: 0.96, ny: 0.9, a: 0 },
  { text: 'g', style: 'serif-italic', k: 1.05, nx: 0.06, ny: 0.9, a: 0 },
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
    this.sy = 1; this.syv = 0; this.syRest = 1;
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
    this.qx = 1; this.qy = 1; // velocity squash
    this.react = 0;
    this.trail = [];
    this.trailTick = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.word = null;
    this.letter = null;
  }
  get label() {
    return this.word ? this.word.text : this.letter.ch;
  }
  get hw() { return (this.w * this.sx) / 2; }
  get hh() { return (this.h * this.sy) / 2; }
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
    let base = clamp(Math.min(W * (W < 700 ? 0.105 : 0.075), H * 0.13), 28, 160);
    let specs;
    for (let i = 0; i < 10; i++) {
      specs = LAYOUT.map((L, idx) => this.measure(L, idx, base, W, H));
      const area = specs.reduce((s, p) => s + p.w * p.h, 0);
      if (area < W * H * 0.3) break;
      base *= 0.92;
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

  setFont(g, st, size) {
    g.font = st.font(size);
    if ('fontStretch' in g) g.fontStretch = st.stretch || 'normal';
  }

  measure(L, idx, base, W, H) {
    const st = STYLES[L.style];
    const size = Math.round(base * L.k);
    const g = this.mctx;
    this.setFont(g, st, size);
    const track = (L.track !== undefined ? L.track : st.track) * size;
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
    const a = (L.a * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const h = asc + desc;
    return {
      L, idx, st, text: L.text, size, w, h, asc, desc, letters, x: L.nx * W, y: L.ny * H, a,
      bw: c * w + s * h, bh: s * w + c * h, // axis-aligned footprint for layout
      caption: `${String(idx + 1).padStart(2, '0')} — ${st.label} — ${size}PX`,
    };
  }

  // push overlapping layout boxes apart so the initial composition never collides
  relax(specs, W, H) {
    const top = 64, bottom = 40, side = 16, gap = Math.max(10, this.base * 0.12);
    const clampIn = (s) => {
      s.x = clamp(s.x, side + s.bw / 2, Math.max(side + s.bw / 2, W - side - s.bw / 2));
      s.y = clamp(s.y, top + s.bh / 2, Math.max(top + s.bh / 2, H - bottom - s.bh / 2));
    };
    specs.forEach(clampIn);
    for (let it = 0; it < 500; it++) {
      let moved = false;
      for (let i = 0; i < specs.length; i++) {
        for (let j = i + 1; j < specs.length; j++) {
          const A = specs[i], B = specs[j];
          const dx = B.x - A.x, dy = B.y - A.y;
          const ox = (A.bw + B.bw) / 2 + gap - Math.abs(dx);
          const oy = (A.bh + B.bh) / 2 + gap - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox / (A.bw + B.bw) < oy / (A.bh + B.bh)) {
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

  glyphCanvas(s, ch, cw, chh, pad, dpr, color) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(cw * dpr);
    c.height = Math.ceil(chh * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    this.setFont(g, s.st, s.size);
    g.fillStyle = color;
    g.textBaseline = 'alphabetic';
    g.fillText(ch, pad, pad + s.asc);
    return c;
  }

  createWord(s) {
    const W = this.W, H = this.H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pad = Math.ceil(s.size * 0.25);
    const group = new THREE.Group();
    this.root.add(group);
    const word = {
      text: s.text, spec: s, caption: s.caption, letters: [], bound: true,
      nx: s.x / W, ny: s.y / H, homeX: s.x, homeY: s.y, homeA: s.a, group, body: null,
    };
    const unit = this.base * this.base * 1.2;
    s.letters.forEach((Lt, i) => {
      const cw = Math.ceil(Lt.adv + pad * 2);
      const ch = Math.ceil(s.h + pad * 2);
      const c = this.glyphCanvas(s, Lt.ch, cw, ch, pad, dpr, '#ffffff');
      const ink = this.glyphCanvas(s, Lt.ch, cw, ch, pad, 1, '#0b0b0c'); // for echo trails
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
      const letter = { ch: Lt.ch, index: i, lx, word, holder, mesh, mat, body, docked: false, ink, cw, chh: ch, react: 0 };
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
    b.trail = [];
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
      lb.sy = b.sy; lb.syRest = 1; lb.syv = 0;
      lb.held = false; lb.holders = []; lb.docked = false; L.docked = false;
      lb.tint = b.tint; lb.lift = b.lift;
      word.group.remove(L.holder);
      this.root.add(L.holder);
      L.holder.rotation.set(0, 0, 0);
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
    b.sy = 1; b.syRest = 1; b.syv = 0.6; // tiny settle wobble as the word re-forms
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
      if (d > R + Math.max(b.hw, b.hh)) continue;
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
    b.sxv += (Math.random() - 0.5) * 6 * f;
    b.syv += (Math.random() - 0.5) * 6 * f;
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
        b.vx = b.vy = b.va = 0; b.sx = b.sxRest = 1; b.sxv = 0; b.sy = b.syRest = 1; b.syv = 0;
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
      const hw = b.hw, hh = b.hh;
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
            b.sxv += 1.5; b.syv -= 1;
            b.docked = false; if (b.letter) b.letter.docked = false;
          }
        }
      }
      this.pending = keep;
    }

    const W = this.W, H = this.H;
    const fr = Math.exp(-cfg.friction * dt);
    const afr = Math.exp(-cfg.angFriction * dt);
    const sK = cfg.sxK, sC = 2 * Math.sqrt(cfg.sxK) * cfg.sxDamp;
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
        const r = Math.min(1, dt * 3 * ramp);
        b.sxRest += (1 - b.sxRest) * r;
        b.syRest += (1 - b.syRest) * r;
        const am = Math.hypot(ax, ay), cap = 9000 * this.speedScale;
        if (am > cap) { ax *= cap / am; ay *= cap / am; }
      } else {
        b.vx *= fr; b.vy *= fr; b.va *= afr;
      }
      b.vx += ax * dt; b.vy += ay * dt; b.va += aa * dt;
      b.va = clamp(b.va, -30, 30);
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;

      // elastic scale springs (underdamped → wobble)
      b.sxv += (sK * (b.sxRest - b.sx) - sC * b.sxv) * dt;
      b.sx = clamp(b.sx + b.sxv * dt, 0.15, 7);
      b.syv += (sK * (b.syRest - b.sy) - sC * b.syv) * dt;
      b.sy = clamp(b.sy + b.syv * dt, 0.15, 7);

      if (!b.held) this.walls(b, W, H);
      if (!b.held && !b.asmActive && Math.abs(b.vx) + Math.abs(b.vy) < 2) { b.vx = 0; b.vy = 0; }
    }

    this.collide();
    this.dock();
  }

  walls(b, W, H) {
    const e = this.cfg.wallBounce;
    const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
    const hw = b.hw, hh = b.hh;
    const ex = Math.min(c * hw + s * hh, W / 2), ey = Math.min(s * hw + c * hh, H / 2);
    const k = 0.00025;
    if (b.x < ex) { b.x = ex; if (b.vx < 0) { b.sxv -= Math.abs(b.vx) * k * 4; b.vx = -b.vx * e; b.va += b.vy * 0.002; } }
    if (b.x > W - ex) { b.x = W - ex; if (b.vx > 0) { b.sxv -= Math.abs(b.vx) * k * 4; b.vx = -b.vx * e; b.va -= b.vy * 0.002; } }
    if (b.y < ey) { b.y = ey; if (b.vy < 0) { b.syv -= Math.abs(b.vy) * k * 4; b.vy = -b.vy * e; b.va -= b.vx * 0.002; } }
    if (b.y > H - ey) { b.y = H - ey; if (b.vy > 0) { b.syv -= Math.abs(b.vy) * k * 4; b.vy = -b.vy * e; b.va += b.vx * 0.002; } }
  }

  collide() {
    const list = this.bodies;
    const n = list.length;
    const e = this.cfg.collideBounce;
    for (let i = 0; i < n; i++) {
      const A = list[i];
      if (A.docked || A.asmActive) continue;
      const rA = Math.hypot(A.hw, A.hh);
      for (let j = i + 1; j < n; j++) {
        const B = list[j];
        if (B.docked || B.asmActive) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const rB = Math.hypot(B.hw, B.hh);
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
          if (jn > 150) {
            const q = Math.min(1.2, jn * 0.0004);
            A.sxv -= q * imA; A.syv += q * 0.6 * imA;
            B.sxv -= q * imB; B.syv += q * 0.6 * imB;
          }
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
      if (Math.hypot(h.x - b.x, h.y - b.y) < lim && Math.hypot(b.vx, b.vy) < 60 && Math.abs(wrapAngle(h.a - b.a)) < 0.05 &&
          Math.abs(b.sx - 1) < 0.06 && Math.abs(b.sy - 1) < 0.06) {
        b.x = h.x; b.y = h.y; b.a = h.a; b.vx = b.vy = b.va = 0;
        b.sx = b.sxRest = 1; b.sxv = 0; b.sy = b.syRest = 1; b.syv = 0;
        b.docked = true; b.letter.docked = true;
      }
    }
    for (const w of this.words) {
      if (!w.bound && w.letters.every((L) => L.docked)) this.rebind(w);
    }
  }

  // ---------- rendering ----------
  // cursors: [{x, y, pinch}] — letters lean towards / lift for nearby hands
  sync(dt, time, cursors) {
    const k = Math.min(1, dt * 12);
    const ks = Math.min(1, dt * 14);
    const R = this.base * 2.2;
    for (const b of this.bodies) {
      b.lift += ((b.held ? 1 : 0) - b.lift) * k;
      b.tint += ((b.held ? 1 : 0) - b.tint) * Math.min(1, dt * 8);
      const still = !b.held && !b.asmActive && Math.abs(b.vx) + Math.abs(b.vy) < 1;
      const bob = still ? Math.sin(time * 0.8 + b.phase) * this.base * 0.022 : 0;
      b.bob = (b.bob || 0) + (bob - (b.bob || 0)) * Math.min(1, dt * 3);

      // velocity squash & stretch in the body's own frame
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const vlx = c * b.vx + s * b.vy, vly = -s * b.vx + c * b.vy;
      const sp = 0.00011 / Math.max(0.5, this.speedScale);
      const tqx = 1 + Math.min(0.35, Math.abs(vlx) * sp) - Math.min(0.15, Math.abs(vly) * sp * 0.45);
      const tqy = 1 + Math.min(0.35, Math.abs(vly) * sp) - Math.min(0.15, Math.abs(vlx) * sp * 0.45);
      b.qx += (tqx - b.qx) * ks;
      b.qy += (tqy - b.qy) * ks;

      const lift = 1 + b.lift * 0.06;
      // mild volume preservation: stretching one axis thins the other
      const vsx = b.sx * Math.pow(b.sy, -0.18) * b.qx * lift;
      const vsy = b.sy * Math.pow(b.sx, -0.18) * b.qy * lift;
      b.vsx = vsx; b.vsy = vsy;
      b.obj.position.set(b.x, -(b.y + b.bob), b.held ? 50 : b.z);
      b.obj.rotation.z = -b.a;
      b.obj.scale.set(vsx, vsy, 1);

      // letter-level reaction to nearby hands
      if (b.word) {
        for (const L of b.word.letters) {
          const wx = b.x + c * L.lx * vsx, wy = b.y + s * L.lx * vsx;
          let f = 0, side = 0;
          for (const p of cursors) {
            const d = Math.hypot(p.x - wx, p.y - wy);
            const ff = Math.max(0, 1 - d / R);
            if (ff > f) { f = ff; side = Math.sign(wx - p.x); }
          }
          f = f * f * (3 - 2 * f);
          if (b.held) f = Math.max(f, 0.35 + 0.25 * Math.sin(time * 9 + L.index * 0.9));
          L.react += (f - L.react) * Math.min(1, dt * 10);
          L.holder.position.y = L.react * this.base * 0.16;
          L.holder.rotation.z = -side * L.react * 0.09;
          const sc = 1 + L.react * 0.1;
          L.holder.scale.set(sc, sc, 1);
        }
      } else if (b.letter) {
        let f = 0;
        for (const p of cursors) f = Math.max(f, 1 - Math.hypot(p.x - b.x, p.y - b.y) / R);
        f = Math.max(0, f);
        b.react += (f * f - b.react) * Math.min(1, dt * 10);
        b.obj.scale.set(vsx * (1 + b.react * 0.12), vsy * (1 + b.react * 0.12), 1);
      }

      // echo trail snapshots while moving fast
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 520 * this.speedScale && ++b.trailTick % 2 === 0) {
        b.trail.push({ x: b.x, y: b.y + b.bob, a: b.a, sx: vsx, sy: vsy, t: time });
        if (b.trail.length > 7) b.trail.shift();
      }
      while (b.trail.length && time - b.trail[0].t > 0.28) b.trail.shift();

      const mats = b.word ? b.word.letters.map((L) => L.mat) : [b.letter.mat];
      for (const m of mats) m.color.lerpColors(INK, ACCENT, b.tint);
    }
  }
}

// Separating-axis test for two oriented rectangles. Normal points from A to B.
function sat(A, B, dx, dy) {
  const ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);
  const hwA = A.hw * 0.96, hhA = A.hh * 0.96;
  const hwB = B.hw * 0.96, hhB = B.hh * 0.96;
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
