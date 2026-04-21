# Interfaces

The first interface set is intentionally small and expected to change.

## Core types

- `ImageFrame`: width, height, optional ARGB pixels, rotation, timestamp.
- `FaceBox`: normalized face rectangle and confidence.
- `SourceFace`: optional source identity frame and selected face.
- `FaceSwapResult`: output metadata plus overlays that UI layers can render.

Normalized face boxes are used so Android and Web can share the same conceptual
contract even though they render with different APIs.

## Current pipeline

```kotlin
fun interface FaceDetector {
    fun detect(frame: ImageFrame): FaceDetectionResult
}

fun interface FaceSwapper {
    fun swap(frame: ImageFrame, faces: List<FaceBox>, sourceFace: SourceFace?): FaceSwapResult
}

fun interface FrameProcessor {
    fun process(frame: ImageFrame, sourceFace: SourceFace?): FaceSwapResult
}

fun interface ModelRunner {
    fun run(input: ModelInput): ModelOutput
}
```

`DefaultFrameProcessor` simply calls detector then swapper. That is enough for
the first app and demo without creating a framework around model execution.

## Android responsibilities

Android owns:

- Camera or image input.
- Bitmap/YUV conversion.
- Rotation and mirroring handling.
- Model packaging and runtime initialization.
- Rendering to views, surfaces, or GPU textures.

Android should adapt frames into `ImageFrame`, call the processor, then render
the result. Real implementations may bypass ARGB copies for performance, but the
initial contract keeps the data shape readable.

## Web responsibilities

The browser demo owns:

- Image or video element input.
- Canvas/WebGL/WebGPU texture handling.
- Runtime loading for ONNX Runtime Web, MediaPipe, or custom WebGPU code.
- Browser-specific fallback behavior.

The current JavaScript mirrors the same roles with `PlaceholderFaceDetector` and
`CanvasOverlayFaceSwapper`. It is not a shared code artifact yet; it is a matching
demo contract that can be replaced incrementally.

## Avoiding premature lock-in

The interfaces should stay easy to replace. Real face swap work may require
landmarks, masks, source embeddings, temporal smoothing, and GPU buffers. Those
should be added when an experiment proves the need, not before.
