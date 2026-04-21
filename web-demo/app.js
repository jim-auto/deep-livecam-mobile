const beforeCanvas = document.querySelector("#beforeCanvas");
const afterCanvas = document.querySelector("#afterCanvas");
const beforeCtx = beforeCanvas.getContext("2d", { willReadFrequently: true });
const afterCtx = afterCanvas.getContext("2d");

const cameraVideo = document.querySelector("#cameraVideo");
const cameraButton = document.querySelector("#cameraButton");
const captureButton = document.querySelector("#captureButton");
const imageInput = document.querySelector("#imageInput");
const runButton = document.querySelector("#runButton");
const overlayStrength = document.querySelector("#overlayStrength");
const backendSelect = document.querySelector("#backendSelect");
const sourceMeta = document.querySelector("#sourceMeta");
const engineMeta = document.querySelector("#engineMeta");
const statusText = document.querySelector("#status");
const resultTab = document.querySelector("#resultTab");
const sourceTab = document.querySelector("#sourceTab");
const resultPanel = document.querySelector("#resultPanel");
const sourcePanel = document.querySelector("#sourcePanel");
const syntheticSourceFace = createSyntheticSourceFace();

const MEDIAPIPE_TASKS_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const BLAZE_FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

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
    this.detector = null;
    this.loadingPromise = null;
    this.failedReason = "";
    this.lastLiveFaces = null;
    this.lastLiveEngineName = "mediapipe-face-detector";
    this.lastLiveDetectionAt = 0;
    this.minLiveIntervalMs = 95;
    this.mode = "VIDEO";
  }

  warmUp() {
    if (this.detector || this.loadingPromise || this.failedReason) return;
    this.loadingPromise = this.load().catch((error) => {
      this.failedReason = error.message || "MediaPipe failed to load";
      return null;
    });
  }

  async detect(frame) {
    this.warmUp();

    if (!this.detector) {
      if (this.loadingPromise) {
        await Promise.race([this.loadingPromise, wait(0)]);
      }
      if (!this.detector) {
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

      const result = this.detector.detectForVideo(frame.image, now);
      const faces = this.toFaceBoxes(result, frame);
      if (faces.length) {
        this.lastLiveFaces = faces;
      } else if (!this.lastLiveFaces) {
        this.lastLiveFaces = [];
      }
      this.lastLiveEngineName = faces.length ? "mediapipe-face-detector" : "mediapipe-no-face";
      this.lastLiveDetectionAt = now;
      return {
        faces: this.lastLiveFaces,
        engineName: this.lastLiveEngineName,
        ready: true,
      };
    }

    const fallback = this.fallbackDetector.detect(frame);
    return {
      ...fallback,
      engineName: "center-fallback-image",
      ready: true,
    };
  }

  async load() {
    const vision = await import(MEDIAPIPE_TASKS_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    this.detector = await this.createDetector(vision, fileset, "GPU").catch(() => {
      return this.createDetector(vision, fileset);
    });
  }

  createDetector(vision, fileset, delegate) {
    const baseOptions = {
      modelAssetPath: BLAZE_FACE_MODEL_URL,
    };
    if (delegate) {
      baseOptions.delegate = delegate;
    }

    return vision.FaceDetector.createFromOptions(fileset, {
      baseOptions,
      runningMode: this.mode,
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });
  }

  toFaceBoxes(result, frame) {
    const detections = result?.detections || [];
    return detections
      .map((detection) => {
        const box = detection.boundingBox;
        if (!box) return null;

        const originX = box.originX ?? box.origin_x ?? 0;
        const originY = box.originY ?? box.origin_y ?? 0;
        const width = clamp01(box.width / frame.width);
        const height = clamp01(box.height / frame.height);
        const rawX = clamp01(originX / frame.width);
        const x = frame.mirrored ? clamp01(1 - rawX - width) : rawX;
        const y = clamp01(originY / frame.height);
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

class CanvasOverlayFaceSwapper {
  swap(frame, faces, strength, detectorName) {
    return {
      frame,
      faces,
      overlays: faces.map((face, index) => ({
        face,
        label: `pseudo-swap-${index + 1}`,
        stroke: "#0f766e",
        source: syntheticSourceFace,
        strength,
      })),
      engineName: `${detectorName} + pseudo-swap`,
    };
  }
}

const fallbackDetector = new PlaceholderFaceDetector();
const mediaPipeDetector = new MediaPipeFaceDetector(fallbackDetector);

const pipeline = {
  swapper: new CanvasOverlayFaceSwapper(),
  async run(frame) {
    const detector = backendSelect.value === "mediapipe" ? mediaPipeDetector : fallbackDetector;
    const detection = await detector.detect(frame);
    return this.swapper.swap(
      frame,
      detection.faces,
      Number(overlayStrength.value) / 100,
      detection.engineName,
    );
  },
};

let currentFrame = createSampleFrame();
let cameraStream = null;
let liveFrameRequest = 0;
let lastLiveStatusAt = 0;
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
  if (backendSelect.value === "mediapipe") {
    mediaPipeDetector.warmUp();
    statusText.textContent = "Loading MediaPipe face detector...";
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
    statusText.textContent = `Could not load image: ${error.message}`;
  }
});

runButton.addEventListener("click", () => runPipeline());
overlayStrength.addEventListener("input", () => runPipeline({ silent: Boolean(cameraStream) }));

drawSource(currentFrame);
runPipeline();
mediaPipeDetector.warmUp();

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    statusText.textContent = "Camera API is not available in this browser.";
    return;
  }

  if (!window.isSecureContext) {
    statusText.textContent = "Camera access needs HTTPS. Use GitHub Pages or localhost.";
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
    statusText.textContent = "Camera running with pseudo swap pipeline.";
    setActiveView("result");
    startLiveLoop();
  } catch (error) {
    if (cameraStream) {
      stopCamera({ silent: true });
    }
    statusText.textContent = `Could not open camera: ${error.message}`;
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
    statusText.textContent = "Camera stopped.";
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

      const now = performance.now();
      if (now - lastLiveStatusAt > 1000) {
        statusText.textContent = `Live ${engineMeta.textContent}: ${frame.width}x${frame.height}.`;
        lastLiveStatusAt = now;
      }
    }

    liveFrameRequest = requestAnimationFrame(render);
  };

  render();
}

function captureCameraFrame() {
  const frame = frameFromVideo();
  if (!frame) {
    statusText.textContent = "Camera frame is not ready yet.";
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
  statusText.textContent = `Captured ${snapshot.width}x${snapshot.height} from camera.`;
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

    if (!silent) {
      statusText.textContent = `Detected ${result.faces.length} face candidate. Rendered in ${elapsed}ms.`;
    }
  } catch (error) {
    statusText.textContent = `Pipeline failed: ${error.message}`;
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
  const faceWidth = rect.width * 0.92;
  const faceHeight = rect.height * 1.02;
  const faceX = rect.x + (rect.width - faceWidth) / 2;
  const faceY = rect.y - rect.height * 0.05;
  const blurRadius = Math.max(10, frame.width / 96);
  const centerX = faceX + faceWidth / 2;
  const centerY = faceY + faceHeight / 2;

  ctx.save();
  ctx.globalAlpha = 0.26 + overlay.strength * 0.74;
  ctx.shadowColor = "rgba(15, 23, 42, 0.28)";
  ctx.shadowBlur = blurRadius;
  ctx.shadowOffsetY = Math.max(2, frame.width / 320);
  ctx.beginPath();
  ctx.ellipse(
    centerX,
    centerY,
    faceWidth / 2,
    faceHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.clip();
  ctx.drawImage(overlay.source, faceX, faceY, faceWidth, faceHeight);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = overlay.strength * 0.18;
  ctx.fillStyle = "#f2ad98";
  ctx.beginPath();
  ctx.ellipse(
    centerX,
    centerY,
    faceWidth / 2,
    faceHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.22 + overlay.strength * 0.32;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = Math.max(2, frame.width / 320);
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, faceWidth / 2, faceHeight / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

  return canvas;
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
