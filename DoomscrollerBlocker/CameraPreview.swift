import SwiftUI
import AVFoundation

/// Live front-camera feed (the usual mirrored selfie view) for a session owned by `PoseCamera`.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Maps core coordinates (unmirrored image, y down, both axes in image-HEIGHT units) onto a
/// view that shows the camera with `.resizeAspectFill` and the selfie mirror (UI_SPEC §3.2).
struct OverlayFit {
    let size: CGSize
    let aspect: Double

    private var scale: Double { max(Double(size.width) / aspect, Double(size.height)) }
    private var offsetX: Double { (Double(size.width) - aspect * scale) / 2 }
    private var offsetY: Double { (Double(size.height) - scale) / 2 }

    func point(x: Double, y: Double) -> CGPoint {
        let sx = offsetX + x * scale
        let sy = offsetY + y * scale
        // The preview is mirrored like a selfie; the overlay must be too (text never is).
        return CGPoint(x: Double(size.width) - sx, y: sy)
    }

    /// Image-height units → points, for line widths and radii.
    func length(_ u: Double) -> CGFloat { CGFloat(u * scale) }
}
