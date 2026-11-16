# Foggy Mirror

An edge-to-edge live mirror covered with neutral white and gray mist. There is
no frame, illustrated room, colored tint, or surrounding page. Controls fade
away automatically.

## Use

Open the HTTPS site and press **Open mirror**, then allow camera access. Point
one index finger to write through the fog; bend it to lift between letters.
Open your hand to wipe with all fingertips. Open your mouth to quickly cover
the mirror with fresh mist; close it to resume writing. Both hands can be tracked. Mouse,
touch, and keyboard arrow drawing also work.

The lower-right dots reveal controls for the camera, fingertip tracking, stroke
width, fog return time, pausing the fog, fresh mist, clearing, and full screen.
Tab reveals controls for keyboard access; R restores mist and Space pauses it.

## Implementation

The app is static HTML, CSS, and JavaScript at the repository root, with self-hosted
TensorFlow.js 4.22.0, its WebAssembly CPU backend, and the MediaPipe Hands lite
models through hand-pose-detection 2.0.1. No graphics acceleration is required. A dedicated classic
Web Worker performs inference on locally transferred camera frames. No camera
frames, hand or face landmarks, audio, or drawings are uploaded or recorded. Camera
access begins only after an explicit button press; audio is never requested.

Physical camera frames are captured as 320-pixel-wide RGBA buffers through
`vision-client.js`, with one frame in flight and no ImageBitmap/GPU dependency.
Slow completed frames remain usable instead of being silently discarded.

Fingertip coordinates follow the exact mirrored `object-fit: cover` camera crop.
Gesture state, smoothing, stale-frame handling, and hand matching prevent
strokes from connecting across lifted fingers or lost hands. Fog returns by
adding accumulated alpha to avoid low-opacity Canvas quantization stalls.

## Local use

Serve this folder from localhost, for example:

```
python3 -m http.server 8000
```

Open `http://localhost:8000`. A secure HTTPS origin or localhost is required for
camera access. Use a current browser supporting Web Workers, Canvas 2D,
WebAssembly, and the camera API. Chrome is a suitable choice.

## Validation

JavaScript syntax, page assets and DOM references, crop-correct mirroring,
pointing/lift/open-hand gestures, two-hand matching, smoothing, stroke breaks,
Canvas wiping/refogging, and worker frame cleanup are checked. The moving-video browser check used an actual HTMLVideoElement and the same
frame-capture client as a webcam: 11 detected hand frames produced 11 strokes
with a 55-pixel span and cleared mask pixels, followed by successful face
landmark detection. Mouth opening/closing hysteresis, rapid fog restoration,
slower results, and capture/worker cleanup passed automated checks. A physical
webcam was unavailable in this environment. The full-screen layout, keyboard drawing,
fading controls, and no-camera error state were checked in the browser.

## GitHub Pages

Upload all extracted files, including `vendor/`, with `index.html` at the
repository root. In Settings → Pages, deploy the main branch from / (root).
GitHub Free requires a public repository for Pages. No build step is needed.

This update includes a new `vision-client.js` and face models. Replace all
previous repository files, including the complete `vendor` directory.
