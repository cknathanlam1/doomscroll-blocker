import SwiftUI

struct ContentView: View {
    @Environment(\.openURL) private var openURL
    @StateObject private var log = OpenLog.shared
    @StateObject private var challenge = ChallengeSession()
    @State private var showChallenge = ProcessInfo.processInfo.arguments.contains("-autoDemo")

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
                VStack(spacing: 8) {
                    Button {
                        challenge.start(.camera)
                        showChallenge = true
                    } label: {
                        Text("Do the push-ups")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    #if DEBUG
                    HStack {
                        Button("Watch a demo") {
                            challenge.start(.demo)
                            showChallenge = true
                        }
                        Spacer()
                        Button("Open YouTube (no push-ups)") {
                            log.startPass()
                            YouTubeLauncher.open()
                        }
                    }
                    .font(.footnote)
                    #endif
                }
                .padding()
            }
            .fullScreenCover(isPresented: $showChallenge) {
                ChallengeFlowView(
                    session: challenge,
                    onUnlock: {
                        showChallenge = false
                        log.startPass()
                        YouTubeLauncher.open()
                    },
                    onClose: {
                        challenge.stop()
                        showChallenge = false
                    }
                )
            }
            .onAppear {
                if showChallenge, challenge.screen == .idle { challenge.start(.demo) }
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
