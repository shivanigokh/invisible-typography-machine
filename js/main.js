import * as THREE from 'three';
import { CFG } from './config.js';
import { World, STYLES, LAYOUT } from './world.js';
import { Hands, MousePointer } from './hands.js';
import { Interaction } from './interaction.js';
import { Overlay, drawGrid } from './overlay.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const gridCanvas = $('#grid');
const glCanvas = $('#gl');
const overlayCanvas = $('#overlay');
const video = $('#video');
const camPreview = $('#cam');
const camCanvas = $('#cam-lm');

let W = window.innerWidth, H = window.innerHeight;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, premultipliedAlpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(dpr());
renderer.setSize(W, H, false);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, W, 0, -H, -1000, 1000);
camera.position.z = 100;

const world = new World(scene, CFG);
const overlay = new Overlay(overlayCanvas);
const hands = new Hands(CFG);
const mouse = new MousePointer();
const interaction = new Interaction(world, overlay, CFG);
const pointers = [...hands.slots, mouse];

let tracker = null; // created lazily so the page still works if MediaPipe fails to load
let cameraOn = false;
let trackState = 'off'; // off | loading | searching | tracking | error
let debug = false;
let keyFist = false;
let entered = false;

// ---------- fonts, then build ----------
async function loadFonts() {
  const faces = Object.values(STYLES).map((s) => s.font(100));
  const all = Promise.all(faces.map((f) => document.fonts.load(f, LAYOUT.map((l) => l.text).join(''))));
  await Promise.race([all.then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 3500))]);
}

function layoutCanvases() {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setPixelRatio(dpr());
  renderer.setSize(W, H, false);
  camera.right = W;
  camera.bottom = -H;
  camera.updateProjectionMatrix();
  drawGrid(gridCanvas, W, H, dpr());
  overlay.resize(W, H, dpr());
}

let builtFor = null;
function onResize() {
  layoutCanvases();
  if (!builtFor) return;
  const ratio = Math.min(W, H) / Math.min(builtFor.W, builtFor.H);
  if (ratio < 0.75 || ratio > 1.33) {
    world.build(W, H); // glyph sizes are baked into textures: rebuild for big size changes
    builtFor = { W, H };
  } else world.resize(W, H);
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});

// ---------- UI ----------
const trkDot = $('#trk');
const trkLabel = $('#trk-label');
const readout = $('#readout');
const toast = $('#toast');
const legend = $('#legend');

function setTrack(state, text) {
  trackState = state;
  trkDot.dataset.state = state;
  trkLabel.textContent = text;
}

let toastTimer = 0;
function showToast(text, ms = 4200) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

let eventText = '', eventT = 0;
interaction.onEvent = (t) => { eventText = t; eventT = performance.now(); };

function toggleLegend(force) {
  const show = force !== undefined ? force : legend.hidden;
  legend.hidden = !show;
  $('#btn-guide').setAttribute('aria-pressed', String(show));
}

async function startCamera() {
  try {
    setTrack('loading', 'LOADING HAND MODEL');
    if (!tracker) {
      const { Tracker } = await import('./tracking.js');
      tracker = new Tracker(video);
    }
    await Promise.all([tracker.load(), tracker.startCamera()]);
    cameraOn = true;
    camPreview.hidden = false;
    $('#btn-cam').setAttribute('aria-pressed', 'true');
    $('#btn-cam').textContent = 'Camera on';
    setTrack('searching', 'SHOW YOUR HANDS');
  } catch (err) {
    console.error(err);
    cameraOn = false;
    if (tracker) tracker.stopCamera();
    camPreview.hidden = true;
    $('#btn-cam').setAttribute('aria-pressed', 'false');
    $('#btn-cam').textContent = 'Camera off';
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setTrack('error', denied ? 'CAMERA BLOCKED' : 'TRACKING UNAVAILABLE');
    showToast((denied ? 'Camera access was blocked. ' : 'Hand tracking could not start (' + (err.message || err) + '). ') + 'You can still play with the mouse: drag to grab and throw, Space to scatter, hold F to reassemble.', 9000);
  }
}

function stopCamera() {
  if (tracker) tracker.stopCamera();
  cameraOn = false;
  hands.clear();
  camPreview.hidden = true;
  $('#btn-cam').setAttribute('aria-pressed', 'false');
  $('#btn-cam').textContent = 'Camera off';
  setTrack('off', 'CAMERA OFF');
}

$('#btn-cam').addEventListener('click', () => (cameraOn ? stopCamera() : startCamera()));
$('#btn-reset').addEventListener('click', () => { world.reset(); interaction.emit('RESET'); });
$('#btn-guide').addEventListener('click', () => toggleLegend());
$('#legend-close').addEventListener('click', () => toggleLegend(false));

$('#enter').addEventListener('click', async () => {
  entered = true;
  document.body.classList.add('entered');
  $('#intro').setAttribute('aria-hidden', 'true');
  toggleLegend(true);
  if (window.ITM_NO_CAMERA) {
    setTrack('off', 'MOUSE MODE');
    showToast('This preview cannot use the camera. Drag words with the mouse, Space scatters, hold F to reassemble. Run the folder locally for hand tracking.', 9000);
    return;
  }
  await startCamera();
});

// ---------- mouse / touch fallback ----------
function localXY(e) {
  const r = stage.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
stage.addEventListener('pointerdown', (e) => {
  if (!entered) return;
  const [x, y] = localXY(e);
  mouse.move(x, y, performance.now() / 1000);
  mouse.pinch = true;
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('grabbing');
});
stage.addEventListener('pointermove', (e) => {
  const [x, y] = localXY(e);
  mouse.move(x, y, performance.now() / 1000);
});
const endPointer = () => { mouse.pinch = false; stage.classList.remove('grabbing'); };
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse' || !mouse.pinch) mouse.present = mouse.pinch; });
stage.addEventListener('wheel', (e) => {
  if (!mouse.held) return;
  e.preventDefault();
  if (e.shiftKey || e.altKey) {
    const b = mouse.held;
    b.sxRest = Math.min(CFG.maxStretch, Math.max(CFG.minStretch, b.sxRest * Math.exp(-(e.deltaY || e.deltaX) * 0.0015)));
  } else mouse.angle += e.deltaY * 0.0025;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (!entered) {
    if (e.key === 'Enter') $('#enter').click();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'h') toggleLegend();
  else if (k === 'c') cameraOn ? stopCamera() : startCamera();
  else if (k === 'r') world.reset();
  else if (k === 'd') debug = !debug;
  else if (k === 'f') keyFist = true;
  else if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    world.explode(mouse.x, mouse.y);
    overlay.shock(mouse.x, mouse.y, Math.hypot(W, H) * CFG.explodeRadius, CFG.shockSpeed * world.speedScale);
    interaction.emit('SCATTER');
  }
});
window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'f') keyFist = false; });

// ---------- camera preview landmarks ----------
const camG = camCanvas.getContext('2d');
function drawPreview() {
  if (camPreview.hidden) return;
  const w = camCanvas.clientWidth, h = camCanvas.clientHeight;
  if (camCanvas.width !== w * 2) { camCanvas.width = w * 2; camCanvas.height = h * 2; }
  camG.setTransform(2, 0, 0, 2, 0, 0);
  camG.clearRect(0, 0, w, h);
  // the mapped "reach" rectangle
  const m = CFG.margin;
  camG.strokeStyle = 'rgba(255,255,255,0.5)';
  camG.setLineDash([2, 3]);
  camG.strokeRect(m * w, m * h, (1 - 2 * m) * w, (1 - 2 * m) * h);
  camG.setLineDash([]);
  for (const p of hands.slots) {
    if (!p.present || !p.raw) continue;
    camG.fillStyle = p.pinch ? '#ff3b1f' : '#fff';
    for (const q of p.raw) { camG.beginPath(); camG.arc((1 - q.x) * w, q.y * h, 1.6, 0, Math.PI * 2); camG.fill(); }
  }
}

// ---------- main loop ----------
let last = performance.now() / 1000;
let acc = 0;
const STEP = 1 / 120;
let fpsAcc = 0, fpsN = 0, fps = 0, hudT = 0;

function frame(nowMs) {
  const t = nowMs / 1000;
  const dt = Math.min(0.05, Math.max(0, t - last));
  last = t;

  if (cameraOn && tracker) {
    let res = null;
    try { res = tracker.detect(nowMs); } catch (e) { console.error(e); }
    if (res) hands.ingest(res, t, W, H);
    const n = hands.count();
    if (n > 0) setTrackIf('tracking', `TRACKING · ${n} HAND${n > 1 ? 'S' : ''}`);
    else setTrackIf('searching', 'SHOW YOUR HANDS');
  }
  hands.tick(t);
  mouse.tick(t);

  interaction.update(dt, t, pointers, keyFist);

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 8) { world.step(STEP); acc -= STEP; steps++; }
  if (steps === 8) acc = 0;

  world.sync(dt, t);
  renderer.render(scene, camera);
  overlay.draw(pointers, world, debug);
  drawPreview();

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (t - hudT > 0.1) {
    hudT = t;
    const age = (performance.now() - eventT) / 1000;
    const ev = age < 2.2 ? eventText : '';
    readout.querySelector('.ev').textContent = ev;
    readout.querySelector('.ev').style.opacity = String(age < 1.6 ? 1 : Math.max(0, 1 - (age - 1.6) / 0.6));
    const free = world.bodies.filter((b) => b.letter).length;
    readout.querySelector('.meta').textContent = `${String(fps).padStart(2, '0')} FPS · ${world.bodies.length} OBJECTS${free ? ` · ${free} LOOSE LETTERS` : ''}${tracker && tracker.delegate ? ' · ' + tracker.delegate : ''}`;
  }
  requestAnimationFrame(frame);
}

function setTrackIf(state, text) {
  if (trackState !== state || trkLabel.textContent !== text) setTrack(state, text);
}

// ---------- boot ----------
(async function boot() {
  layoutCanvases();
  await loadFonts();
  world.build(W, H);
  builtFor = { W, H };
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
})();

// handy for tuning from the console
window.ITM = { cfg: CFG, world, hands, mouse, interaction };
