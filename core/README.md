# core

`core` contains the first version of the platform-neutral face pipeline contract.

It intentionally avoids Android `Bitmap`, camera APIs, browser APIs, and model
runtime dependencies. Android and Web adapters should convert their local frame
types into the small `ImageFrame` shape, run the current pipeline, then render
the returned overlays in their own UI layer.

Current contents:

- `FaceDetector`: finds candidate face boxes in normalized coordinates.
- `FaceSwapper`: produces a swap result for one frame.
- `FrameProcessor`: wires detector and swapper into one call.
- `ModelRunner`: a narrow placeholder for future ONNX/TFLite/MediaPipe runners.
- `CenterFaceDetector` and `OverlayFaceSwapper`: deterministic dummy
  implementations used by the Android sample.

This module is expected to change while real model experiments are added.
