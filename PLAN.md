# PLAN

This document is the handoff plan for the next contributor or GitHub Copilot.
The repository is currently an early OSS skeleton for a mobile-first live face
swap / live cam project. Android is the main target, and the GitHub Pages web
demo is the fast iteration surface.

## Current Repository State

- Repository: `jim-auto/deep-livecam-mobile`
- Default branch: `main`
- Live web demo: https://jim-auto.github.io/deep-livecam-mobile/
- License: MIT
- Latest implemented area: `web-demo/`
- Current demo type: buildless static HTML/CSS/JS served by GitHub Pages
- Current inference status: no real identity transfer yet

Recent commits:

```text
f5f0ea7 Add source face selection to web demo
77d9ceb Add smoothing and feathering to web demo
dc75bc7 Add landmark contour mask to web demo
cb89fa6 Add face landmark alignment to web demo
c451c9a Add MediaPipe face detection to web demo
49032ba Polish mobile web demo experience
87a6dbe Add pseudo swap rendering and ignore captures
dac5fdb Document GitHub Pages demo URL
68bf418 Initial mobile and web demo skeleton
```

## Directory Map

```text
app/        Android app shell
core/       Shared Kotlin pipeline contracts and dummy implementations
web-demo/   GitHub Pages browser demo
docs/       Design notes and experiment tracking
README.md   Project overview and safety note
PLAN.md     This handoff plan
```

## Important Rules

- Do not commit camera recordings or local capture artifacts.
- `.gitignore` already excludes:
  - `captures/`
  - `recordings/`
  - `camera-captures/`
  - `*.mp4`, `*.mov`, `*.m4v`, `*.webm`, `*.mkv`, `*.avi`
- Keep the web demo static and GitHub Pages-friendly unless there is a strong
  reason to add a build step.
- Keep all web demo paths relative.
- Do not add real model files to the repository yet.
- Keep responsible-use messaging visible.
- This is still a pseudo swap demo. Do not describe it as real identity transfer.
- Target/source images are processed locally in the browser. Do not add upload or
  server persistence without an explicit design decision.

## Current Web Demo Behavior

Files:

- `web-demo/index.html`
- `web-demo/styles.css`
- `web-demo/app.js`
- `web-demo/README.md`

Main controls:

- `Open camera`: opens the phone front camera with `getUserMedia`.
- `Capture`: freezes the current camera frame as the target.
- `Target image`: loads a still target frame.
- `Source face`: loads a source image and center-crops it into a pseudo swap
  texture.
- `Backend`:
  - `MediaPipe Face Landmarker`
  - `MediaPipe Face Detector`
  - `Center Fallback`
  - disabled future options for ONNX Runtime Web and WebGPU
- `Swap amount`: controls pseudo swap opacity/intensity.

Current web pipeline:

1. Draw target frame from sample, uploaded target image, capture, or live camera.
2. Load MediaPipe Tasks Vision from jsDelivr.
3. Use Face Landmarker by default for live camera frames.
4. Derive:
   - face bounds
   - eye center
   - nose point
   - mouth point
   - face-oval contour
   - rotation from eye angle
5. Smooth live detection/landmark output over time.
6. Draw the source face texture clipped to a contour mask.
7. Add feathered edge strokes so the overlay is less rigid.

External runtime assets currently used:

- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs`
- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`
- `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
- `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`

## Current Android State

Files:

- `app/src/main/kotlin/dev/deeplivecammobile/app/MainActivity.kt`
- `core/src/main/kotlin/dev/deeplivecammobile/core/Types.kt`
- `core/src/main/kotlin/dev/deeplivecammobile/core/Pipeline.kt`
- `core/src/main/kotlin/dev/deeplivecammobile/core/DummyPipeline.kt`

Current Android app:

- Kotlin-based Android app shell.
- Uses Android framework APIs only.
- Lets the user pick a still image.
- Converts the image dimensions into `ImageFrame`.
- Runs `DefaultFrameProcessor`.
- Renders dummy face overlay through a custom `View`.

Important limitation:

- Android build was not verified in the current local environment because Java,
  Gradle, and Android SDK were not installed when the skeleton was created.

## Immediate Next Work

### 1. Improve Web Color Matching

Goal:

- Make the selected source face texture match the target frame more naturally.

Suggested implementation:

- In `web-demo/app.js`, sample average color/luma from the target face region.
- Sample average color/luma from the source face texture.
- Apply a lightweight canvas filter or per-frame tint correction before drawing
  the source face.
- Keep it simple. This is still pseudo swap, not model inference.

Suggested approach:

1. Add a small helper:
   - `sampleAverageColor(ctx, region)`
   - or create a tiny offscreen canvas and read a small downscaled patch.
2. Compute target face average from `result.frame` and current mask/rect.
3. Compute source face average once when loading the source texture.
4. During `drawPseudoSwap`, apply a modest brightness/color tint:
   - avoid aggressive per-pixel processing on every live frame.
   - prefer canvas overlay with `globalCompositeOperation` or a cached adjusted
     source canvas.
5. Add a short doc note in `web-demo/README.md`.

Acceptance criteria:

- `node --check web-demo/app.js` passes.
- `git diff --check` passes.
- Demo still works with no source face selected.
- Demo still works with `Center Fallback`.
- No camera video files are created or committed.

### 2. Add Source Face Preview

Goal:

- Make it obvious which source face is active.

Suggested implementation:

- Add a small preview swatch near the controls.
- Use the selected source face texture canvas as a preview.
- Keep it compact on mobile.

Potential UI:

```text
Source: [small square preview] synthetic / selected
```

Acceptance criteria:

- The preview updates after choosing `Source face`.
- The preview does not cause layout jumps on mobile.
- The preview has stable dimensions.

### 3. Add Minimal Runtime Status

Goal:

- Make MediaPipe loading and fallback behavior clear without cluttering the UI.

Suggested implementation:

- Show a concise status message when:
  - Face Landmarker is loading.
  - Face Landmarker failed and fallback is used.
  - No face is detected.
- Avoid long explanatory text inside the app.

### 4. Android Build Hygiene

Goal:

- Make the Android skeleton buildable for other contributors.

Suggested implementation:

- Add Gradle Wrapper.
- Verify Android Gradle Plugin and Kotlin versions.
- Add GitHub Actions Android build workflow if Android SDK setup is available.
- Run `./gradlew assembleDebug` in an environment with JDK and Android SDK.

Acceptance criteria:

- `./gradlew :core:build` works.
- `./gradlew :app:assembleDebug` works.
- CI reports Android build status.

### 5. Android Camera Preview MVP

Goal:

- Match the web demo direction on Android with live camera frames.

Suggested implementation:

- Add CameraX dependencies.
- Add a camera preview screen.
- Keep the first pass as live preview + dummy overlay.
- Do not add a real model yet.
- Route frame metadata toward `FrameProcessor`.

Acceptance criteria:

- Camera permission flow works.
- Preview opens on device.
- Dummy overlay is visible.
- No heavy model or native layer is introduced.

## Larger Future Work

- Replace pseudo swap with a model-backed identity transfer pipeline.
- Compare ONNX Runtime Web and MediaPipe for browser-side inference.
- Compare ONNX Runtime Mobile, TensorFlow Lite, and MediaPipe for Android.
- Add model download and checksum management.
- Add face alignment, source embedding, mask generation, and blending stages.
- Add latency/memory/thermal profiling.
- Add contribution guidelines and a more explicit safety policy before real
  inference lands.

## Validation Commands

Useful commands from this workspace:

```powershell
node --check web-demo/app.js
git diff --check
git status --short
git check-ignore -v test.mp4 test.mov test.webm captures/sample.mp4 recordings/cam.webm camera-captures/local.mov
Get-ChildItem -Recurse -Force -File -Include *.mp4,*.mov,*.m4v,*.webm,*.mkv,*.avi | Where-Object { $_.FullName -notmatch '\\.git\\' } | Select-Object -ExpandProperty FullName
```

After pushing changes to `main`, watch Pages deployment:

```powershell
gh run list --repo jim-auto/deep-livecam-mobile --workflow pages.yml --limit 3
gh run watch <run-id> --repo jim-auto/deep-livecam-mobile --exit-status
```

Check deployed files:

```powershell
Invoke-WebRequest -Uri 'https://jim-auto.github.io/deep-livecam-mobile/index.html?cacheBust=<commit>' -UseBasicParsing
Invoke-WebRequest -Uri 'https://jim-auto.github.io/deep-livecam-mobile/app.js?cacheBust=<commit>' -UseBasicParsing
```

## Definition of Done for Small Web Demo Changes

- Keep the demo static.
- Keep relative paths.
- Keep the safety note.
- Run `node --check web-demo/app.js`.
- Run `git diff --check`.
- Confirm no video/capture artifacts exist.
- Commit with a focused message.
- Push to `main`.
- Confirm GitHub Pages workflow succeeds.
- Confirm deployed `index.html` or `app.js` contains the expected new marker.

## Definition of Done for Android Changes

- Prefer small, buildable increments.
- Keep `core` interfaces simple.
- Do not introduce interface-heavy architecture.
- Verify Gradle build in an Android-ready environment.
- Document any new model/runtime dependency.
- Do not commit large binary model files unless a policy is explicitly added.

## Safety Notes

This project must remain consent-focused.

Do not add features that encourage:

- impersonation
- non-consensual likeness use
- deceptive use
- bypassing platform rules

If real identity transfer is added later, update README, docs, UI safety notes,
and contribution policy before publishing it as a working feature.
