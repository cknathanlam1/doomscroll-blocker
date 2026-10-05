import SwiftUI

struct ContentView: View {
    @StateObject private var log = OpenLog.shared

    var body: some View {
        NavigationStack {
            List {
                if log.opens.isEmpty {
                    Text("No YouTube opens detected yet.")
                        .foregroundStyle(.secondary)
                }
                ForEach(log.opens, id: \.self) { date in
                    Text("YouTube opened at \(date.formatted(date: .omitted, time: .standard))")
                }
            }
            .navigationTitle("Doomscroller Blocker")
            .toolbar {
                Button("Clear", action: log.clear)
            }
        }
    }
}

#Preview {
    ContentView()
}
