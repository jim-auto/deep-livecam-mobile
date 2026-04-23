package dev.deeplivecammobile.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Rect
import android.media.FaceDetector as AndroidMediaFaceDetector
import dev.deeplivecammobile.core.CenterFaceDetector
import dev.deeplivecammobile.core.FaceBox
import dev.deeplivecammobile.core.FaceDetectionResult
import dev.deeplivecammobile.core.FaceDetector as PipelineFaceDetector
import dev.deeplivecammobile.core.ImageFrame

private const val MAX_DETECTED_FACES = 3
private const val DETECTOR_MAX_DIMENSION = 720
private const val FACE_BOX_HALF_WIDTH_EYE_SCALE = 1.18f
private const val FACE_BOX_TOP_EYE_SCALE = 1.42f
private const val FACE_BOX_BOTTOM_EYE_SCALE = 1.78f

class AndroidFaceDetector(
    private val fallbackDetector: PipelineFaceDetector = CenterFaceDetector(),
) : PipelineFaceDetector {
    override fun detect(frame: ImageFrame): FaceDetectionResult {
        if (frame.pixelsArgb == null) {
            return fallbackDetector.detect(frame)
        }

        return runCatching {
            val detectionBitmap = frame.toDetectionBitmap()
            try {
                val detections = arrayOfNulls<AndroidMediaFaceDetector.Face>(MAX_DETECTED_FACES)
                val detector = AndroidMediaFaceDetector(detectionBitmap.width, detectionBitmap.height, MAX_DETECTED_FACES)
                val foundFaces = detector.findFaces(detectionBitmap, detections)
                val faces = detections
                    .take(foundFaces)
                    .mapNotNull { face -> face?.toFaceBox(detectionBitmap.width.toFloat(), detectionBitmap.height.toFloat()) }
                    .sortedByDescending { face -> face.confidence }

                FaceDetectionResult(faces = faces)
            } finally {
                detectionBitmap.recycle()
            }
        }.getOrElse {
            fallbackDetector.detect(frame)
        }
    }
}

private fun ImageFrame.toDetectionBitmap(): Bitmap {
    val sourceBitmap = Bitmap.createBitmap(pixelsArgb!!, width, height, Bitmap.Config.ARGB_8888)
    val (targetWidth, targetHeight) = scaledDimensions(width, height, DETECTOR_MAX_DIMENSION)
    val scaledBitmap = if (targetWidth == width && targetHeight == height) {
        sourceBitmap
    } else {
        Bitmap.createScaledBitmap(sourceBitmap, targetWidth, targetHeight, true).also {
            sourceBitmap.recycle()
        }
    }

    val evenWidth = if (scaledBitmap.width % 2 == 0) scaledBitmap.width else (scaledBitmap.width - 1).coerceAtLeast(2)
    val detectorBitmap = Bitmap.createBitmap(evenWidth, scaledBitmap.height, Bitmap.Config.RGB_565)
    Canvas(detectorBitmap).drawBitmap(
        scaledBitmap,
        Rect(0, 0, evenWidth, scaledBitmap.height),
        Rect(0, 0, evenWidth, scaledBitmap.height),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
    )
    scaledBitmap.recycle()
    return detectorBitmap
}

private fun AndroidMediaFaceDetector.Face.toFaceBox(frameWidth: Float, frameHeight: Float): FaceBox? {
    val midpoint = PointF()
    getMidPoint(midpoint)
    val eyeDistance = eyesDistance()
    if (eyeDistance <= 0f) return null

    val left = (midpoint.x - eyeDistance * FACE_BOX_HALF_WIDTH_EYE_SCALE).coerceIn(0f, frameWidth - 1f)
    val top = (midpoint.y - eyeDistance * FACE_BOX_TOP_EYE_SCALE).coerceIn(0f, frameHeight - 1f)
    val right = (midpoint.x + eyeDistance * FACE_BOX_HALF_WIDTH_EYE_SCALE).coerceIn(left + 1f, frameWidth)
    val bottom = (midpoint.y + eyeDistance * FACE_BOX_BOTTOM_EYE_SCALE).coerceIn(top + 1f, frameHeight)

    return FaceBox(
        x = left / frameWidth,
        y = top / frameHeight,
        width = (right - left) / frameWidth,
        height = (bottom - top) / frameHeight,
        confidence = confidence().coerceIn(0f, 1f),
    )
}
