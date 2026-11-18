import { OneEuro, VelocityTracker, clamp, wrapAngle } from './filters.js';

// A Pointer is anything that can grab: a tracked hand or the mouse fallback.
export class Pointer {
  constructor(id, kind) {
    this.id = id;
    this.kind = kind;
    this.present = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.palmX = 0; this.palmY = 0; this.pvx = 0; this.pvy = 0;
    this.angle = 0; this.angVel = 0;
    this.pinch = false; this.prevPinch = false;
    this.gesture = 'none';
    this.held = null; this.hover = null;
    this.charge = 0; this.armed = true; this.notOpen = 0;
    this.lastSwipe = -9;
    this.since = 0;
    this.label = '';
    this.vHist = [];
  }
  recordVel(t) {
    this.vHist.push({ t, vx: this.vx, vy: this.vy });
    while (this.vHist.length && t - this.vHist[0].t > 0.2) this.vHist.shift();
  }
  // Peak velocity just before release: hands naturally brake while the pinch opens,
  // so the strongest recent sample reflects the intended throw.
  releaseVelocity(t, win = 0.14) {
    let best = { vx: this.vx, vy: this.vy }, bs = Math.hypot(this.vx, this.vy);
    for (const h of this.vHist) {
      if (t - h.t > win) continue;
      const s = Math.hypot(h.vx, h.vy);
      if (s > bs) { bs = s; best = h; }
    }
    return { vx: best.vx, vy: best.vy, speed: bs };
  }
}

const FINGERS = [[8, 5], [12, 9], [16, 13], [20, 17]]; // [tip, knuckle]

function d3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class Hand extends Pointer {
  constructor(id, cfg) {
    super(id, 'hand');
    this.cfg = cfg;
    this.fx = new OneEuro(cfg.cursorMinCutoff, cfg.cursorBeta);
    this.fy = new OneEuro(cfg.cursorMinCutoff, cfg.cursorBeta);
    this.fpx = new OneEuro(cfg.cursorMinCutoff, cfg.cursorBeta);
    this.fpy = new OneEuro(cfg.cursorMinCutoff, cfg.cursorBeta);
    this.fa = new OneEuro(cfg.angleMinCutoff, cfg.angleBeta);
    this.vel = new VelocityTracker(cfg.velWindow);
    this.pvel = new VelocityTracker(cfg.velWindow);
    this.lm = null;
    this.metrics = {};
    this.reset();
  }

  reset() {
    this.present = false;
    this.fx.reset(); this.fy.reset(); this.fpx.reset(); this.fpy.reset(); this.fa.reset();
    this.vel.reset(); this.pvel.reset(); this.vHist = [];
    this.pinch = false;
    this.pinchCnt = 0;
    this.gesture = 'none';
    this.gCand = 'none';
    this.gCnt = 0;
    this.rawAngle = null;
    this.unwrapped = 0;
    this.prevAngle = null;
    this.charge = 0;
    this.lm = null;
  }

  // lmN: normalized image landmarks, wl: 3D world landmarks (metres)
  update(lmN, wl, handed, t, W, H) {
    const cfg = this.cfg;
    const m = cfg.margin;
    const S = lmN.map((p) => ({ x: ((1 - p.x - m) / (1 - 2 * m)) * W, y: ((p.y - m) / (1 - 2 * m)) * H }));
    if (!this.present) { this.since = t; }
    this.present = true;
    this.lastSeen = t;
    this.lm = S;
    this.raw = lmN;
    this.label = handed === 'Left' ? 'R' : handed === 'Right' ? 'L' : ''; // camera is unmirrored → labels swap

    const G = wl && wl.length === 21 ? wl : lmN.map((p) => ({ x: p.x * (W / H), y: p.y, z: p.z }));
    const palm = Math.max(1e-6, d3(G[0], G[9]));
    const pinchR = d3(G[4], G[8]) / palm;
    // extension: tip→wrist / knuckle→wrist (≈2 straight, ≈1 curled)
    const curls = FINGERS.map(([tip, mcp]) => d3(G[tip], G[0]) / Math.max(1e-6, d3(G[mcp], G[0])));
    // fold: tip→own knuckle / palm (≈1 straight, ≈0.6 arched in a pinch, ≈0.35 tucked in a fist)
    const folds = FINGERS.map(([tip, mcp]) => d3(G[tip], G[mcp]) / palm);
    const thumbOut = d3(G[4], G[17]) / palm;
    this.metrics = { pinchR, curls, folds, thumbOut };

    // cursor = midpoint of thumb and index tips
    const cx = (S[4].x + S[8].x) / 2, cy = (S[4].y + S[8].y) / 2;
    this.x = this.fx.filter(cx, t);
    this.y = this.fy.filter(cy, t);
    this.vel.push(t, this.x, this.y);
    ({ vx: this.vx, vy: this.vy } = this.vel.get());
    this.recordVel(t);

    const pc = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + S[i].x / 5, y: a.y + S[i].y / 5 }), { x: 0, y: 0 });
    this.palmX = this.fpx.filter(pc.x, t);
    this.palmY = this.fpy.filter(pc.y, t);
    this.pvel.push(t, this.palmX, this.palmY);
    ({ vx: this.pvx, vy: this.pvy } = this.pvel.get());

    // in-plane hand orientation (wrist → middle knuckle), unwrapped then smoothed
    const raw = Math.atan2(S[9].y - S[0].y, S[9].x - S[0].x);
    if (this.rawAngle === null) this.unwrapped = raw;
    else this.unwrapped += clamp(wrapAngle(raw - this.rawAngle), -0.6, 0.6);
    this.rawAngle = raw;
    const a = this.fa.filter(this.unwrapped, t);
    if (this.prevAngle !== null && this.prevT) this.angVel = this.angVel * 0.6 + 0.4 * ((a - this.prevAngle) / Math.max(1e-3, t - this.prevT));
    this.prevAngle = a; this.prevT = t;
    this.angle = a;

    // pose classification
    const isFist = folds.every((f) => f < cfg.fistFold);
    const isOpen = curls.every((c) => c > cfg.openCurl) && thumbOut > cfg.openThumb && pinchR > cfg.openPinch;

    // pinch with hysteresis + frame debounce. A tight fist is never a new pinch,
    // but an existing pinch survives curling the other fingers.
    if (!this.pinch) {
      if (pinchR < cfg.pinchOn && folds[0] > cfg.pinchMinFold) {
        if (++this.pinchCnt >= cfg.pinchFramesOn) { this.pinch = true; this.pinchCnt = 0; }
      } else this.pinchCnt = 0;
    } else {
      if (pinchR > cfg.pinchOff) {
        if (++this.pinchCnt >= cfg.pinchFramesOff) { this.pinch = false; this.pinchCnt = 0; }
      } else this.pinchCnt = 0;
    }

    // an empty pinch that tightens into a fist becomes a fist (a held object is never dropped this way)
    if (this.pinch && isFist && !this.held) { this.pinch = false; this.pinchCnt = 0; }

    const cand = this.pinch ? 'pinch' : isFist ? 'fist' : isOpen ? 'open' : 'none';
    if (cand === this.gCand) this.gCnt++;
    else { this.gCand = cand; this.gCnt = 1; }
    if (this.gCnt >= cfg.gestureFrames || cand === 'pinch') this.gesture = cand;
  }
}

export class Hands {
  constructor(cfg) {
    this.cfg = cfg;
    this.slots = [new Hand(1, cfg), new Hand(2, cfg)];
  }

  ingest(res, t, W, H) {
    const dets = (res.landmarks || []).map((lm, i) => ({
      lm,
      wl: res.worldLandmarks ? res.worldLandmarks[i] : null,
      hd: res.handedness && res.handedness[i] && res.handedness[i][0] ? res.handedness[i][0].categoryName : '',
      x: (1 - lm[0].x) * W,
      y: lm[0].y * H,
    }));
    const slots = this.slots;
    const cost = (s, d) => (s.present && s.lm ? Math.hypot(s.lm[0].x - d.x, s.lm[0].y - d.y) : W * 0.4);
    let assign = [];
    if (dets.length === 1) {
      const c0 = cost(slots[0], dets[0]), c1 = cost(slots[1], dets[0]);
      assign = [c0 <= c1 ? 0 : 1];
    } else if (dets.length >= 2) {
      const a = cost(slots[0], dets[0]) + cost(slots[1], dets[1]);
      const b = cost(slots[1], dets[0]) + cost(slots[0], dets[1]);
      assign = a <= b ? [0, 1] : [1, 0];
    }
    dets.slice(0, 2).forEach((d, i) => slots[assign[i]].update(d.lm, d.wl, d.hd, t, W, H));
  }

  tick(t) {
    for (const s of this.slots) {
      if (s.present && t - s.lastSeen > this.cfg.lostGrace) s.reset();
    }
  }

  clear() {
    for (const s of this.slots) s.reset();
  }

  count() {
    return this.slots.filter((s) => s.present).length;
  }
}

// Mouse / touch fallback so the playground also works without a camera.
export class MousePointer extends Pointer {
  constructor() {
    super(0, 'mouse');
    this.vel = new VelocityTracker(0.08);
  }
  move(x, y, t) {
    this.present = true;
    this.x = x; this.y = y;
    this.palmX = x; this.palmY = y;
    this.vel.push(t, x, y);
  }
  tick(t) {
    // decay velocity estimate when the mouse is still
    if (this.vel.s.length && t - this.vel.s[this.vel.s.length - 1].t > 0.05) this.vel.push(t, this.x, this.y);
    ({ vx: this.vx, vy: this.vy } = this.vel.get());
    this.recordVel(t);
  }
}
