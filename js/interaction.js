import { clamp, wrapAngle } from './filters.js';

// Turns pointer state (hands / mouse) into actions on the world.
export class Interaction {
  constructor(world, overlay, cfg) {
    this.world = world;
    this.overlay = overlay;
    this.cfg = cfg;
    this.onEvent = () => {};
  }

  emit(text) {
    this.onEvent(text);
  }

  update(dt, t, pointers, keyFist) {
    const W = this.world.W;
    const k = this.world.speedScale;
    const cfg = this.cfg;
    let fist = keyFist;

    for (const p of pointers) {
      if (p.held && !p.held.active) this.drop(p);

      if (!p.present) {
        if (p.held) this.release(p, true);
        p.prevPinch = false;
        p.hover = null;
        p.charge = 0;
        continue;
      }

      // --- pinch edges: grab / release ---
      if (p.pinch && !p.prevPinch) this.grab(p);
      else if (!p.pinch && p.prevPinch && p.held) this.release(p, false);
      p.prevPinch = p.pinch;

      p.hover = p.held || p.pinch ? null : this.world.hitTest(p.x, p.y, p.kind === 'hand' ? cfg.grabTol : 2);

      if (p.kind !== 'hand' || p.pinch || p.held) { p.charge = 0; continue; }

      // --- fist: magnetic reassembly while held ---
      if (p.gesture === 'fist') fist = true;

      // --- open palm: charge while held still, then scatter ---
      const pspeed = Math.hypot(p.pvx, p.pvy);
      if (p.gesture === 'open' && p.armed && pspeed < cfg.palmStill * W) {
        p.charge += dt / cfg.chargeTime;
        if (p.charge >= 1) {
          this.world.explode(p.palmX, p.palmY);
          this.overlay.shock(p.palmX, p.palmY, Math.hypot(this.world.W, this.world.H) * cfg.explodeRadius, cfg.shockSpeed * k);
          p.armed = false;
          p.charge = 0;
          this.emit('OPEN PALM — SCATTER');
        }
      } else {
        p.charge = Math.max(0, p.charge - dt * 2.5);
      }
      if (p.gesture !== 'open') {
        p.notOpen += dt;
        if (p.notOpen > 0.15) p.armed = true;
      } else p.notOpen = 0;

      // --- swipe: fast horizontal palm motion pushes a band of text ---
      if (t - p.lastSwipe > cfg.swipeCooldown && t - p.since > 0.25 && p.gesture !== 'fist' &&
          Math.abs(p.pvx) > cfg.swipeSpeed * W && Math.abs(p.pvx) > 1.8 * Math.abs(p.pvy)) {
        this.world.swipe(p.palmX, p.palmY, p.pvx, p.pvy);
        this.overlay.swipe(p.palmX, p.palmY, p.pvx);
        p.lastSwipe = t;
        p.charge = 0;
        this.emit(p.pvx > 0 ? 'SWIPE →' : '← SWIPE');
      }
    }

    // --- held bodies follow their hand(s) ---
    for (const b of this.world.bodies) {
      if (b.holders.length) this.updateHold(b);
    }

    if (fist !== this.world.assembling && this.world.forceAsm <= 0) {
      this.world.setAssembling(fist);
      if (fist) this.emit('FIST — REASSEMBLE');
    }
  }

  grab(p) {
    const cfg = this.cfg;
    const tol = p.kind === 'hand' ? cfg.grabTol : 2;
    // a second hand joining a body that is already held → two-hand stretch
    let target = null;
    for (const b of this.world.bodies) {
      if (b.holders.length === 1 && b.holders[0] !== p && this.world.hitTest(p.x, p.y, p.kind === 'hand' ? cfg.joinTol : 30, b)) {
        target = b;
        break;
      }
    }
    if (!target) target = this.world.hitTest(p.x, p.y, tol);
    if (!target || target.holders.length >= 2) return;
    if (target.docked) {
      target.docked = false;
      if (target.letter) target.letter.docked = false;
    }
    target.holders.push(p);
    target.held = true;
    target.holdKey = '';
    p.held = target;
    this.world.bringToFront(target);
    // a little elastic "pop" when picked up
    target.sxv += 1.6;
    target.syv -= 1.2;
    this.emit(target.holders.length === 2 ? `TWO HANDS — STRETCH ${target.label}` : `PINCH — ${target.label}`);
  }

  drop(p) {
    const b = p.held;
    p.held = null;
    if (!b) return;
    b.holders = b.holders.filter((h) => h !== p);
    b.held = b.holders.length > 0;
    b.holdKey = '';
  }

  release(p, lost) {
    const b = p.held;
    if (!b) return;
    const cfg = this.cfg;
    const k = this.world.speedScale;
    const g = b.hold;
    this.drop(p);
    if (b.holders.length) return; // other hand still holds it
    if (lost) return; // tracking lost: keep the body's own momentum

    const rv = p.releaseVelocity(performance.now() / 1000);
    const sp = rv.speed;
    if (sp > cfg.releaseVelMin * k) {
      let vx = rv.vx * cfg.throwGain, vy = rv.vy * cfg.throwGain;
      const vm = Math.hypot(vx, vy), cap = cfg.maxThrow * k;
      if (vm > cap) { vx *= cap / vm; vy *= cap / vm; }
      b.vx = vx;
      b.vy = vy;
      // torque from an off-centre grab point
      if (g && g.ox !== undefined) {
        const c = Math.cos(b.a), s = Math.sin(b.a);
        const rx = c * g.ox * b.sx - s * g.oy * b.sy, ry = s * g.ox * b.sx + c * g.oy * b.sy;
        const I = (b.hw * 2) ** 2 / 12 + (b.hh * 2) ** 2 / 12 + 1;
        b.va += clamp(((rx * vy - ry * vx) / I) * 0.35, -9, 9);
      }
    }
    b.va += clamp(p.angVel * 0.5, -8, 8);
    if (sp > cfg.throwSpeed * k) {
      this.emit(`THROW ${b.label} · ${Math.round(sp / k)} px/s`);
      this.overlay.throwFx(b);
    } else this.emit(`RELEASE ${b.label}`);
  }

  updateHold(b) {
    const cfg = this.cfg;
    const hs = b.holders;
    const key = hs.map((h) => h.id).join('|');
    if (key !== b.holdKey) {
      b.holdKey = key;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      if (hs.length === 1) {
        const p = hs[0];
        const dx = p.x - b.x, dy = p.y - b.y;
        b.hold = { a0: b.a, h0: p.angle, ox: (c * dx + s * dy) / b.sx, oy: (-s * dx + c * dy) / b.sy };
      } else {
        const [A, B] = hs;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const ang = Math.atan2(B.y - A.y, B.x - A.x);
        const dx = b.x - mx, dy = b.y - my;
        // Stretch along whichever of the glyph's own axes is closest to the line between the
        // hands: pull sideways → wider, pull up/down → taller.
        const rel = wrapAngle(ang - b.a);
        const axis = Math.abs(Math.cos(rel)) >= Math.abs(Math.sin(rel)) ? 'x' : 'y';
        b.hold = {
          two: true, axis, a0: b.a, d0: Math.max(30, Math.hypot(B.x - A.x, B.y - A.y)),
          s0: axis === 'x' ? b.sxRest : b.syRest,
          angPrev: ang, angAcc: 0, ox: (c * dx + s * dy) / b.sx, oy: (-s * dx + c * dy) / b.sy,
        };
      }
    }
    const g = b.hold;
    if (!g.two) {
      const p = hs[0];
      b.ta = g.a0 + (p.angle - g.h0) * cfg.rotGain;
      const c = Math.cos(b.ta), s = Math.sin(b.ta);
      const ox = g.ox * b.sx, oy = g.oy * b.sy;
      b.tx = p.x - (c * ox - s * oy);
      b.ty = p.y - (s * ox + c * oy);
    } else {
      const [A, B] = hs;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const d = Math.hypot(B.x - A.x, B.y - A.y);
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      g.angAcc += wrapAngle(ang - g.angPrev);
      g.angPrev = ang;
      b.ta = g.a0 + g.angAcc;
      const st = clamp((g.s0 * d) / g.d0, cfg.minStretch, cfg.maxStretch);
      if (g.axis === 'x') b.sxRest = st; else b.syRest = st;
      const c = Math.cos(b.ta), s = Math.sin(b.ta);
      const ox = g.ox * b.sxRest, oy = g.oy * b.syRest;
      b.tx = mx + c * ox - s * oy;
      b.ty = my + s * ox + c * oy;
    }
  }
}
