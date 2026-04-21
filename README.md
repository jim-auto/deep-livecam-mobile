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

- Android: Kotlin app shell with still-image input and dummy face swap overlay.
- Core: platform-neutral Kotlin pipeline contracts and deterministic dummy implementations.
- Web demo: static upload, smartphone camera capture, and before/after canvas pipeline with placeholder detection.
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

The Android app is Kotlin-based and intentionally small. It uses Android framework
APIs only, opens a still image through `ACTION_OPEN_DOCUMENT`, converts the image
metadata into an `ImageFrame`, runs `DefaultFrameProcessor`, and renders the
dummy overlay.

Current Android extension points:

- `FaceDetector`
- `FaceSwapper`
- `FrameProcessor`
- `ModelRunner`

Near-term Android work should add CameraX preview, frame rotation/mirroring
handling, a lightweight face detector, and a real model runtime experiment.

## Web demo

The Web demo lives in `web-demo/` and uses only relative paths:

- `web-demo/index.html`
- `web-demo/styles.css`
- `web-demo/app.js`

It can be opened locally as a static file. For GitHub Pages, enable the included
Pages workflow and publish from the repository's `main` branch. Once deployed,
the demo URL will be available from the repository's Pages settings.

The current browser pipeline loads a sample or uploaded image, creates one
deterministic center face box, and renders a dummy overlay on the output canvas.
On HTTPS hosts such as GitHub Pages, the demo can also open the phone's front
camera and run the placeholder overlay loop in the browser.

## Roadmap

1. Add CameraX preview and route live frames into the Android processor.
2. Replace the dummy detector with a lightweight face detector.
3. Evaluate ONNX Runtime Mobile, TensorFlow Lite, and MediaPipe for Android.
4. Add model download/checksum handling outside the initial APK.
5. Prototype ONNX Runtime Web or MediaPipe in `web-demo`.
6. Add face alignment, source face selection, masks, and blending.
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
