# Web demo

This folder is a static GitHub Pages target. It does not require a build step.

Open `index.html` directly for the sample and image upload path, or enable the
included GitHub Pages workflow to publish this folder as the project demo.
Camera mode requires HTTPS, so it is meant to run from GitHub Pages or localhost.

The current demo runs a placeholder browser pipeline:

1. Load a sample frame or uploaded image.
2. Optionally open a smartphone front camera with `getUserMedia`.
3. Detect one deterministic center face box.
4. Draw a synthetic pseudo swap face on the output canvas.

Future browser inference work can replace the detector and swapper with ONNX
Runtime Web, WebGPU/WebGL, or MediaPipe-backed implementations.
