# The Invisible Typography Machine

An experimental typography playground. Words and letters float on a pale grid and behave like physical objects. Using your webcam, you grab them with a pinch, drag, throw, stretch and rotate them, blow them apart with an open palm and pull them home with a fist.

Everything runs in the browser. Camera frames go straight into MediaPipe Hand Landmarker inside the page. Nothing is recorded, stored or uploaded.

## Run it

The webcam API only works on `localhost` or `https`, so serve the folder with any static server. Opening `index.html` directly from disk will not work.

```bash
cd invisible-typography-machine

# Option A: Python (preinstalled on macOS / most Linux)
python3 -m http.server 8080

# Option B: Node
npx serve -l 8080 .
```

Then open **http://localhost:8080** in Chrome, Edge or Safari 17+ (desktop), click **Enter the playground** and allow camera access.

No build step and no install. Three.js, MediaPipe Tasks Vision (WASM) and the hand model are vendored in `vendor/` and `models/`, so it works offline. The only network request is Google Fonts, and the type falls back to system fonts without it.

### Tips for reliable tracking

- Sit about an arm's length from the camera with your hands and wrists in frame.
- Light your hands from the front; avoid a bright window behind you.
- The dashed box in the camera thumbnail (bottom right) is your reach area. It maps to the whole screen, so you don't need to stretch to the camera's edges.

## Gestures

| Gesture | How | What happens |
|---|---|---|
| Pinch | Touch thumb and index tip over a word or letter | Grabs it; the red cursor dot confirms |
| Drag | Move while pinching | The object follows with a little mass and lag |
| Release | Open the pinch | It keeps your hand's momentum, then slows by friction |
| Throw | Release during a fast movement | Flies in that direction, bounces off walls and other words |
| Two-hand stretch | Pinch one word with both hands | Distance between hands stretches or compresses it horizontally; tilting the line between your hands rotates it. The stretch is elastic and wobbles on release |
| Rotate | Turn your wrist while pinching | The word rotates with your hand |
| Open palm | Spread all fingers and hold still ~½ s (a red ring fills) | Shockwave scatters nearby words into individual letters |
| Fist | Close your hand and hold | Everything is pulled magnetically back home; letters dock and re-form their words |
| Swipe | Sweep an open hand fast sideways | Pushes the row of text in that direction |

Each scattered letter can be grabbed, thrown and stretched on its own.

### Controls

- **Guide** (or `H`) toggles the gesture legend.
- **Camera** (or `C`) turns the webcam and tracking on and off.
- **Reset** (or `R`) animates everything back to its starting composition.
- Tracking indicator: hollow = camera off, blinking = loading or no hands seen, solid red = tracking (shows the hand count).

### Mouse and touch fallback

Without a camera you can still play: drag to grab and throw, mouse wheel rotates a held word, Shift+wheel stretches it, `Space` scatters at the cursor, hold `F` to reassemble. `D` shows live hand metrics for tuning.

## How it works

```
index.html          markup, opening screen, HUD
style.css           visual design
js/main.js          bootstrap, render loop, UI, mouse fallback
js/tracking.js      webcam + MediaPipe Hand Landmarker (VIDEO mode, 2 hands, GPU with CPU fallback)
js/hands.js         per-hand features: smoothing, pinch/fist/open detection, velocity
js/interaction.js   grab / release / throw / two-hand stretch / palm / fist / swipe logic
js/world.js         type layout, glyph textures, 2D rigid-body physics, Three.js sync
js/overlay.js       background grid and the live overlay (cursors, brackets, shockwaves)
js/filters.js       One Euro filter and least-squares velocity estimator
js/config.js        every threshold and physics constant
```

- **Rendering:** each glyph is drawn once to a canvas texture and placed on a quad in an orthographic Three.js scene. A word is a group of its letters, so it can move as one rigid body or break apart into independent letter bodies.
- **Smoothing:** the cursor (midpoint of thumb and index tips), palm centre and hand angle go through One Euro filters, which remove jitter when still without adding lag when moving fast.
- **Pinch detection:** thumb–index distance divided by palm length, measured on MediaPipe's 3D *world* landmarks, so it doesn't change with distance from the camera. Hysteresis (on at 0.30, off at 0.46) plus a two-frame debounce stops flicker; a pinch survives brief tracking dropouts (220 ms).
- **Fist / open palm:** based on how far each fingertip is from its own knuckle and from the wrist, again in 3D. A fist never starts a pinch, and a held object is never dropped by curling your other fingers.
- **Throwing:** velocity is a least-squares fit over the last 100 ms of hand positions in px/s. On release, the peak velocity from the last 140 ms is used, because hands naturally brake while opening.
- **Physics:** fixed 120 Hz step. Held objects follow the hand through a critically damped spring scaled by their mass. Free objects have exponential friction, wall bounces and oriented-box (SAT) collisions with restitution. Horizontal scale is an underdamped spring, which gives the elastic stretch. Explosions travel outward as a shockwave; reassembly uses staggered, slightly swirling springs before each letter docks.

## Tuning

All thresholds live in `js/config.js`. You can also change them live from the browser console, e.g.:

```js
ITM.cfg.pinchOn = 0.35      // easier pinch
ITM.cfg.pinchOff = 0.5
ITM.cfg.friction = 1.2      // things glide further
ITM.cfg.swipeSpeed = 1.0    // easier swipe
```

Press `D` to show live pinch, curl and fold values next to each hand while you test.

## Credits

Three.js r160 (MIT) · MediaPipe Tasks Vision 0.10.21 and Hand Landmarker model (Apache 2.0) · Instrument Serif, Inter Tight and JetBrains Mono via Google Fonts (OFL).
