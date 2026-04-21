# Decisions

## Repository shape

The repository starts with four top-level areas:

- `app/`: Android application shell and platform adapters.
- `core/`: minimal pipeline contracts and dummy implementations.
- `web-demo/`: static browser demo that can be published through GitHub Pages.
- `docs/`: design notes that explain current constraints and future options.

This keeps the first commit small while making the intended direction visible.
The Android app can evolve toward CameraX, GPU delegates, and model downloads
without forcing those choices into the web demo. The web demo can evolve toward
ONNX Runtime Web, WebGPU, WebGL, or MediaPipe without blocking Android work.

## Why Android and Web from the start

Android is the primary target because live camera face swap workloads are shaped
by mobile constraints: thermal limits, camera latency, memory pressure, battery
usage, model packaging, and on-device privacy.

The web demo matters for a different reason. A browser demo is the fastest way
for contributors and users to understand the pipeline, compare outputs, and test
model experiments without installing an APK. It also creates pressure to keep the
core concepts portable instead of hiding everything inside Android-only classes.

## Current MVP choice

The Android sample uses a still-image input plus a dummy face overlay. This avoids
camera permissions, CameraX lifecycle setup, and real-time performance tuning in
the first commit. The code still exercises the same pipeline shape that a live
camera path would use later: frame input, detection, swap, and render.

The web demo uses static HTML, CSS, and JavaScript. It is intentionally buildless
so GitHub Pages can serve it directly. It also includes a `getUserMedia` camera
path so a smartphone browser can exercise a MediaPipe-backed face landmarker and
pseudo swap renderer before real face swap inference is available.

## What we are not doing yet

- No real face swap model is included.
- No pretrained model files are committed.
- No Android camera preview or native live video loop is implemented yet.
- No identity embedding, face alignment, segmentation, or blending pipeline is
  implemented yet.
- No native C++ layer is added.
- No model downloader, checksum verifier, or runtime selection UI is added.
- No claim is made that the placeholder output performs identity transfer.
