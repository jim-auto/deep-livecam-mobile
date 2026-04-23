# deep-livecam-mobile

Mobile-first live face swap / live cam OSS skeleton for Android, with a GitHub Pages-ready browser demo path.

## Overview

`deep-livecam-mobile` is an early repository skeleton for building a mobile-first
live face swap / live cam project. Android is the main implementation target, and
the Web demo is treated as a real future inference surface rather than a marketing
page.

This first commit does not attempt to ship a production-quality face swap model.
It establishes the directories, small pipeline contracts, placeholder Android
sample, static browser demo, and design notes needed to evolve toward real
on-device and in-browser inference.

## Why mobile-first

Live face swap on phones is constrained by camera latency, frame conversion,
thermal throttling, memory pressure, model size, and battery use. Designing from
Android first keeps those constraints visible from the beginning instead of
treating mobile as a later port.

## Why the Web demo matters

The GitHub Pages demo gives contributors a zero-install way to inspect the
pipeline shape, test UI behavior, and eventually compare browser inference
backends. The goal is for the Web demo to grow from a placeholder canvas pipeline
into a constrained but real face swap demo using technologies such as ONNX Runtime
Web, WebGPU, WebGL, or MediaPipe.

## Current status

The project is in initial skeleton state.

- Android: Kotlin app shell with still-image input, CameraX front-camera preview, lightweight face detection, and dummy face swap overlay.
- Core: platform-neutral Kotlin pipeline contracts and deterministic dummy implementations.
- Web demo: static upload, smartphone camera capture, MediaPipe face landmarks for live camera, and pseudo swap rendering.
- Models: no real model files are included.
- Inference: no real identity transfer is implemented yet.

## Directory structure

```text
app/        Android application shell
core/       Minimal shared pipeline contracts and dummy Kotlin implementations
web-demo/   Static GitHub Pages browser demo
docs/       Design notes and experiment tracking
```

## Android app

The Android app is Kotlin-based and intentionally small. It keeps the still-image
path through `ACTION_OPEN_DOCUMENT`, adds a CameraX front-camera preview, routes
live frame metadata into `DefaultFrameProcessor`, uses a lightweight Android face
detector when pixel data is available, and renders the dummy overlay
on top of both still images and the live preview. The live path also applies a
small amount of temporal smoothing and aligns CameraX analysis rotation with the
preview transform so the overlay is less jumpy.

Build prerequisites:

- JDK 17
- Android SDK with API 35 platform packages

Build commands:

- Windows: `.\gradlew.bat :core:build`
- Windows: `.\gradlew.bat :app:assembleDebug`
- macOS/Linux: `./gradlew :core:build`
- macOS/Linux: `./gradlew :app:assembleDebug`

At runtime, the app asks for camera permission before opening the live preview.

Current Android extension points:

- `FaceDetector`
- `FaceSwapper`
- `FrameProcessor`
- `ModelRunner`

Near-term Android work should improve live frame rotation/mirroring handling,
tune detector quality and overlay placement, and evaluate a real model runtime experiment.

## Web demo

The Web demo lives in `web-demo/` and uses only relative paths:

- `web-demo/index.html`
- `web-demo/styles.css`
- `web-demo/app.js`

Live demo:

- https://jim-auto.github.io/deep-livecam-mobile/

It can also be opened locally as a static file. The repository is configured to
publish `web-demo/` through GitHub Pages using GitHub Actions.

The current browser pipeline loads a sample or uploaded image, opens a phone
front camera on HTTPS hosts, lets the user choose a source face image, and uses
MediaPipe Face Landmarker for live camera face alignment, a simple face-oval mask,
edge feathering, and temporal smoothing when the browser can load the model. A
lighter MediaPipe Face Detector backend and deterministic center fallback are also
available. The output is still a pseudo swap, not real identity transfer.
Selected target/source images are processed locally in the browser and are not
uploaded by this static demo.

## Roadmap

1. Replace the dummy detector with a lightweight face detector.
2. Improve live frame rotation, mirroring, and overlay calibration.
3. Evaluate ONNX Runtime Mobile, TensorFlow Lite, and MediaPipe for Android.
4. Add model download/checksum handling outside the initial APK.
5. Improve color matching, mask quality, and temporal stability.
6. Add model-backed identity transfer experiments.
7. Add latency, memory, and thermal profiling for Android devices.
8. Define contribution guidelines once the first real inference path lands.

## Responsible use and safety note

This repository is intended for consent-based experimentation, education, and
research into mobile and browser inference.

Do not use this project to impersonate another person, use someone's likeness
without permission, mislead viewers, bypass platform rules, or create deceptive
content. Future demos and releases should keep visible safety messaging and avoid
features that encourage non-consensual or deceptive use.

## License

MIT License. See [LICENSE](./LICENSE).
