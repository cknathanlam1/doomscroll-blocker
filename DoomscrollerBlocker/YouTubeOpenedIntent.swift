import AppIntents

/// Appears as an action in Shortcuts. An "Open App: YouTube" automation runs it.
struct YouTubeOpenedIntent: AppIntent {
    static var title: LocalizedStringResource = "YouTube Was Opened"
    static var description = IntentDescription("Tells Doomscroller Blocker that YouTube was just opened.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        OpenLog.shared.record()
        return .result()
    }
}
