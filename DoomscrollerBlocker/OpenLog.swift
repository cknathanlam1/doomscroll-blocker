import Foundation

/// Persists the time of each "YouTube was opened" signal.
final class OpenLog: ObservableObject {
    static let shared = OpenLog()
    private let key = "youtubeOpens"

    @Published private(set) var opens: [Date]

    private init() {
        opens = (UserDefaults.standard.array(forKey: key) as? [Date]) ?? []
    }

    func record() {
        opens.insert(Date(), at: 0)
        UserDefaults.standard.set(opens, forKey: key)
    }

    func clear() {
        opens = []
        UserDefaults.standard.removeObject(forKey: key)
    }
}
