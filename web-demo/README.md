# Web demo

This folder is a static GitHub Pages target. It does not require a build step.

Open `index.html` directly for the sample and image upload path, or enable the
included GitHub Pages workflow to publish this folder as the project demo.
Camera mode requires HTTPS, so it is meant to run from GitHub Pages or localhost.

The current demo runs a buildless browser pipeline:

1. Load a sample frame or uploaded image.
2. Optionally open a smartphone front camera with `getUserMedia`.
3. Detect live camera faces with MediaPipe Face Detector when available.
4. Draw a synthetic pseudo swap face on the output canvas.

The `Center Fallback` backend remains available for browsers that cannot load
MediaPipe Tasks Vision, its WASM files, or the BlazeFace model. Future browser
inference work can replace the pseudo swapper with ONNX Runtime Web,
WebGPU/WebGL, or a model-backed face swap implementation.

External runtime assets used by the MediaPipe backend:

- `@mediapipe/tasks-vision` from jsDelivr
- BlazeFace short-range model from Google's MediaPipe model storage
