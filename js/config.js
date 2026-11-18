// Tunable parameters. Open the console and edit window.ITM.cfg live to experiment.
export const CFG = {
  // Camera → screen mapping: the outer `margin` of the camera frame maps beyond the
  // screen edges, so you can reach the corners without leaving the camera's view.
  margin: 0.1,
  lostGrace: 0.22, // seconds a hand may vanish before its grip is dropped

  // Pinch = thumb-tip ↔ index-tip distance divided by palm length (wrist → middle knuckle),
  // measured on MediaPipe's 3D world landmarks so it is independent of distance to camera.
  pinchOn: 0.30,
  pinchOff: 0.46,
  pinchFramesOn: 2,
  pinchFramesOff: 2,

  // Finger "fold" = fingertip→own knuckle / palm length: ~1.0 straight, ~0.6 arched in a
  // pinch, ~0.35 tucked into a fist. Finger "curl" = fingertip→wrist / knuckle→wrist:
  // ~2.0 fully extended, ~1.0 curled.
  fistFold: 0.55,
  pinchMinFold: 0.45, // the index must not be tucked for a pinch to start
  openCurl: 1.72,
  openThumb: 0.9,   // thumb tip ↔ pinky knuckle / palm length
  openPinch: 0.75,
  gestureFrames: 3,

  // Smoothing (One Euro filter)
  cursorMinCutoff: 1.4,
  cursorBeta: 0.015,
  angleMinCutoff: 1.0,
  angleBeta: 0.4,
  velWindow: 0.1,

  // Grabbing
  grabTol: 34,   // px slack around a glyph's box for a hand pinch
  joinTol: 110,  // px slack for a second hand joining a held word
  holdK: 900,
  holdDamp: 0.95,
  holdAngK: 520,
  rotGain: 1.0,
  minStretch: 0.3,
  maxStretch: 4.5,

  // Elastic horizontal scale spring (underdamped = wobble)
  sxK: 220,
  sxDamp: 0.22,

  // Free motion
  friction: 1.7,
  angFriction: 2.4,
  wallBounce: 0.55,
  collideBounce: 0.35,

  // Release / throw (speeds in px/s at 1440px width, scaled to the viewport)
  releaseVelMin: 120,
  throwSpeed: 900,
  throwGain: 1.0,
  maxThrow: 6500,

  // Open palm explosion
  explodeRadius: 0.38, // fraction of screen diagonal
  shockSpeed: 2600,
  blastMin: 450,
  blastMax: 2100,
  blastSpin: 14,
  chargeTime: 0.45,
  palmStill: 0.45, // ×W px/s — palm must be roughly still to charge

  // Swipe
  swipeSpeed: 1.25, // ×W px/s
  swipeCooldown: 0.55,
  swipeGain: 0.75,

  // Fist reassembly
  asmK: 26,
  asmDamp: 0.72,
  dockDist: 3,
};
