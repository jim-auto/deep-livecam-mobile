package dev.deeplivecammobile.core

class CenterFaceDetector : FaceDetector {
    override fun detect(frame: ImageFrame): FaceDetectionResult {
        val aspect = frame.width.toFloat() / frame.height.toFloat()
        val boxWidth = if (aspect >= 1f) 0.28f else 0.42f
        val boxHeight = if (aspect >= 1f) 0.46f else 0.34f
        val face = FaceBox(
            x = (1f - boxWidth) / 2f,
            y = (1f - boxHeight) / 2f,
            width = boxWidth,
            height = boxHeight,
            confidence = 0.58f,
        )
        return FaceDetectionResult(faces = listOf(face))
    }
}

class OverlayFaceSwapper(
    private val overlayColorArgb: Int = 0xCC3DA5FF.toInt(),
) : FaceSwapper {
    override fun swap(
        frame: ImageFrame,
        faces: List<FaceBox>,
        sourceFace: SourceFace?,
    ): FaceSwapResult {
        val overlays = faces.mapIndexed { index, face ->
            SwapOverlay(
                face = face,
                label = "dummy-swap-${index + 1}",
                colorArgb = overlayColorArgb,
            )
        }
        return FaceSwapResult(
            frame = frame,
            faces = faces,
            overlays = overlays,
            engineName = "dummy-overlay",
            notes = listOf(
                "No identity transfer is performed.",
                "Replace FaceDetector and FaceSwapper with real model-backed implementations.",
            ),
        )
    }
}

class DummyModelRunner : ModelRunner {
    override fun run(input: ModelInput): ModelOutput {
        return ModelOutput(
            name = input.name,
            metadata = mapOf(
                "runner" to "dummy",
                "status" to "model runtime not attached",
            ),
        )
    }
}
