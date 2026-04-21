package dev.deeplivecammobile.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.deeplivecammobile.core.CenterFaceDetector
import dev.deeplivecammobile.core.DefaultFrameProcessor
import dev.deeplivecammobile.core.FaceSwapResult
import dev.deeplivecammobile.core.ImageFrame
import dev.deeplivecammobile.core.OverlayFaceSwapper
import kotlin.math.min

private const val REQUEST_PICK_IMAGE = 1001

class MainActivity : Activity() {
    private val frameProcessor = DefaultFrameProcessor(
        detector = CenterFaceDetector(),
        swapper = OverlayFaceSwapper(),
    )

    private lateinit var preview: SwapPreviewView
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        preview = SwapPreviewView(this)
        statusText = TextView(this).apply {
            text = "Dummy pipeline ready. Pick an image to run the placeholder swap overlay."
            setTextColor(Color.rgb(51, 65, 85))
            textSize = 14f
        }

        val pickButton = Button(this).apply {
            text = getString(R.string.pick_image)
            setOnClickListener { openImagePicker() }
        }

        val title = TextView(this).apply {
            text = "Deep LiveCam Mobile"
            setTextColor(Color.rgb(15, 23, 42))
            textSize = 22f
            gravity = Gravity.CENTER_VERTICAL
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            setBackgroundColor(Color.rgb(248, 250, 252))
            addView(title, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(statusText, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(
                pickButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply {
                    topMargin = 24
                    bottomMargin = 24
                },
            )
            addView(
                preview,
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

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_PICK_IMAGE || resultCode != RESULT_OK) return

        val uri = data?.data ?: return
        runCatching {
            val bitmap = decodeBitmap(uri)
            val frame = bitmap.toImageFrame()
            val result = frameProcessor.process(frame)
            preview.setResult(bitmap, result)
            statusText.text = "Processed ${bitmap.width}x${bitmap.height} with ${result.engineName}."
        }.onFailure { error ->
            statusText.text = "Could not process image: ${error.message}"
        }
    }

    private fun openImagePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        startActivityForResult(intent, REQUEST_PICK_IMAGE)
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
        preview.setResult(bitmap = null, result = frameProcessor.process(frame))
    }
}

private fun Bitmap.toImageFrame(): ImageFrame {
    return ImageFrame(width = width, height = height, timestampMillis = System.currentTimeMillis())
}

private class SwapPreviewView(context: android.content.Context) : View(context) {
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

        currentResult.overlays.forEach { overlay ->
            val rect = overlay.face.toRect(contentRect)
            fillPaint.color = Color.argb(62, Color.red(overlay.colorArgb), Color.green(overlay.colorArgb), Color.blue(overlay.colorArgb))
            boxPaint.color = overlay.colorArgb
            canvas.drawRoundRect(rect, 28f, 28f, fillPaint)
            canvas.drawRoundRect(rect, 28f, 28f, boxPaint)
            canvas.drawText(overlay.label, rect.left, (rect.top - 14f).coerceAtLeast(contentRect.top + 38f), textPaint)
        }
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

private fun dev.deeplivecammobile.core.FaceBox.toRect(parent: RectF): RectF {
    return RectF(
        parent.left + x * parent.width(),
        parent.top + y * parent.height(),
        parent.left + (x + width) * parent.width(),
        parent.top + (y + height) * parent.height(),
    )
}
