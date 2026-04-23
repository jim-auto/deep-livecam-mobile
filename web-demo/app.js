const beforeCanvas = document.querySelector("#beforeCanvas");
const afterCanvas = document.querySelector("#afterCanvas");
const beforeCtx = beforeCanvas.getContext("2d", { willReadFrequently: true });
const afterCtx = afterCanvas.getContext("2d");

const cameraVideo = document.querySelector("#cameraVideo");
const cameraButton = document.querySelector("#cameraButton");
const captureButton = document.querySelector("#captureButton");
const imageInput = document.querySelector("#imageInput");
const sourceFaceInput = document.querySelector("#sourceFaceInput");
const runButton = document.querySelector("#runButton");
const overlayStrength = document.querySelector("#overlayStrength");
const backendSelect = document.querySelector("#backendSelect");
const sourceMeta = document.querySelector("#sourceMeta");
const engineMeta = document.querySelector("#engineMeta");
const statusText = document.querySelector("#status");
const sourcePreview = document.querySelector("#sourcePreview");
const sourcePreviewCtx = sourcePreview.getContext("2d");
const sourcePreviewState = document.querySelector("#sourcePreviewState");
const sourcePreviewName = document.querySelector("#sourcePreviewName");
const resultTab = document.querySelector("#resultTab");
const sourceTab = document.querySelector("#sourceTab");
const resultPanel = document.querySelector("#resultPanel");
const sourcePanel = document.querySelector("#sourcePanel");
const MEDIAPIPE_TASKS_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const BLAZE_FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const FACE_LANDMARKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const FACE_OVAL_LANDMARKS = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const DETECTOR_SMOOTHING_ALPHA = 0.48;
const LANDMARK_SMOOTHING_ALPHA = 0.36;
const COLOR_SAMPLE_SIZE = 24;
const SOURCE_FACE_SAMPLE_REGION = {
  x: 0.22,
  y: 0.18,
  width: 0.56,
  height: 0.62,
};
const colorSampleCanvas = document.createElement("canvas");
colorSampleCanvas.width = COLOR_SAMPLE_SIZE;
colorSampleCanvas.height = COLOR_SAMPLE_SIZE;
const colorSampleCtx = colorSampleCanvas.getContext("2d", { willReadFrequently: true });
let selectedSourceFace = createSyntheticSourceFace();

class PlaceholderFaceDetector {
  detect(frame) {
    const landscape = frame.width >= frame.height;
    const width = landscape ? 0.28 : 0.42;
    const height = landscape ? 0.46 : 0.34;
    return {
      faces: [
        {
          x: (1 - width) / 2,
          y: (1 - height) / 2,
          width,
          height,
          confidence: 0.58,
        },
      ],
      engineName: "center-fallback",
      ready: true,
    };
  }
}

class MediaPipeFaceDetector {
  constructor(fallbackDetector) {
    this.fallbackDetector = fallbackDetector;
    this.videoDetector = null;
    this.imageDetector = null;
    this.loadingPromise = null;
    this.failedReason = "";
    this.lastLiveFaces = null;
    this.lastLiveEngineName = "mediapipe-face-detector";
    this.lastLiveDetectionAt = 0;
    this.minLiveIntervalMs = 95;
  }

  warmUp() {
    if (this.videoDetector || this.imageDetector || this.loadingPromise || this.failedReason) return;
    this.loadingPromise = this.load().catch((error) => {
      this.failedReason = error.message || "MediaPipe failed to load";
      return null;
    });
  }

  async detect(frame) {
    this.warmUp();

    const detector = frame.live ? this.videoDetector : this.imageDetector;
    if (!detector) {
      if (this.loadingPromise) {
        await Promise.race([this.loadingPromise, wait(0)]);
      }
      const activeDetector = frame.live ? this.videoDetector : this.imageDetector;
      if (!activeDetector) {
        const fallback = this.fallbackDetector.detect(frame);
        return {
          ...fallback,
          engineName: this.failedReason ? "center-fallback" : "mediapipe-loading",
          ready: false,
          note: this.failedReason,
        };
      }
    }

    if (frame.live) {
      const now = performance.now();
      if (this.lastLiveFaces !== null && now - this.lastLiveDetectionAt < this.minLiveIntervalMs) {
        return {
          faces: this.lastLiveFaces,
          engineName: this.lastLiveEngineName,
          ready: true,
        };
      }

      const result = this.videoDetector.detectForVideo(frame.image, now);
      const rawFaces = this.toFaceBoxes(result, frame);
      const faces = smoothFaceList(this.lastLiveFaces, rawFaces, DETECTOR_SMOOTHING_ALPHA);
      this.lastLiveFaces = faces;
      this.lastLiveEngineName = rawFaces.length ? "mediapipe-face-detector" : "mediapipe-no-face";
      this.lastLiveDetectionAt = now;
      return {
        faces: this.lastLiveFaces,
        engineName: this.lastLiveEngineName,
        ready: true,
      };
    }

    const result = this.imageDetector.detect(frame.image);
    const faces = this.toFaceBoxes(result, frame, getDrawableSize(frame.image));
    return {
      faces,
      engineName: faces.length ? "mediapipe-face-detector-image" : "mediapipe-no-face-image",
      ready: true,
    };
  }

  async load() {
    const vision = await import(MEDIAPIPE_TASKS_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    const [videoDetector, imageDetector] = await Promise.all([
      this.createDetectorWithFallback(vision, fileset, "VIDEO"),
      this.createDetectorWithFallback(vision, fileset, "IMAGE"),
    ]);
    this.videoDetector = videoDetector;
    this.imageDetector = imageDetector;
  }

  createDetectorWithFallback(vision, fileset, runningMode) {
    return this.createDetector(vision, fileset, runningMode, "GPU").catch(() => {
      return this.createDetector(vision, fileset, runningMode);
    });
  }

  createDetector(vision, fileset, runningMode, delegate) {
    const baseOptions = {
      modelAssetPath: BLAZE_FACE_MODEL_URL,
    };
    if (delegate) {
      baseOptions.delegate = delegate;
    }

    return vision.FaceDetector.createFromOptions(fileset, {
      baseOptions,
      runningMode,
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });
  }

  toFaceBoxes(result, frame, dimensions = frame) {
    const detections = result?.detections || [];
    const drawableWidth = dimensions.width || frame.width;
    const drawableHeight = dimensions.height || frame.height;
    return detections
      .map((detection) => {
        const box = detection.boundingBox;
        if (!box) return null;

        const originX = box.originX ?? box.origin_x ?? 0;
        const originY = box.originY ?? box.origin_y ?? 0;
        const width = clamp01(box.width / drawableWidth);
        const height = clamp01(box.height / drawableHeight);
        const rawX = clamp01(originX / drawableWidth);
        const x = frame.mirrored ? clamp01(1 - rawX - width) : rawX;
        const y = clamp01(originY / drawableHeight);
        const score = detection.categories?.[0]?.score ?? 0.5;
        return {
          x,
          y,
          width,
          height,
          confidence: clamp01(score),
        };
      })
      .filter(Boolean);
  }
}

class MediaPipeFaceLandmarker {
  constructor(fallbackDetector) {
    this.fallbackDetector = fallbackDetector;
    this.videoLandmarker = null;
    this.imageLandmarker = null;
    this.loadingPromise = null;
    this.failedReason = "";
    this.lastLiveFaces = null;
    this.lastLiveEngineName = "mediapipe-face-landmarker";
    this.lastLiveDetectionAt = 0;
    this.minLiveIntervalMs = 120;
  }

  warmUp() {
    if (this.videoLandmarker || this.imageLandmarker || this.loadingPromise || this.failedReason) return;
    this.loadingPromise = this.load().catch((error) => {
      this.failedReason = error.message || "Face Landmarker failed to load";
      return null;
    });
  }

  async detect(frame) {
    this.warmUp();

    const landmarker = frame.live ? this.videoLandmarker : this.imageLandmarker;
    if (!landmarker) {
      if (this.loadingPromise) {
        await Promise.race([this.loadingPromise, wait(0)]);
      }
      const activeLandmarker = frame.live ? this.videoLandmarker : this.imageLandmarker;
      if (!activeLandmarker) {
        const fallback = this.fallbackDetector.detect(frame);
        return {
          ...fallback,
          engineName: this.failedReason ? "center-fallback" : "landmarker-loading",
          ready: false,
          note: this.failedReason,
        };
      }
    }

    if (frame.live) {
      const now = performance.now();
      if (this.lastLiveFaces !== null && now - this.lastLiveDetectionAt < this.minLiveIntervalMs) {
        return {
          faces: this.lastLiveFaces,
          engineName: this.lastLiveEngineName,
          ready: true,
        };
      }

      const result = this.videoLandmarker.detectForVideo(frame.image, now);
      const rawFaces = this.toFaceBoxes(result, frame);
      const faces = smoothFaceList(this.lastLiveFaces, rawFaces, LANDMARK_SMOOTHING_ALPHA);
      this.lastLiveFaces = faces;
      this.lastLiveEngineName = rawFaces.length ? "mediapipe-face-landmarker" : "landmarker-no-face";
      this.lastLiveDetectionAt = now;
      return {
        faces: this.lastLiveFaces,
        engineName: this.lastLiveEngineName,
        ready: true,
      };
    }

    const result = this.imageLandmarker.detect(frame.image);
    const faces = this.toFaceBoxes(result, frame);
    return {
      faces,
      engineName: faces.length ? "mediapipe-face-landmarker-image" : "landmarker-no-face-image",
      ready: true,
    };
  }

  async load() {
    const vision = await import(MEDIAPIPE_TASKS_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    const [videoLandmarker, imageLandmarker] = await Promise.all([
      this.createLandmarkerWithFallback(vision, fileset, "VIDEO"),
      this.createLandmarkerWithFallback(vision, fileset, "IMAGE"),
    ]);
    this.videoLandmarker = videoLandmarker;
    this.imageLandmarker = imageLandmarker;
  }

  createLandmarkerWithFallback(vision, fileset, runningMode) {
    return this.createLandmarker(vision, fileset, runningMode, "GPU").catch(() => {
      return this.createLandmarker(vision, fileset, runningMode);
    });
  }

  createLandmarker(vision, fileset, runningMode, delegate) {
    const baseOptions = {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
    };
    if (delegate) {
      baseOptions.delegate = delegate;
    }

    return vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions,
      runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  }

  toFaceBoxes(result, frame) {
    const faces = result?.faceLandmarks || result?.face_landmarks || [];
    return faces
      .map((landmarks) => this.faceFromLandmarks(landmarks, frame))
      .filter(Boolean);
  }

  faceFromLandmarks(landmarks, frame) {
    if (!landmarks?.length) return null;

    const points = landmarks.map((landmark) => ({
      x: clamp01(frame.mirrored ? 1 - landmark.x : landmark.x),
      y: clamp01(landmark.y),
      z: landmark.z || 0,
    }));

    const bounds = points.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }),
      { minX: 1, minY: 1, maxX: 0, maxY: 0 },
    );

    const expanded = expandBounds(bounds, 0.12, 0.18);
    const leftEye = averageLandmarks(points, [33, 133, 159, 145]);
    const rightEye = averageLandmarks(points, [362, 263, 386, 374]);
    const visualLeftEye = leftEye.x <= rightEye.x ? leftEye : rightEye;
    const visualRightEye = leftEye.x <= rightEye.x ? rightEye : leftEye;
    const nose = points[1] || midpoint(leftEye, rightEye);
    const mouth = averageLandmarks(points, [13, 14, 61, 291]);
    const eyeCenter = midpoint(visualLeftEye, visualRightEye);
    const center = {
      x: eyeCenter.x * 0.48 + nose.x * 0.34 + mouth.x * 0.18,
      y: eyeCenter.y * 0.32 + nose.y * 0.42 + mouth.y * 0.26,
    };

    return {
      x: expanded.x,
      y: expanded.y,
      width: expanded.width,
      height: expanded.height,
      confidence: 0.82,
      mask: {
        points: FACE_OVAL_LANDMARKS.map((index) => points[index]).filter(Boolean),
      },
      alignment: {
        centerX: clamp01(center.x),
        centerY: clamp01(center.y),
        rotation: Math.atan2(visualRightEye.y - visualLeftEye.y, visualRightEye.x - visualLeftEye.x),
        eyeDistance: distance(visualLeftEye, visualRightEye),
      },
    };
  }
}

class CanvasOverlayFaceSwapper {
  swap(frame, detection, strength, backend) {
    const faces = detection.faces;
    return {
      frame,
      faces,
      overlays: faces.map((face, index) => ({
        face,
        label: `pseudo-swap-${index + 1}`,
        stroke: "#0f766e",
        source: selectedSourceFace,
        strength,
      })),
      engineName: `${formatEngineLabel(detection.engineName)} + pseudo-swap`,
      runtime: {
        requestedBackend: backend.key,
        requestedLabel: backend.label,
        detectionEngineName: detection.engineName,
        ready: detection.ready !== false,
        note: detection.note || "",
        frameIsLive: Boolean(frame.live),
      },
    };
  }
}

const fallbackDetector = new PlaceholderFaceDetector();
const mediaPipeDetector = new MediaPipeFaceDetector(fallbackDetector);
const faceLandmarker = new MediaPipeFaceLandmarker(fallbackDetector);

const pipeline = {
  swapper: new CanvasOverlayFaceSwapper(),
  async run(frame) {
    const backend = getSelectedBackend();
    const detection = await backend.detector.detect(frame);
    return this.swapper.swap(frame, detection, Number(overlayStrength.value) / 100, backend);
  },
};

let currentFrame = createSampleFrame();
let cameraStream = null;
let liveFrameRequest = 0;
let pipelineBusy = false;
let lastPipelineResult = null;

cameraButton.addEventListener("click", () => {
  if (cameraStream) {
    stopCamera();
  } else {
    startCamera();
  }
});

captureButton.addEventListener("click", captureCameraFrame);
resultTab.addEventListener("click", () => setActiveView("result"));
sourceTab.addEventListener("click", () => setActiveView("source"));
backendSelect.addEventListener("change", () => {
  if (backendSelect.value === "landmarker") {
    faceLandmarker.warmUp();
    setStatus("Loading MediaPipe face landmarker...");
  } else if (backendSelect.value === "mediapipe") {
    mediaPipeDetector.warmUp();
    setStatus("Loading MediaPipe face detector...");
  }
  runPipeline();
});

imageInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  stopCamera({ silent: true });

  try {
    currentFrame = await loadImageFrame(file);
    drawSource(currentFrame);
    runPipeline();
  } catch (error) {
    setStatus(`Could not load image: ${error.message}`);
  }
});

sourceFaceInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    selectedSourceFace = await createSourceFaceTexture(file);
    drawSourcePreview();
    await runPipeline();
    setStatus(`Using source face crop: ${file.name}`);
  } catch (error) {
    setStatus(`Could not load source face: ${error.message}`);
  }
});

runButton.addEventListener("click", () => runPipeline());
overlayStrength.addEventListener("input", () => runPipeline({ silent: Boolean(cameraStream) }));

drawSource(currentFrame);
drawSourcePreview();
runPipeline();
faceLandmarker.warmUp();

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is not available in this browser.");
    return;
  }

  if (!window.isSecureContext) {
    setStatus("Camera access needs HTTPS. Use GitHub Pages or localhost.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    cameraButton.textContent = "Stop camera";
    captureButton.disabled = false;
    setStatus("Camera running with pseudo swap pipeline.");
    setActiveView("result");
    startLiveLoop();
  } catch (error) {
    if (cameraStream) {
      stopCamera({ silent: true });
    }
    setStatus(`Could not open camera: ${error.message}`);
  }
}

function stopCamera(options = {}) {
  const { silent = false } = options;

  if (liveFrameRequest) {
    cancelAnimationFrame(liveFrameRequest);
    liveFrameRequest = 0;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  cameraVideo.srcObject = null;
  cameraButton.textContent = "Open camera";
  captureButton.disabled = true;

  if (!silent) {
    setStatus("Camera stopped.");
  }
}

function startLiveLoop() {
  if (liveFrameRequest) {
    cancelAnimationFrame(liveFrameRequest);
  }

  const render = () => {
    if (!cameraStream) return;

    const frame = frameFromVideo();
    if (frame) {
      currentFrame = frame;
      drawSource(frame);
      if (!pipelineBusy) {
        runPipeline({ silent: true });
      } else if (lastPipelineResult) {
        drawResult(lastPipelineResult);
      }
    }

    liveFrameRequest = requestAnimationFrame(render);
  };

  render();
}

function captureCameraFrame() {
  const frame = frameFromVideo();
  if (!frame) {
    setStatus("Camera frame is not ready yet.");
    return;
  }

  const snapshot = document.createElement("canvas");
  snapshot.width = frame.width;
  snapshot.height = frame.height;
  const snapshotCtx = snapshot.getContext("2d");
  drawFrameImage(snapshotCtx, frame);

  currentFrame = {
    image: snapshot,
    width: snapshot.width,
    height: snapshot.height,
    sourceName: "camera-capture",
  };

  stopCamera({ silent: true });
  drawSource(currentFrame);
  runPipeline();
  setStatus(`Captured ${snapshot.width}x${snapshot.height} from camera.`);
}

async function runPipeline(options = {}) {
  if (pipelineBusy) return;
  const { silent = false } = options;
  pipelineBusy = true;
  const startedAt = performance.now();

  try {
    const frame = currentFrame;
    const result = await pipeline.run(frame);
    lastPipelineResult = result;
    drawResult(result);

    const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
    engineMeta.textContent = result.engineName;
    setStatus(describeRuntimeStatus(result, elapsed, { silent }));
  } catch (error) {
    setStatus(`Pipeline failed: ${error.message}`);
  } finally {
    pipelineBusy = false;
  }
}

function drawResult(result) {
  ensureCanvasSize(afterCanvas, result.frame.width, result.frame.height);
  afterCtx.clearRect(0, 0, result.frame.width, result.frame.height);
  drawFrameImage(afterCtx, result.frame);
  renderOverlays(afterCtx, result);
}

function getSelectedBackend() {
  if (backendSelect.value === "landmarker") {
    return { key: "landmarker", label: "MediaPipe face landmarker", detector: faceLandmarker };
  }
  if (backendSelect.value === "mediapipe") {
    return { key: "mediapipe", label: "MediaPipe face detector", detector: mediaPipeDetector };
  }
  return { key: "placeholder", label: "Center fallback", detector: fallbackDetector };
}

function setActiveView(view) {
  const resultActive = view === "result";
  resultTab.classList.toggle("active", resultActive);
  sourceTab.classList.toggle("active", !resultActive);
  resultTab.setAttribute("aria-selected", String(resultActive));
  sourceTab.setAttribute("aria-selected", String(!resultActive));
  resultPanel.classList.toggle("active", resultActive);
  sourcePanel.classList.toggle("active", !resultActive);
}

function drawSource(frame) {
  ensureCanvasSize(beforeCanvas, frame.width, frame.height);
  beforeCtx.clearRect(0, 0, frame.width, frame.height);
  drawFrameImage(beforeCtx, frame);
  sourceMeta.textContent = frame.live ? `live ${frame.width}x${frame.height}` : `${frame.width}x${frame.height}`;
}

function drawSourcePreview(sourceFace = selectedSourceFace) {
  const previewSize = sourcePreview.width;
  sourcePreviewCtx.clearRect(0, 0, previewSize, previewSize);
  sourcePreviewCtx.fillStyle = "#e7edf3";
  sourcePreviewCtx.fillRect(0, 0, previewSize, previewSize);

  const scale = Math.max(previewSize / sourceFace.texture.width, previewSize / sourceFace.texture.height);
  const drawWidth = sourceFace.texture.width * scale;
  const drawHeight = sourceFace.texture.height * scale;
  const drawX = (previewSize - drawWidth) / 2;
  const drawY = (previewSize - drawHeight) / 2;
  sourcePreviewCtx.drawImage(sourceFace.texture, drawX, drawY, drawWidth, drawHeight);

  sourcePreviewState.textContent = sourceFace.kind;
  sourcePreviewName.textContent = sourceFace.name;
}

function setStatus(message) {
  if (statusText.textContent !== message) {
    statusText.textContent = message;
  }
}

function ensureCanvasSize(canvas, width, height) {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
}

function drawFrameImage(ctx, frame) {
  ctx.save();
  if (frame.mirrored) {
    ctx.translate(frame.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(frame.image, 0, 0, frame.width, frame.height);
  ctx.restore();
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function expandBounds(bounds, expandX, expandY) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const x = clamp01(bounds.minX - width * expandX);
  const y = clamp01(bounds.minY - height * expandY);
  const right = clamp01(bounds.maxX + width * expandX);
  const bottom = clamp01(bounds.maxY + height * expandY);
  return {
    x,
    y,
    width: Math.max(0.01, right - x),
    height: Math.max(0.01, bottom - y),
  };
}

function averageLandmarks(points, indexes) {
  const valid = indexes.map((index) => points[index]).filter(Boolean);
  if (!valid.length) return { x: 0.5, y: 0.5 };
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function smoothFaceList(previousFaces, nextFaces, alpha) {
  if (!nextFaces.length) return [];
  if (!previousFaces?.length) return nextFaces;

  return nextFaces.map((face, index) => {
    const previous = previousFaces[index];
    if (!previous) return face;
    return smoothFace(previous, face, alpha);
  });
}

function smoothFace(previous, next, alpha) {
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    width: lerp(previous.width, next.width, alpha),
    height: lerp(previous.height, next.height, alpha),
    confidence: next.confidence,
    alignment: smoothAlignment(previous.alignment, next.alignment, alpha),
    mask: smoothMask(previous.mask, next.mask, alpha),
  };
}

function smoothAlignment(previous, next, alpha) {
  if (!next) return undefined;
  if (!previous) return next;
  return {
    centerX: lerp(previous.centerX, next.centerX, alpha),
    centerY: lerp(previous.centerY, next.centerY, alpha),
    rotation: lerpAngle(previous.rotation, next.rotation, alpha),
    eyeDistance: lerp(previous.eyeDistance, next.eyeDistance, alpha),
  };
}

function smoothMask(previous, next, alpha) {
  if (!next?.points?.length) return undefined;
  if (!previous?.points?.length || previous.points.length !== next.points.length) return next;
  return {
    points: next.points.map((point, index) => ({
      x: lerp(previous.points[index].x, point.x, alpha),
      y: lerp(previous.points[index].y, point.y, alpha),
      z: point.z || 0,
    })),
  };
}

function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

function lerpAngle(from, to, alpha) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

function renderOverlays(ctx, result) {
  for (const overlay of result.overlays) {
    const rect = toCanvasRect(overlay.face, result.frame);
    drawPseudoSwap(ctx, overlay, rect, result.frame);

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = overlay.stroke;
    ctx.lineWidth = Math.max(3, result.frame.width / 260);
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 24);
    ctx.stroke();
    drawOverlayBadge(ctx, overlay.label, rect, result.frame);
    ctx.restore();
  }
}

function drawPseudoSwap(ctx, overlay, rect, frame) {
  const alignment = overlay.face.alignment;
  const centerX = alignment ? alignment.centerX * frame.width : rect.x + rect.width / 2;
  const centerY = alignment ? alignment.centerY * frame.height : rect.y + rect.height / 2;
  const faceWidth = alignment?.eyeDistance
    ? Math.max(rect.width * 0.82, alignment.eyeDistance * frame.width * 2.45)
    : rect.width * 0.92;
  const faceHeight = Math.max(rect.height * 0.96, faceWidth * 1.18);
  const rotation = alignment?.rotation || 0;
  const blurRadius = Math.max(10, frame.width / 96);
  const maskPoints = toCanvasMaskPoints(overlay.face.mask?.points, frame);
  const targetAverage = sampleAverageColor(frame.image, getTargetFaceSampleRegion(rect, frame));
  const colorAdjustment = createColorAdjustment(overlay.source.averageColor, targetAverage);
  const baseOpacity = 0.26 + overlay.strength * 0.74;

  ctx.save();
  ctx.globalAlpha = baseOpacity;
  ctx.shadowColor = "rgba(15, 23, 42, 0.28)";
  ctx.shadowBlur = blurRadius;
  ctx.shadowOffsetY = Math.max(2, frame.width / 320);
  applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation);
  ctx.clip();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.filter = `brightness(${colorAdjustment.brightness.toFixed(3)}) saturate(${colorAdjustment.saturation.toFixed(3)})`;
  ctx.drawImage(overlay.source.texture, -faceWidth / 2, -faceHeight / 2, faceWidth, faceHeight);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = baseOpacity * colorAdjustment.tintOpacity;
  ctx.fillStyle = toCssRgb(colorAdjustment.tintColor);
  ctx.fillRect(-faceWidth / 2, -faceHeight / 2, faceWidth, faceHeight);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = overlay.strength * (0.08 + colorAdjustment.tintOpacity * 0.4);
  ctx.fillStyle = toCssRgb(colorAdjustment.tintColor);
  applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation);
  ctx.fill();
  ctx.restore();

  drawFeatheredMaskEdge(
    ctx,
    maskPoints,
    centerX,
    centerY,
    faceWidth,
    faceHeight,
    rotation,
    frame,
    overlay.strength,
    colorAdjustment.tintColor,
  );

  ctx.save();
  ctx.globalAlpha = 0.22 + overlay.strength * 0.32;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = Math.max(2, frame.width / 320);
  applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation);
  ctx.stroke();
  ctx.restore();
}

function drawFeatheredMaskEdge(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation, frame, strength, tintColor) {
  const blur = Math.max(2, frame.width / 520);
  const wideStroke = Math.max(12, frame.width / 70);
  const narrowStroke = Math.max(4, frame.width / 210);

  ctx.save();
  ctx.globalAlpha = 0.16 + strength * 0.18;
  ctx.filter = `blur(${blur}px)`;
  ctx.strokeStyle = toCssRgba(tintColor, 0.72);
  ctx.lineWidth = wideStroke;
  applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.14 + strength * 0.12;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
  ctx.lineWidth = narrowStroke;
  applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation);
  ctx.stroke();
  ctx.restore();
}

function toCanvasMaskPoints(points, frame) {
  if (!points || points.length < 8) return null;
  return points.map((point) => ({
    x: point.x * frame.width,
    y: point.y * frame.height,
  }));
}

function applyFaceClip(ctx, maskPoints, centerX, centerY, faceWidth, faceHeight, rotation) {
  if (maskPoints?.length >= 8) {
    drawSmoothClosedPath(ctx, maskPoints);
    return;
  }

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, faceWidth / 2, faceHeight / 2, rotation, 0, Math.PI * 2);
}

function drawSmoothClosedPath(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    if (index === 0) {
      ctx.moveTo(midX, midY);
    } else {
      ctx.quadraticCurveTo(point.x, point.y, midX, midY);
    }
  });
  const first = points[0];
  const second = points[1];
  ctx.quadraticCurveTo(first.x, first.y, (first.x + second.x) / 2, (first.y + second.y) / 2);
  ctx.closePath();
}

function drawOverlayBadge(ctx, label, rect, frame) {
  const fontSize = Math.max(16, frame.width / 54);
  const paddingX = Math.max(10, frame.width / 140);
  const paddingY = Math.max(5, frame.width / 260);
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const badgeWidth = textWidth + paddingX * 2;
  const badgeHeight = fontSize + paddingY * 2;
  const x = rect.x;
  const y = Math.max(8, rect.y - badgeHeight - 8);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  roundRect(ctx, x, y, badgeWidth, badgeHeight, Math.min(12, badgeHeight / 2));
  ctx.fill();
  ctx.fillStyle = "#172033";
  ctx.fillText(label, x + paddingX, y + paddingY + fontSize * 0.78);
  ctx.restore();
}

function frameFromVideo() {
  if (cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }

  const width = cameraVideo.videoWidth;
  const height = cameraVideo.videoHeight;
  if (!width || !height) return null;

  return {
    image: cameraVideo,
    width,
    height,
    sourceName: "camera",
    mirrored: true,
    live: true,
  };
}

function loadImageFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);
      URL.revokeObjectURL(url);
      resolve({ image, width, height, sourceName: file.name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unsupported image"));
    };
    image.src = url;
  });
}

function createSampleFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#e7edf3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#c2ccd7";
  ctx.lineWidth = 2;
  for (let x = 80; x < canvas.width; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 80; y < canvas.height; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#dbe4ee";
  ctx.beginPath();
  ctx.ellipse(640, 350, 145, 190, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#718096";
  ctx.font = "34px system-ui, sans-serif";
  ctx.fillText("sample frame", 48, 666);

  return {
    image: canvas,
    width: canvas.width,
    height: canvas.height,
    sourceName: "sample",
  };
}

function createSyntheticSourceFace() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#2f3a4f";
  ctx.beginPath();
  ctx.ellipse(256, 292, 194, 250, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f1c2aa";
  ctx.beginPath();
  ctx.ellipse(256, 322, 165, 214, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c9856e";
  ctx.beginPath();
  ctx.ellipse(178, 330, 30, 42, 0, 0, Math.PI * 2);
  ctx.ellipse(334, 330, 30, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#172033";
  ctx.beginPath();
  ctx.ellipse(200, 290, 20, 13, 0, 0, Math.PI * 2);
  ctx.ellipse(312, 290, 20, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8e4b42";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(218, 420);
  ctx.quadraticCurveTo(256, 448, 294, 420);
  ctx.stroke();

  ctx.strokeStyle = "#6f3f3b";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(176, 248);
  ctx.quadraticCurveTo(202, 232, 228, 246);
  ctx.moveTo(284, 246);
  ctx.quadraticCurveTo(314, 232, 342, 250);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
  ctx.beginPath();
  ctx.ellipse(206, 284, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(318, 284, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  return createSourceFaceAsset(canvas, {
    kind: "synthetic",
    name: "Default texture",
  });
}

async function createSourceFaceTexture(file) {
  const frame = await loadImageFrame(file);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  const sourceFace = await detectBestSourceFace(frame);
  const crop = getSourceFaceCropRegion(frame, sourceFace);
  ctx.drawImage(
    frame.image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const vignette = ctx.createRadialGradient(256, 300, 80, 256, 320, 340);
  vignette.addColorStop(0, "rgba(255, 255, 255, 0)");
  vignette.addColorStop(0.72, "rgba(255, 255, 255, 0)");
  vignette.addColorStop(1, "rgba(15, 23, 42, 0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return createSourceFaceAsset(canvas, {
    kind: "selected",
    name: file.name,
  });
}

async function detectBestSourceFace(frame) {
  const primary = await faceLandmarker.detect(frame);
  const primaryFace = pickMostConfidentFace(primary.faces);
  if (primaryFace) return primaryFace;

  const secondary = await mediaPipeDetector.detect(frame);
  const secondaryFace = pickMostConfidentFace(secondary.faces);
  if (secondaryFace) return secondaryFace;

  return pickMostConfidentFace(fallbackDetector.detect(frame).faces);
}

function pickMostConfidentFace(faces = []) {
  if (!faces.length) return null;
  return [...faces].sort((left, right) => (right.confidence || 0) - (left.confidence || 0))[0];
}

function getSourceFaceCropRegion(frame, face) {
  const dimensions = getDrawableSize(frame.image);
  if (!dimensions.width || !dimensions.height || !face) {
    return {
      x: 0,
      y: 0,
      width: dimensions.width || frame.width || 1,
      height: dimensions.height || frame.height || 1,
    };
  }

  const targetAspectRatio = 512 / 640;
  const faceWidth = face.width * dimensions.width;
  const faceHeight = face.height * dimensions.height;
  const eyeDistance = face.alignment?.eyeDistance ? face.alignment.eyeDistance * dimensions.width : 0;
  let cropWidth = Math.max(faceWidth * 1.85, eyeDistance * 3.35, dimensions.width * 0.28);
  let cropHeight = Math.max(faceHeight * 2.02, dimensions.height * 0.42);

  if (cropWidth / cropHeight < targetAspectRatio) {
    cropWidth = cropHeight * targetAspectRatio;
  } else {
    cropHeight = cropWidth / targetAspectRatio;
  }

  if (cropWidth > dimensions.width) {
    cropWidth = dimensions.width;
    cropHeight = cropWidth / targetAspectRatio;
  }
  if (cropHeight > dimensions.height) {
    cropHeight = dimensions.height;
    cropWidth = cropHeight * targetAspectRatio;
  }

  const centerX = (face.alignment?.centerX ?? (face.x + face.width / 2)) * dimensions.width;
  const centerY = (face.alignment?.centerY ?? (face.y + face.height * 0.56)) * dimensions.height;
  const x = clamp(0, centerX - cropWidth / 2, Math.max(0, dimensions.width - cropWidth));
  const y = clamp(0, centerY - cropHeight * 0.42, Math.max(0, dimensions.height - cropHeight));
  return { x, y, width: cropWidth, height: cropHeight };
}

function createSourceFaceAsset(texture, options = {}) {
  return {
    texture,
    kind: options.kind || "selected",
    name: options.name || "Source image",
    averageColor: sampleAverageColor(texture, scaleNormalizedRegion(texture, SOURCE_FACE_SAMPLE_REGION)),
  };
}

function scaleNormalizedRegion(imageSource, normalizedRegion) {
  const dimensions = getDrawableSize(imageSource);
  return {
    x: dimensions.width * normalizedRegion.x,
    y: dimensions.height * normalizedRegion.y,
    width: dimensions.width * normalizedRegion.width,
    height: dimensions.height * normalizedRegion.height,
  };
}

function getTargetFaceSampleRegion(rect, frame) {
  const width = rect.width * 0.46;
  const height = rect.height * 0.52;
  const sourceX = rect.x + (rect.width - width) / 2;
  const x = frame.mirrored ? frame.width - sourceX - width : sourceX;
  const y = rect.y + rect.height * 0.22;
  return {
    x: clamp(0, x, Math.max(0, frame.width - width)),
    y: clamp(0, y, Math.max(0, frame.height - height)),
    width,
    height,
  };
}

function sampleAverageColor(imageSource, region) {
  const dimensions = getDrawableSize(imageSource);
  if (!dimensions.width || !dimensions.height) return null;

  const x = clamp(0, Math.round(region?.x ?? 0), Math.max(0, dimensions.width - 1));
  const y = clamp(0, Math.round(region?.y ?? 0), Math.max(0, dimensions.height - 1));
  const width = Math.max(1, Math.min(dimensions.width - x, Math.round(region?.width ?? dimensions.width)));
  const height = Math.max(1, Math.min(dimensions.height - y, Math.round(region?.height ?? dimensions.height)));

  colorSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  colorSampleCtx.globalAlpha = 1;
  colorSampleCtx.globalCompositeOperation = "source-over";
  colorSampleCtx.filter = "none";
  colorSampleCtx.clearRect(0, 0, COLOR_SAMPLE_SIZE, COLOR_SAMPLE_SIZE);
  colorSampleCtx.drawImage(imageSource, x, y, width, height, 0, 0, COLOR_SAMPLE_SIZE, COLOR_SAMPLE_SIZE);

  const { data } = colorSampleCtx.getImageData(0, 0, COLOR_SAMPLE_SIZE, COLOR_SAMPLE_SIZE);
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha <= 0) continue;
    red += data[index] * alpha;
    green += data[index + 1] * alpha;
    blue += data[index + 2] * alpha;
    total += alpha;
  }

  if (!total) return null;

  const average = {
    r: red / total,
    g: green / total,
    b: blue / total,
  };
  return {
    ...average,
    luma: average.r * 0.2126 + average.g * 0.7152 + average.b * 0.0722,
  };
}

function getDrawableSize(imageSource) {
  return {
    width: imageSource.videoWidth || imageSource.naturalWidth || imageSource.width || 0,
    height: imageSource.videoHeight || imageSource.naturalHeight || imageSource.height || 0,
  };
}

function createColorAdjustment(sourceAverage, targetAverage) {
  if (!sourceAverage || !targetAverage) {
    return {
      brightness: 1,
      saturation: 1,
      tintOpacity: 0.12,
      tintColor: { r: 242, g: 173, b: 152 },
    };
  }

  const brightness = clamp(0.88, targetAverage.luma / Math.max(40, sourceAverage.luma), 1.14);
  const sourceChroma = measureChroma(sourceAverage);
  const targetChroma = measureChroma(targetAverage);
  const saturation = clamp(0.9, targetChroma / Math.max(10, sourceChroma), 1.12);
  const tintColor = blendColor(sourceAverage, targetAverage, 0.68);
  const tintOpacity = clamp(0.06, colorDistance(sourceAverage, targetAverage) / 255 * 0.18, 0.2);

  return {
    brightness,
    saturation,
    tintOpacity,
    tintColor,
  };
}

function measureChroma(color) {
  return (
    Math.abs(color.r - color.luma)
    + Math.abs(color.g - color.luma)
    + Math.abs(color.b - color.luma)
  ) / 3;
}

function blendColor(sourceColor, targetColor, weight) {
  return {
    r: Math.round(lerp(sourceColor.r, targetColor.r, weight)),
    g: Math.round(lerp(sourceColor.g, targetColor.g, weight)),
    b: Math.round(lerp(sourceColor.b, targetColor.b, weight)),
  };
}

function colorDistance(first, second) {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b) / Math.sqrt(3);
}

function toCssRgb(color) {
  return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
}

function toCssRgba(color, alpha) {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

function formatEngineLabel(engineName) {
  if (
    engineName === "mediapipe-face-landmarker"
    || engineName === "mediapipe-face-landmarker-image"
    || engineName === "landmarker-no-face"
    || engineName === "landmarker-no-face-image"
    || engineName === "landmarker-loading"
  ) {
    return "MediaPipe face landmarker";
  }
  if (
    engineName === "mediapipe-face-detector"
    || engineName === "mediapipe-face-detector-image"
    || engineName === "mediapipe-no-face"
    || engineName === "mediapipe-no-face-image"
    || engineName === "mediapipe-loading"
  ) {
    return "MediaPipe face detector";
  }
  if (engineName === "center-fallback" || engineName === "center-fallback-image") {
    return "Center fallback";
  }
  return engineName.replace(/-/g, " ");
}

function describeRuntimeStatus(result, elapsed, options = {}) {
  const { silent = false } = options;
  const runtime = result.runtime;

  if (!runtime.ready && runtime.note) {
    return `${runtime.requestedLabel} failed. Using center fallback.`;
  }
  if (!runtime.ready) {
    return `Loading ${runtime.requestedLabel}... Using center fallback for now.`;
  }
  if (runtime.requestedBackend !== "placeholder" && runtime.detectionEngineName === "center-fallback-image") {
    return "Using center fallback for still images.";
  }
  if (runtime.requestedBackend !== "placeholder" && runtime.detectionEngineName === "center-fallback") {
    return "Using center fallback.";
  }
  if (!result.faces.length) {
    return "No face detected. Keep your face centered.";
  }
  if (silent && runtime.frameIsLive) {
    return `Live ${formatEngineLabel(runtime.detectionEngineName)}.`;
  }

  const faceLabel = result.faces.length === 1 ? "face candidate" : "face candidates";
  return `Detected ${result.faces.length} ${faceLabel}. Rendered in ${elapsed}ms.`;
}

function toCanvasRect(face, frame) {
  return {
    x: face.x * frame.width,
    y: face.y * frame.height,
    width: face.width * frame.width,
    height: face.height * frame.height,
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
