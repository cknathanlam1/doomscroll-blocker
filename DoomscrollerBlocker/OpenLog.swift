import Foundation

struct OpenEvent: Codable, Hashable {
    let date: Date
    /// True when a pass was active, so the app stayed out of the way.
    let allowedByPass: Bool
}

/// Persists each "YouTube was opened" signal and the current pass.
final class OpenLog: ObservableObject {
    static let shared = OpenLog()
    static let passDuration: TimeInterval = 30 * 60

    private let eventsKey = "youtubeOpenEvents"
    private let passKey = "passUntil"

    @Published private(set) var events: [OpenEvent]
    @Published private(set) var passUntil: Date?

    private init() {
        let data = UserDefaults.standard.data(forKey: eventsKey)
        events = data.flatMap { try? JSONDecoder().decode([OpenEvent].self, from: $0) } ?? []
        passUntil = UserDefaults.standard.object(forKey: passKey) as? Date
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
