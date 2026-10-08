import AVFoundation

/// Port of platform/speech.ts: spoken counts via AVSpeechSynthesizer.
///
/// - Newest phrase wins: a spoken count must never lag behind the reps, so a
///   queued phrase is cancelled when a new one arrives.
/// - `.playback` + `.duckOthers`: counts are heard with the silent switch on and
///   music ducks while the set runs.
@MainActor
final class SpeechService {
    private let synth = AVSpeechSynthesizer()
    private var voice: AVSpeechSynthesisVoice? = SpeechService.pickVoice()
    var enabled = true

    /// AVSpeechUtterance's scale differs from the web (default 0.5); ~0.53 matches "10 % faster".
    private let rate: Float = 0.53

    func activate() {
        guard enabled else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
    }

    func deactivate() {
        cancel()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func speak(_ phrase: String) {
        guard enabled else { return }
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.voice = voice
        utterance.rate = rate
        synth.speak(utterance)
    }

    func cancel() {
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
    }

    /// The default en-US voice, else Samantha, else any en-US voice. Novelty voices are never picked.
    private static func pickVoice() -> AVSpeechSynthesisVoice? {
        if let v = AVSpeechSynthesisVoice(language: "en-US") { return v }
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "en-US" }
        return voices.first { $0.name == "Samantha" } ?? voices.first
    }

    /// "One" … "Thirty" (digits above 30), as the web speaks them.
    static func countWord(_ n: Int) -> String {
        let words = [
            "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
            "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
            "Nineteen", "Twenty", "Twenty-one", "Twenty-two", "Twenty-three", "Twenty-four", "Twenty-five",
            "Twenty-six", "Twenty-seven", "Twenty-eight", "Twenty-nine", "Thirty",
        ]
        return n >= 1 && n < words.count ? words[n] : String(n)
    }
}
