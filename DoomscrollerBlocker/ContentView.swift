import SwiftUI

struct ContentView: View {
    @Environment(\.openURL) private var openURL
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
            .safeAreaInset(edge: .bottom) {
                Button {
                    openURL(URL(string: "youtube://")!)
                } label: {
                    Text("Open YouTube")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding()
            }
            .navigationTitle("Doomscroller Blocker")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink("Camera") { CameraScreen() }
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
