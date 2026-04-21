# Experiments

This project should compare implementation paths before committing to a heavy
runtime stack.

| Option | Why test it | Main risk |
| --- | --- | --- |
| Kotlin only | Small Android surface, simple debugging, easier onboarding. | Too slow for real-time model pre/post-processing. |
| Kotlin + C++ | Better access to native image processing and model runtimes. | Higher maintenance cost and more build complexity. |
| ONNX Runtime Mobile | Good fit for model portability and possible shared model formats. | APK size, delegate support, and device coverage need testing. |
| TensorFlow Lite | Mature Android mobile inference path. | Model conversion may constrain future web sharing. |
| MediaPipe | Strong face detection, landmarks, and graph concepts. | Custom face swap graph may become complex. |
| ONNX Runtime Web | Promising route for a real browser demo. | Browser support, model size, and performance vary widely. |
| WebGPU backend | Best long-term web acceleration target. | Availability and fallback path are still important. |
| WebGL backend | Wider browser reach than WebGPU today. | Shader limitations and performance debugging cost. |
| CameraX preview | Natural Android live camera foundation. | Lifecycle, permissions, rotation, and device quirks. |
| Static image pipeline | Fastest way to validate model contracts and UI. | Does not prove live latency or thermal behavior. |

## Near-term experiment order

1. Replace the dummy detector with a lightweight face detector.
2. Add CameraX preview and route frames into `FrameProcessor`.
3. Test ONNX Runtime Mobile with one small detector or landmark model.
4. Compare the current MediaPipe web detector with ONNX Runtime Web.
5. Measure frame latency, memory, APK size, model load time, and browser startup
   time before choosing the default runtime.

## Current web experiment

`web-demo` now loads MediaPipe Tasks Vision from a CDN and uses the BlazeFace
short-range model for live camera face boxes. The demo keeps a deterministic
center fallback so GitHub Pages still works when the model, WASM files, or CDN
are unavailable.
