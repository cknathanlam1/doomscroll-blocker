import Foundation

struct OpenEvent: Codable, Hashable {
    let date: Date
    /// True when a pass was active, so the app stayed out of the way.
    let allowedByPass: Bool
}

/// Persists each "YouTube was opened" signal and the current pass.
final class OpenLog: ObservableObject {
    static let shared = OpenLog()
    /// How long a pass lasts. Settings offers 5 / 10 / 15 / 30 minutes (default 30: the wireframe
    /// says 15, a product decision still pending).
    static var passDuration: TimeInterval {
        let minutes = UserDefaults.standard.object(forKey: "passMinutes") as? Int ?? 30
        return TimeInterval(minutes * 60)
    }

    private let eventsKey = "youtubeOpenEvents"
    private let passKey = "passUntil"
    private let interceptKey = "interceptRequestedAt"

    @Published private(set) var events: [OpenEvent]
    @Published private(set) var passUntil: Date?
    /// Set by the Shortcuts action when YouTube was opened and is locked: the app shows the warning.
    @Published private(set) var interceptRequestedAt: Date?

    private init() {
        let data = UserDefaults.standard.data(forKey: eventsKey)
        events = data.flatMap { try? JSONDecoder().decode([OpenEvent].self, from: $0) } ?? []
        passUntil = UserDefaults.standard.object(forKey: passKey) as? Date
        interceptRequestedAt = UserDefaults.standard.object(forKey: interceptKey) as? Date
    }

    /// The warning is only for a request made a moment ago (a stale one is ignored).
    static let interceptFreshness: TimeInterval = 20

    func requestIntercept() {
        let now = Date()
        interceptRequestedAt = now
        UserDefaults.standard.set(now, forKey: interceptKey)
    }

    /// Returns true once for a fresh request, then forgets it.
    func consumeIntercept() -> Bool {
        defer {
            interceptRequestedAt = nil
            UserDefaults.standard.removeObject(forKey: interceptKey)
        }
        guard let at = interceptRequestedAt else { return false }
        return Date().timeIntervalSince(at) <= Self.interceptFreshness
    }

    var isPassActive: Bool {
        // Read from storage so a background intent sees the latest value.
        guard let until = UserDefaults.standard.object(forKey: passKey) as? Date else { return false }
        return until > Date()
    }

    func record(allowedByPass: Bool) {
        events.insert(OpenEvent(date: Date(), allowedByPass: allowedByPass), at: 0)
        UserDefaults.standard.set(try? JSONEncoder().encode(events), forKey: eventsKey)
    }

    func startPass() {
        let until = Date().addingTimeInterval(Self.passDuration)
        passUntil = until
        UserDefaults.standard.set(until, forKey: passKey)
    }

    func endPass() {
        passUntil = nil
        UserDefaults.standard.removeObject(forKey: passKey)
    }

    func clear() {
        events = []
        UserDefaults.standard.removeObject(forKey: eventsKey)
    }
}
