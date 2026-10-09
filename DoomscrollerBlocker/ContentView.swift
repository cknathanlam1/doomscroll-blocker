import SwiftUI

/// What the full-screen cover shows: the warning first (when YouTube triggered the app), then the challenge.
private enum CoverPhase {
    case intercept
    case challenge
}

struct ContentView: View {
    @StateObject private var log = OpenLog.shared
    @StateObject private var challenge = ChallengeSession()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("reps") private var reps = 10
    @AppStorage("depth") private var depth = "normal"
    @AppStorage("speak") private var speak = true
    @AppStorage("passMinutes") private var passMinutes = 30
    @State private var showCover = ProcessInfo.processInfo.arguments.contains("-autoDemo")
    @State private var coverPhase = CoverPhase.challenge

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
                Section("Settings") {
                    Stepper("Push-ups: \(reps)", value: $reps, in: 1...30)
                    Picker("Depth", selection: $depth) {
                        Text("Lenient").tag("lenient")
                        Text("Normal").tag("normal")
                        Text("Strict").tag("strict")
                    }
                    Picker("Unlock for", selection: $passMinutes) {
                        ForEach([5, 10, 15, 30], id: \.self) { Text("\($0) min").tag($0) }
                    }
                    Toggle("Speak counts", isOn: $speak)
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
                        startChallenge()
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
                            coverPhase = .challenge
                            showCover = true
                        }
                        Spacer()
                        Button("Test the warning") { showIntercept() }
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
            .fullScreenCover(isPresented: $showCover) {
                cover
            }
            .onAppear {
                if ProcessInfo.processInfo.arguments.contains("-autoDemo"), challenge.screen == .idle {
                    challenge.start(.demo)
                }
                if ProcessInfo.processInfo.arguments.contains("-autoIntercept") { showIntercept() }
                checkIntercept()
            }
            // YouTube was opened while the app was already running (or just came back to the front).
            .onChange(of: log.interceptRequestedAt) { _, _ in checkIntercept() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { checkIntercept() } }
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

    @ViewBuilder private var cover: some View {
        switch coverPhase {
        case .intercept:
            InterceptView(
                reps: min(30, max(1, reps)),
                onStart: { startChallenge() },
                onGiveUp: { showCover = false }
            )
        case .challenge:
            ChallengeFlowView(
                session: challenge,
                onUnlock: {
                    showCover = false
                    log.startPass()
                    YouTubeLauncher.open()
                },
                onClose: {
                    challenge.stop()
                    showCover = false
                }
            )
        }
    }

    private func showIntercept() {
        coverPhase = .intercept
        showCover = true
    }

    /// The Shortcuts action asked for the warning a moment ago: show it (once).
    private func checkIntercept() {
        guard !showCover, log.interceptRequestedAt != nil, !log.isPassActive else { return }
        if log.consumeIntercept() { showIntercept() }
    }

    private func startChallenge() {
        challenge.start(.camera)
        coverPhase = .challenge
        showCover = true
    }
}

#Preview {
    ContentView()
}
