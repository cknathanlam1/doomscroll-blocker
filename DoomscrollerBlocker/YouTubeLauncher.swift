import UIKit

/// Opens the YouTube app after a pass is earned.
///
/// A custom-scheme link (`youtube://`) makes iOS ask "Open in YouTube?" every time. A universal
/// link opens the app straight away, so try that first (`universalLinksOnly`: it only succeeds if
/// an app handles it, i.e. YouTube is installed) and fall back to `youtube://` if it doesn't.
enum YouTubeLauncher {
    @MainActor
    static func open() {
        let universal = URL(string: "https://www.youtube.com/")!
        UIApplication.shared.open(universal, options: [.universalLinksOnly: true]) { opened in
            guard !opened else { return }
            Task { @MainActor in
                UIApplication.shared.open(URL(string: "youtube://")!)
            }
        }
    }
}
