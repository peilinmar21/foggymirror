# Third-party components

- TensorFlow.js **4.22.0**, TensorFlow.js WebAssembly backend **4.22.0**, and
  TensorFlow hand-pose-detection **2.0.1**, Google / TensorFlow authors,
  Apache-2.0. The license is included under `dist/vendor/`.
- MediaPipe Hands lite detector and landmark graphs and weights, as distributed
  by the TensorFlow hand-pose-detection package's official default model URLs.
  The exact source URLs are in `dist/vendor/tfjs/model-sources.json`.

Package versions and verified npm SHA-512 integrity strings are retained in
`dist/vendor/tfjs/packages.json`. All scripts, model weights, and WebAssembly
binaries are self-hosted. Runtime camera frames are processed locally only.

Primary documentation:
- https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection
- https://github.com/tensorflow/tfjs/tree/master/tfjs-backend-wasm

Mouth tracking uses TensorFlow face-detection 1.0.3 and
face-landmarks-detection 1.0.6 (Apache-2.0) with their official default
short-range face detector and non-attention Face Mesh model. Exact source URLs
and npm package integrity strings are retained with the runtime assets.
