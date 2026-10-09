import AVFoundation
import Vision

/// What the camera hands to the rest of the app for each frame.
struct PoseSample {
    var frame: PoseFrame
    /// Mean luma 0…255, refreshed about twice a second (nil in between).
    var luminance: Double?
    /// Vision's time to process this frame, for the fps / latency readout.
    var detectMs: Double
}

/// Front camera → Apple Vision → `PoseFrame`s.
///
/// Port of platform/camera.ts + frameLoop.ts + poseDetector.ts. The capture
/// connection delivers upright (`videoRotationAngle = 90`) and UNMIRRORED
/// buffers, so Vision runs with `.up` and the core sees the same image the web
/// prototype saw. The preview layer is a separate connection and stays the usual
/// mirrored selfie view.
final class PoseCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()

    /// Called on the camera's serial queue for every processed frame.
    var onSample: ((PoseSample) -> Void)?

    private let queue = DispatchQueue(label: "pose.camera", qos: .userInitiated)
    private let output = AVCaptureVideoDataOutput()
    private let request = VNDetectHumanBodyPoseRequest()
    private var configured = false
    /// What the camera ended up with (format size and horizontal field of view), for the debug readout.
    private(set) var formatInfo = ""
    private var lastT = -Double.infinity
    private var lastLumaAt = -Double.infinity
    private static let lumaEveryMs = 500.0

    /// Sets up the session once. Returns false if there is no usable camera.
    private func configureIfNeeded() -> Bool {
        if configured { return true }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
              let input = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        guard session.canAddInput(input), session.canAddOutput(output) else { return false }
        session.addInput(input)
        // The widest field of view the front camera offers: from a phone on the floor the head
        // takes a big part of a narrow frame (and the face next to the lens is where Vision
        // fails). The preset is replaced by an explicit format.
        selectWidestFormat(device)
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.setSampleBufferDelegate(self, queue: queue)
        session.addOutput(output)
        if let connection = output.connection(with: .video) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            connection.automaticallyAdjustsVideoMirroring = false
            if connection.isVideoMirroringSupported { connection.isVideoMirrored = false }
            // Video stabilization crops the edges of the picture.
            connection.preferredVideoStabilizationMode = .off
        }
        configured = true
        return true
    }

    /// Picks the format with the largest horizontal FOV (ties: the smallest image, which is
    /// lighter for Vision) and turns off what crops the picture (stabilization, Center Stage).
    private func selectWidestFormat(_ device: AVCaptureDevice) {
        let candidates = device.formats.filter { format in
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return d.width >= 640 && d.height >= 480
                && format.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 30 }
        }
        func area(_ f: AVCaptureDevice.Format) -> Int {
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return Int(d.width) * Int(d.height)
        }
        guard let widest = candidates.max(by: { a, b in
            if abs(a.videoFieldOfView - b.videoFieldOfView) > 0.5 { return a.videoFieldOfView < b.videoFieldOfView }
            return area(a) > area(b)
        }) else {
            session.sessionPreset = .vga640x480
            return
        }
        session.sessionPreset = .inputPriority
        do {
            try device.lockForConfiguration()
            device.activeFormat = widest
            device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
            device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
            device.videoZoomFactor = 1
            // Center Stage re-frames (crops) the picture to follow a face; we want the full view.
            if AVCaptureDevice.isCenterStageEnabled {
                AVCaptureDevice.centerStageControlMode = .app
                AVCaptureDevice.isCenterStageEnabled = false
            }
            device.unlockForConfiguration()
        } catch {
            session.sessionPreset = .vga640x480
        }
        let d = CMVideoFormatDescriptionGetDimensions(widest.formatDescription)
        formatInfo = String(format: "%dx%d · FOV %.0f°", d.width, d.height, widest.videoFieldOfView)
    }

    /// Starts the session. `completion(false)` if the camera can't be used.
    func start(completion: @escaping (Bool) -> Void = { _ in }) {
        queue.async { [self] in
            guard configureIfNeeded() else { return DispatchQueue.main.async { completion(false) } }
            if !session.isRunning { session.startRunning() }
            DispatchQueue.main.async { completion(self.session.isRunning) }
        }
    }

    func stop() {
        queue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    // MARK: AVCaptureVideoDataOutputSampleBufferDelegate

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        // Time is milliseconds from the frame's own timestamp, strictly increasing.
        let raw = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1000
        let t = max(raw, lastT + 1)
        lastT = t

        let width = Double(CVPixelBufferGetWidth(pixelBuffer))
        let height = Double(CVPixelBufferGetHeight(pixelBuffer))
        let aspect = height > 0 ? width / height : 1

        let started = CACurrentMediaTime()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        var observation: VNHumanBodyPoseObservation?
        if (try? handler.perform([request])) != nil {
            observation = request.results?.first
        }
        let detectMs = (CACurrentMediaTime() - started) * 1000

        var luminance: Double?
        if t - lastLumaAt >= Self.lumaEveryMs {
            lastLumaAt = t
            luminance = Self.meanLuma(pixelBuffer)
        }
        let frame = VisionMapping.toPoseFrame(observation: observation, aspect: aspect, tMs: t)
        onSample?(PoseSample(frame: frame, luminance: luminance, detectMs: detectMs))
    }

    /// Mean of a coarse grid of the luma (Y) plane, 0…255.
    private static func meanLuma(_ pixelBuffer: CVPixelBuffer) -> Double? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pixelBuffer) > 0,
              let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
        let h = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        guard w > 0, h > 0 else { return nil }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        let stepX = max(1, w / 32)
        let stepY = max(1, h / 32)
        var sum = 0
        var n = 0
        var y = 0
        while y < h {
            var x = 0
            while x < w {
                sum += Int(bytes[y * stride + x])
                n += 1
                x += stepX
            }
            y += stepY
        }
        return n > 0 ? Double(sum) / Double(n) : nil
    }
}
