import AppIntents

/// Appears as an action in Shortcuts. An "Open App: YouTube" automation runs it.
/// While a pass is active it stays in the background so YouTube is left alone.
struct YouTubeOpenedIntent: AppIntent {
    static var title: LocalizedStringResource = "YouTube Was Opened"
    static var description = IntentDescription("Tells Doomscroller Blocker that YouTube was just opened.")
    static var supportedModes: IntentModes = [.background, .foreground(.dynamic)]

    @MainActor
    func perform() async throws -> some IntentResult {
        let log = OpenLog.shared
        if log.isPassActive {
            log.record(allowedByPass: true)
            return .result()
        }
        log.record(allowedByPass: false)
        try await continueInForeground(alwaysConfirm: false)
        return .result()
    }
}
