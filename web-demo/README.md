# Web demo

This folder is a static GitHub Pages target. It does not require a build step.

Open `index.html` directly for the sample and image upload path, or enable the
included GitHub Pages workflow to publish this folder as the project demo.
Camera mode requires HTTPS, so it is meant to run from GitHub Pages or localhost.

The current demo runs a buildless browser pipeline:

1. Load a sample frame or uploaded image.
2. Optionally open a smartphone front camera with `getUserMedia`.
3. Detect live camera landmarks with MediaPipe Face Landmarker when available.
4. Use eye, nose, mouth, and face-oval landmarks to align and mask a synthetic
   pseudo swap face.
5. Smooth live landmarks over time and feather the mask edge for a less rigid
   overlay.

The `MediaPipe Face Detector` backend is kept as a lighter comparison path, and
the `Center Fallback` backend remains available for browsers that cannot load
MediaPipe Tasks Vision, its WASM files, or the model assets. Future browser
inference work can replace the pseudo swapper with ONNX Runtime Web, WebGPU/WebGL,
or a model-backed face swap implementation.

External runtime assets used by the MediaPipe backend:

- `@mediapipe/tasks-vision` from jsDelivr
- BlazeFace short-range model from Google's MediaPipe model storage
- Face Landmarker model from Google's MediaPipe model storage
