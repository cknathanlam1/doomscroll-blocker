import SwiftUI

struct ContentView: View {
    @Environment(\.openURL) private var openURL
    @StateObject private var log = OpenLog.shared

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let until = log.passUntil, until > Date() {
                        Text("Pass active until \(until.formatted(date: .omitted, time: .shortened))")
                        Button("End pass", role: .destructive, action: log.endPass)
                    } else {
                        Text("No pass active.")
                            .foregroundStyle(.secondary)
                    }
                }
                Section("YouTube opens") {
                    if log.events.isEmpty {
                        Text("None detected yet.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(log.events, id: \.self) { event in
                        Text("\(event.date.formatted(date: .omitted, time: .standard))\(event.allowedByPass ? " (allowed by pass)" : "")")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    log.startPass()
                    openURL(URL(string: "youtube://")!)
                } label: {
                    Text("Open YouTube (30 min pass)")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding()
            }
            .navigationTitle("Doomscroller Blocker")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink("Pose debug") { PoseDebugScreen() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear", action: log.clear)
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
