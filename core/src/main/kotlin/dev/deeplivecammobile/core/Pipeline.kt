package dev.deeplivecammobile.core

fun interface FaceDetector {
    fun detect(frame: ImageFrame): FaceDetectionResult
}

fun interface FaceSwapper {
    fun swap(frame: ImageFrame, faces: List<FaceBox>, sourceFace: SourceFace? = null): FaceSwapResult
}

fun interface FrameProcessor {
    fun process(frame: ImageFrame, sourceFace: SourceFace? = null): FaceSwapResult
}

fun interface ModelRunner {
    fun run(input: ModelInput): ModelOutput
}

class DefaultFrameProcessor(
    private val detector: FaceDetector,
    private val swapper: FaceSwapper,
) : FrameProcessor {
    override fun process(frame: ImageFrame, sourceFace: SourceFace?): FaceSwapResult {
        val detection = detector.detect(frame)
        return swapper.swap(frame = frame, faces = detection.faces, sourceFace = sourceFace)
    }
}
