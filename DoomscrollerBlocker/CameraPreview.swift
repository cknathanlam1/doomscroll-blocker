import SwiftUI
import AVFoundation

/// Live front-camera feed. No counting yet.
struct CameraPreview: UIViewRepresentable {
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        let session = AVCaptureSession()
        session.sessionPreset = .high
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
        }
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.session = session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.session?.stopRunning()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var session: AVCaptureSession?
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Asks for camera permission, then shows the feed.
struct CameraScreen: View {
    @State private var status = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        Group {
            switch status {
            case .authorized:
                CameraPreview().ignoresSafeArea()
            case .notDetermined:
                ProgressView().task {
                    _ = await AVCaptureDevice.requestAccess(for: .video)
                    status = AVCaptureDevice.authorizationStatus(for: .video)
                }
            default:
                Text("Camera access is off. Turn it on in Settings → Doomscroller Blocker.")
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .navigationTitle("Camera")
        .navigationBarTitleDisplayMode(.inline)
    }
}
