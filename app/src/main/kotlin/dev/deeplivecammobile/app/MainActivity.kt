package dev.deeplivecammobile.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.MediaStore
import android.view.Gravity
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import dev.deeplivecammobile.core.DefaultFrameProcessor
import dev.deeplivecammobile.core.FaceBox
import dev.deeplivecammobile.core.FaceSwapResult
import dev.deeplivecammobile.core.ImageFrame
import dev.deeplivecammobile.core.OverlayFaceSwapper
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

private const val LIVE_ANALYSIS_INTERVAL_MS = 140L
private const val LIVE_STATUS_INTERVAL_MS = 1_000L
private const val LIVE_DETECTION_MAX_DIMENSION = 640
private const val LIVE_FACE_SMOOTHING_ALPHA = 0.42f
private const val STILL_DETECTION_MAX_DIMENSION = 960

class MainActivity : ComponentActivity() {
    private val frameProcessor = DefaultFrameProcessor(
        detector = AndroidFaceDetector(),
        swapper = OverlayFaceSwapper(),
    )

    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private val imagePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            loadStillImage(uri)
        }
    }

    private val cameraPermissionRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startCameraPreview()
        } else {
            cameraButton.text = getString(R.string.open_camera)
            statusText.text = "Camera permission was denied."
            showStillPreview()
        }
    }

    private lateinit var stillPreview: SwapPreviewView
    private lateinit var previewView: PreviewView
    private lateinit var cameraOverlay: CameraOverlayView
    private lateinit var statusText: TextView
    private lateinit var cameraButton: Button

    private var cameraProvider: ProcessCameraProvider? = null
    private var liveCameraActive = false
    private var cameraStartPending = false
    private var lastLiveResult: FaceSwapResult? = null
    private var lastLiveAnalysisAt = 0L
    private var lastLiveStatusAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        stillPreview = SwapPreviewView(this)
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            visibility = View.GONE
            setBackgroundColor(Color.BLACK)
        }
        cameraOverlay = CameraOverlayView(this).apply {
            visibility = View.GONE
        }
        statusText = TextView(this).apply {
            text = "Lightweight face detector ready. Open the front camera or pick an image."
            setTextColor(Color.rgb(51, 65, 85))
            textSize = 14f
        }

        cameraButton = Button(this).apply {
            text = getString(R.string.open_camera)
            setOnClickListener {
                if (liveCameraActive || cameraStartPending) {
                    stopCameraPreview()
                } else {
                    ensureCameraPermissionAndStart()
                }
            }
        }

        val pickButton = Button(this).apply {
            text = getString(R.string.pick_image)
            setOnClickListener { openImagePicker() }
        }

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            setTextColor(Color.rgb(15, 23, 42))
            textSize = 22f
            gravity = Gravity.CENTER_VERTICAL
        }

        val contentFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(226, 232, 240))
            addView(
                stillPreview,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
            addView(
                previewView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
            addView(
                cameraOverlay,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }

        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(cameraButton, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(
                pickButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply {
                    topMargin = 16
                },
            )
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            setBackgroundColor(Color.rgb(248, 250, 252))
            addView(title, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(
                statusText,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply {
                    topMargin = 12
                },
            )
            addView(
                actionRow,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply {
                    topMargin = 24
                    bottomMargin = 24
                },
            )
            addView(
                contentFrame,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    0,
                    1f,
                ),
            )
        }

        setContentView(container)
        showPlaceholder()
    }

    override fun onDestroy() {
        stopCameraPreview(silent = true)
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    private fun openImagePicker() {
        stopCameraPreview(silent = true)
        imagePicker.launch(arrayOf("image/*"))
    }

    private fun ensureCameraPermissionAndStart() {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            statusText.text = "No camera is available on this device."
            return
        }

        val permissionState = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
        if (permissionState == PackageManager.PERMISSION_GRANTED) {
            startCameraPreview()
        } else {
            statusText.text = "Camera permission is required for live preview."
            cameraPermissionRequest.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCameraPreview() {
        cameraStartPending = true
        statusText.text = "Starting front camera preview..."
        cameraButton.text = getString(R.string.stop_camera)
        showCameraPreview()
        cameraOverlay.clearResult()
        lastLiveResult = null
        lastLiveAnalysisAt = 0L
        lastLiveStatusAt = 0L

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener(
            {
                if (!cameraStartPending) return@addListener

                runCatching {
                    val provider = cameraProviderFuture.get()
                    bindCameraUseCases(provider)
                }.onFailure { error ->
                    stopCameraPreview(silent = true)
                    statusText.text = "Could not start camera: ${error.message}"
                }
            },
            ContextCompat.getMainExecutor(this),
        )
    }

    private fun bindCameraUseCases(provider: ProcessCameraProvider) {
        val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
        val targetRotation = previewView.display?.rotation ?: Surface.ROTATION_0
        val preview = Preview.Builder()
            .setTargetRotation(targetRotation)
            .build()
            .also { useCase -> useCase.surfaceProvider = previewView.surfaceProvider }

        val analysis = ImageAnalysis.Builder()
            .setTargetRotation(targetRotation)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        analysis.setAnalyzer(cameraExecutor) { imageProxy ->
            try {
                val now = SystemClock.elapsedRealtime()
                val result = if (lastLiveResult != null && now - lastLiveAnalysisAt < LIVE_ANALYSIS_INTERVAL_MS) {
                    lastLiveResult!!
                } else {
                    val processed = frameProcessor.process(imageProxy.toImageFrame(LIVE_DETECTION_MAX_DIMENSION), sourceFace = null)
                    smoothLiveResult(lastLiveResult, processed).also {
                        lastLiveResult = it
                        lastLiveAnalysisAt = now
                    }
                }

                previewView.post {
                    if (!liveCameraActive) return@post

                    cameraOverlay.setResult(result, mirrored = true)

                    val statusNow = SystemClock.elapsedRealtime()
                    if (statusNow - lastLiveStatusAt >= LIVE_STATUS_INTERVAL_MS) {
                        statusText.text = describeLiveStatus(result)
                        lastLiveStatusAt = statusNow
                    }
                }
            } finally {
                imageProxy.close()
            }
        }

        provider.unbindAll()
        provider.bindToLifecycle(this, cameraSelector, preview, analysis)
        cameraProvider = provider
        cameraStartPending = false
        liveCameraActive = true
        statusText.text = "Front camera preview running. Waiting for frame metadata..."
    }

    private fun stopCameraPreview(silent: Boolean = false) {
        cameraProvider?.unbindAll()
        cameraProvider = null
        cameraStartPending = false
        liveCameraActive = false
        lastLiveResult = null
        cameraOverlay.clearResult()
        cameraButton.text = getString(R.string.open_camera)
        showStillPreview()

        if (!silent) {
            statusText.text = "Camera preview stopped."
        }
    }

    private fun loadStillImage(uri: Uri) {
        runCatching {
            val bitmap = decodeBitmap(uri)
            val result = frameProcessor.process(bitmap.toImageFrame(STILL_DETECTION_MAX_DIMENSION), sourceFace = null)
            stillPreview.setResult(bitmap, result)
            showStillPreview()
            statusText.text = buildStillStatus(bitmap, result)
        }.onFailure { error ->
            statusText.text = "Could not process image: ${error.message}"
        }
    }

    private fun decodeBitmap(uri: Uri): Bitmap {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(contentResolver, uri)
            ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Images.Media.getBitmap(contentResolver, uri)
        }
    }

    private fun showPlaceholder() {
        val frame = ImageFrame(width = 1280, height = 720)
        stillPreview.setResult(bitmap = null, result = frameProcessor.process(frame, sourceFace = null))
        showStillPreview()
    }

    private fun showStillPreview() {
        stillPreview.visibility = View.VISIBLE
        previewView.visibility = View.GONE
        cameraOverlay.visibility = View.GONE
    }

    private fun showCameraPreview() {
        stillPreview.visibility = View.GONE
        previewView.visibility = View.VISIBLE
        cameraOverlay.visibility = View.VISIBLE
    }

    private fun buildStillStatus(bitmap: Bitmap, result: FaceSwapResult): String {
        return if (result.faces.isEmpty()) {
            "Processed ${bitmap.width}x${bitmap.height}. No face detected."
        } else if (result.faces.size == 1) {
            "Processed ${bitmap.width}x${bitmap.height}. Detected 1 face candidate."
        } else {
            "Processed ${bitmap.width}x${bitmap.height}. Detected ${result.faces.size} face candidates."
        }
    }

    private fun describeLiveStatus(result: FaceSwapResult): String {
        return if (result.faces.isEmpty()) {
            "Live preview running. No face detected."
        } else if (result.faces.size == 1) {
            "Live preview running. Detected 1 face candidate."
        } else {
            "Live preview running. Detected ${result.faces.size} face candidates."
        }
    }
}

private fun Bitmap.toImageFrame(maxDimension: Int): ImageFrame {
    val (targetWidth, targetHeight) = scaledDimensions(width, height, maxDimension)
    val detectionBitmap = if (targetWidth == width && targetHeight == height) {
        this
    } else {
        Bitmap.createScaledBitmap(this, targetWidth, targetHeight, true)
    }

    val pixels = IntArray(detectionBitmap.width * detectionBitmap.height)
    detectionBitmap.getPixels(pixels, 0, detectionBitmap.width, 0, 0, detectionBitmap.width, detectionBitmap.height)

    if (detectionBitmap !== this) {
        detectionBitmap.recycle()
    }

    return ImageFrame(
        width = targetWidth,
        height = targetHeight,
        pixelsArgb = pixels,
        timestampMillis = System.currentTimeMillis(),
    )
}

private class SwapPreviewView(context: Context) : View(context) {
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        color = Color.rgb(15, 118, 110)
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(56, 20, 184, 166)
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(15, 23, 42)
        textSize = 34f
    }
    private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(148, 163, 184)
        strokeWidth = 2f
    }

    private var bitmap: Bitmap? = null
    private var result: FaceSwapResult? = null

    fun setResult(bitmap: Bitmap?, result: FaceSwapResult) {
        this.bitmap = bitmap
        this.result = result
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(226, 232, 240))

        val currentResult = result ?: return
        val contentRect = fitRect(
            sourceWidth = currentResult.frame.width,
            sourceHeight = currentResult.frame.height,
            targetWidth = width,
            targetHeight = height,
        )

        val currentBitmap = bitmap
        if (currentBitmap != null) {
            canvas.drawBitmap(currentBitmap, null, contentRect, imagePaint)
        } else {
            drawPlaceholderFrame(canvas, contentRect)
        }

        drawOverlays(
            canvas = canvas,
            result = currentResult,
            contentRect = contentRect,
            boxPaint = boxPaint,
            fillPaint = fillPaint,
            textPaint = textPaint,
            mirrored = false,
        )
    }

    private fun drawPlaceholderFrame(canvas: Canvas, rect: RectF) {
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(241, 245, 249)
            style = Paint.Style.FILL
        }
        canvas.drawRect(rect, background)
        val step = min(rect.width(), rect.height()) / 6f
        var x = rect.left + step
        while (x < rect.right) {
            canvas.drawLine(x, rect.top, x, rect.bottom, guidePaint)
            x += step
        }
        var y = rect.top + step
        while (y < rect.bottom) {
            canvas.drawLine(rect.left, y, rect.right, y, guidePaint)
            y += step
        }
        canvas.drawText("image preview", rect.left + 28f, rect.bottom - 32f, textPaint)
    }

    private fun fitRect(sourceWidth: Int, sourceHeight: Int, targetWidth: Int, targetHeight: Int): RectF {
        val sourceAspect = sourceWidth.toFloat() / sourceHeight.toFloat()
        val targetAspect = targetWidth.toFloat() / targetHeight.toFloat()
        return if (sourceAspect > targetAspect) {
            val fittedHeight = targetWidth / sourceAspect
            val top = (targetHeight - fittedHeight) / 2f
            RectF(0f, top, targetWidth.toFloat(), top + fittedHeight)
        } else {
            val fittedWidth = targetHeight * sourceAspect
            val left = (targetWidth - fittedWidth) / 2f
            RectF(left, 0f, left + fittedWidth, targetHeight.toFloat())
        }
    }
}

private class CameraOverlayView(context: Context) : View(context) {
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        color = Color.rgb(15, 118, 110)
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(48, 20, 184, 166)
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 34f
    }

    private var result: FaceSwapResult? = null
    private var mirrored = true

    fun setResult(result: FaceSwapResult, mirrored: Boolean) {
        this.result = result
        this.mirrored = mirrored
        invalidate()
    }

    fun clearResult() {
        result = null
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val currentResult = result ?: return
        val contentRect = fillRect(
            sourceWidth = currentResult.frame.width,
            sourceHeight = currentResult.frame.height,
            targetWidth = width,
            targetHeight = height,
        )

        drawOverlays(
            canvas = canvas,
            result = currentResult,
            contentRect = contentRect,
            boxPaint = boxPaint,
            fillPaint = fillPaint,
            textPaint = textPaint,
            mirrored = mirrored,
        )
    }

    private fun fillRect(sourceWidth: Int, sourceHeight: Int, targetWidth: Int, targetHeight: Int): RectF {
        val sourceAspect = sourceWidth.toFloat() / sourceHeight.toFloat()
        val targetAspect = targetWidth.toFloat() / targetHeight.toFloat()
        return if (sourceAspect > targetAspect) {
            val filledWidth = targetHeight * sourceAspect
            val left = (targetWidth - filledWidth) / 2f
            RectF(left, 0f, left + filledWidth, targetHeight.toFloat())
        } else {
            val filledHeight = targetWidth / sourceAspect
            val top = (targetHeight - filledHeight) / 2f
            RectF(0f, top, targetWidth.toFloat(), top + filledHeight)
        }
    }
}

private fun drawOverlays(
    canvas: Canvas,
    result: FaceSwapResult,
    contentRect: RectF,
    boxPaint: Paint,
    fillPaint: Paint,
    textPaint: Paint,
    mirrored: Boolean,
) {
    result.overlays.forEach { overlay ->
        val rect = overlay.face.toRect(contentRect, mirrored)
        fillPaint.color = Color.argb(62, Color.red(overlay.colorArgb), Color.green(overlay.colorArgb), Color.blue(overlay.colorArgb))
        boxPaint.color = overlay.colorArgb
        canvas.drawRoundRect(rect, 28f, 28f, fillPaint)
        canvas.drawRoundRect(rect, 28f, 28f, boxPaint)
        canvas.drawText(
            overlay.label,
            rect.left,
            (rect.top - 14f).coerceAtLeast(contentRect.top + 38f),
            textPaint,
        )
    }
}

private fun smoothLiveResult(previous: FaceSwapResult?, next: FaceSwapResult): FaceSwapResult {
    if (previous == null || previous.faces.size != next.faces.size || previous.overlays.size != next.overlays.size) {
        return next
    }

    val smoothedFaces = next.faces.mapIndexed { index, face ->
        previous.faces.getOrNull(index)?.smoothTowards(face, LIVE_FACE_SMOOTHING_ALPHA) ?: face
    }

    val smoothedOverlays = next.overlays.mapIndexed { index, overlay ->
        overlay.copy(face = smoothedFaces[index])
    }

    return next.copy(
        faces = smoothedFaces,
        overlays = smoothedOverlays,
    )
}

private fun FaceBox.smoothTowards(next: FaceBox, alpha: Float): FaceBox {
    val smoothedWidth = lerp(width, next.width, alpha).coerceIn(0.01f, 1f)
    val smoothedHeight = lerp(height, next.height, alpha).coerceIn(0.01f, 1f)
    val smoothedX = lerp(x, next.x, alpha).coerceIn(0f, 1f - smoothedWidth)
    val smoothedY = lerp(y, next.y, alpha).coerceIn(0f, 1f - smoothedHeight)

    return FaceBox(
        x = smoothedX.coerceIn(0f, 1f),
        y = smoothedY.coerceIn(0f, 1f),
        width = smoothedWidth,
        height = smoothedHeight,
        confidence = next.confidence,
    )
}

private fun lerp(from: Float, to: Float, alpha: Float): Float {
    return from + (to - from) * alpha
}

private fun FaceBox.toRect(parent: RectF, mirrored: Boolean): RectF {
    val resolvedX = if (mirrored) 1f - x - width else x
    return RectF(
        parent.left + resolvedX * parent.width(),
        parent.top + y * parent.height(),
        parent.left + (resolvedX + width) * parent.width(),
        parent.top + (y + height) * parent.height(),
    )
}

private fun ImageProxy.toImageFrame(maxDimension: Int): ImageFrame {
    val argbPixels = IntArray(width * height)
    val yPlane = planes[0].buffer
    val uPlane = planes[1].buffer
    val vPlane = planes[2].buffer
    val yRowStride = planes[0].rowStride
    val yPixelStride = planes[0].pixelStride
    val uRowStride = planes[1].rowStride
    val uPixelStride = planes[1].pixelStride
    val vRowStride = planes[2].rowStride
    val vPixelStride = planes[2].pixelStride

    for (y in 0 until height) {
        val yRow = y * yRowStride
        val uvRow = (y / 2) * uRowStride
        val vvRow = (y / 2) * vRowStride
        for (x in 0 until width) {
            val yValue = yPlane.get(yRow + x * yPixelStride).toInt() and 0xFF
            val uValue = uPlane.get(uvRow + (x / 2) * uPixelStride).toInt() and 0xFF
            val vValue = vPlane.get(vvRow + (x / 2) * vPixelStride).toInt() and 0xFF
            argbPixels[y * width + x] = yuvToArgb(yValue, uValue, vValue)
        }
    }

    val uprightPixels = rotateArgbPixels(argbPixels, width, height, imageInfo.rotationDegrees)
    val uprightWidth = if (imageInfo.rotationDegrees == 90 || imageInfo.rotationDegrees == 270) height else width
    val uprightHeight = if (imageInfo.rotationDegrees == 90 || imageInfo.rotationDegrees == 270) width else height
    val (targetWidth, targetHeight) = scaledDimensions(uprightWidth, uprightHeight, maxDimension)
    val scaledPixels = if (targetWidth == uprightWidth && targetHeight == uprightHeight) {
        uprightPixels
    } else {
        scaleArgbPixels(uprightPixels, uprightWidth, uprightHeight, targetWidth, targetHeight)
    }

    return ImageFrame(
        width = targetWidth,
        height = targetHeight,
        pixelsArgb = scaledPixels,
        timestampMillis = imageInfo.timestamp / 1_000_000L,
    )
}

private fun rotateArgbPixels(source: IntArray, width: Int, height: Int, rotationDegrees: Int): IntArray {
    return when (rotationDegrees) {
        0 -> source
        90 -> {
            val rotated = IntArray(source.size)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val newX = height - 1 - y
                    val newY = x
                    rotated[newY * height + newX] = source[y * width + x]
                }
            }
            rotated
        }
        180 -> {
            val rotated = IntArray(source.size)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val newX = width - 1 - x
                    val newY = height - 1 - y
                    rotated[newY * width + newX] = source[y * width + x]
                }
            }
            rotated
        }
        270 -> {
            val rotated = IntArray(source.size)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val newX = y
                    val newY = width - 1 - x
                    rotated[newY * height + newX] = source[y * width + x]
                }
            }
            rotated
        }
        else -> source
    }
}

private fun scaleArgbPixels(source: IntArray, sourceWidth: Int, sourceHeight: Int, targetWidth: Int, targetHeight: Int): IntArray {
    val scaled = IntArray(targetWidth * targetHeight)
    for (y in 0 until targetHeight) {
        val sourceY = (y.toFloat() * sourceHeight / targetHeight).toInt().coerceIn(0, sourceHeight - 1)
        for (x in 0 until targetWidth) {
            val sourceX = (x.toFloat() * sourceWidth / targetWidth).toInt().coerceIn(0, sourceWidth - 1)
            scaled[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX]
        }
    }
    return scaled
}

internal fun scaledDimensions(width: Int, height: Int, maxDimension: Int): Pair<Int, Int> {
    val longestEdge = max(width, height)
    if (longestEdge <= maxDimension) return width to height

    val scale = maxDimension.toFloat() / longestEdge.toFloat()
    val scaledWidth = max(2, (width * scale).toInt())
    val scaledHeight = max(2, (height * scale).toInt())
    return scaledWidth to scaledHeight
}

private fun yuvToArgb(y: Int, u: Int, v: Int): Int {
    val yAdjusted = max(0, y - 16)
    val uAdjusted = u - 128
    val vAdjusted = v - 128
    val red = ((298 * yAdjusted + 409 * vAdjusted + 128) shr 8).coerceIn(0, 255)
    val green = ((298 * yAdjusted - 100 * uAdjusted - 208 * vAdjusted + 128) shr 8).coerceIn(0, 255)
    val blue = ((298 * yAdjusted + 516 * uAdjusted + 128) shr 8).coerceIn(0, 255)
    return Color.argb(255, red, green, blue)
}
