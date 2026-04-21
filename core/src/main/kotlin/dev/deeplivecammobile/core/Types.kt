package dev.deeplivecammobile.core

data class ImageFrame(
    val width: Int,
    val height: Int,
    val pixelsArgb: IntArray? = null,
    val rotationDegrees: Int = 0,
    val timestampMillis: Long = 0L,
) {
    init {
        require(width > 0) { "width must be positive" }
        require(height > 0) { "height must be positive" }
        require(rotationDegrees in setOf(0, 90, 180, 270)) {
            "rotationDegrees must be 0, 90, 180, or 270"
        }
        require(pixelsArgb == null || pixelsArgb.size == width * height) {
            "pixelsArgb must contain width * height pixels"
        }
    }
}

data class FaceBox(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val confidence: Float,
) {
    init {
        require(x in 0f..1f) { "x must be normalized" }
        require(y in 0f..1f) { "y must be normalized" }
        require(width in 0f..1f) { "width must be normalized" }
        require(height in 0f..1f) { "height must be normalized" }
        require(x + width <= 1f) { "x + width must fit in normalized coordinates" }
        require(y + height <= 1f) { "y + height must fit in normalized coordinates" }
        require(confidence in 0f..1f) { "confidence must be normalized" }
    }
}

data class FaceDetectionResult(
    val faces: List<FaceBox>,
)

data class SourceFace(
    val frame: ImageFrame,
    val face: FaceBox? = null,
)

data class SwapOverlay(
    val face: FaceBox,
    val label: String,
    val colorArgb: Int,
)

data class FaceSwapResult(
    val frame: ImageFrame,
    val faces: List<FaceBox>,
    val overlays: List<SwapOverlay>,
    val engineName: String,
    val notes: List<String> = emptyList(),
)

data class ModelInput(
    val name: String,
    val bytes: ByteArray = ByteArray(0),
    val metadata: Map<String, String> = emptyMap(),
)

data class ModelOutput(
    val name: String,
    val values: FloatArray = FloatArray(0),
    val metadata: Map<String, String> = emptyMap(),
)
