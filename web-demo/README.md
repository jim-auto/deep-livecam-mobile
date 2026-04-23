# Web demo

This folder is a static GitHub Pages target. It does not require a build step.

Open `index.html` directly for the sample and image upload path, or enable the
included GitHub Pages workflow to publish this folder as the project demo.
Camera mode requires HTTPS, so it is meant to run from GitHub Pages or localhost.

The current demo runs a buildless browser pipeline:

1. Load a sample frame, uploaded target image, or smartphone front camera.
2. Optionally choose a source face image; the demo will auto-focus that upload around
   the most likely face before using it as the pseudo swap texture.
3. Detect live camera landmarks with MediaPipe Face Landmarker when available.
4. Use eye, nose, mouth, and face-oval landmarks to align and mask the pseudo
   swap face.
5. Smooth live landmarks over time, color-match the pseudo source texture with a
   lightweight average-color tint, and feather the mask edge for a less rigid
   overlay.

When landmark masks are not available, the demo still draws the pseudo swap with
a rotated ellipse fallback so `Center Fallback` and still-image fallback paths
remain visibly active.

Uploaded source images also fall back to a centered portrait crop when MediaPipe
cannot isolate a face, so the live overlay still stays face-sized instead of
using the entire source frame.

The controls also show a compact active source preview, and the runtime status
calls out MediaPipe loading, fallback mode, and no-face detection without
adding a larger diagnostics panel.

Target and source images are processed locally in the browser. This static demo
does not upload them or save camera frames.

The `MediaPipe Face Detector` backend is kept as a lighter comparison path, and
the `Center Fallback` backend remains available for browsers that cannot load
MediaPipe Tasks Vision, its WASM files, or the model assets. Future browser
inference work can replace the pseudo swapper with ONNX Runtime Web, WebGPU/WebGL,
or a model-backed face swap implementation.

External runtime assets used by the MediaPipe backend:

- `@mediapipe/tasks-vision` from jsDelivr
- BlazeFace short-range model from Google's MediaPipe model storage
- Face Landmarker model from Google's MediaPipe model storage
