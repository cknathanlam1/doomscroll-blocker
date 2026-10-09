import CoreText
import SwiftUI
import UIKit

// Design tokens of the challenge UI (docs/UI_SPEC.md §1): colours, fonts, shared
// building blocks. Everything is a fixed size on purpose: the screens are read
// from about 3 ft away with the phone on the floor, so Dynamic Type must not
// reflow them.

// MARK: - Colours (UI_SPEC §1.1)

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum Theme {
    static let page = Color(hex: 0x0B0B0D)
    static let panel = Color(hex: 0x17171B)
    static let panel2 = Color(hex: 0x202026)
    static let line = Color(hex: 0x2C2C33)
    static let fg = Color(hex: 0xF5F5F2)
    static let mute = Color(hex: 0x8E8E96)
    static let dim = Color(hex: 0x55555D)
    static let volt = Color(hex: 0xFFD43B)
    static let voltInk = Color(hex: 0x191300)
    static let ok = Color(hex: 0x32D74B)
    static let warn = Color(hex: 0xFF9F0A)
    static let bad = Color(hex: 0xFF453A)
    static let okInk = Color(hex: 0x03230A)
    static let warnInk = Color(hex: 0x1D0F00)

    /// Segmented-control selection etc. (kept for the debug panel).
    static let selected = Color(hex: 0x636366)
}

// MARK: - Fonts (UI_SPEC §1.2)

enum BarlowWeight {
    case extraBold, black, blackItalic

    var postScriptName: String {
        switch self {
        case .extraBold: return "BarlowCondensed-ExtraBold"
        case .black: return "BarlowCondensed-Black"
        case .blackItalic: return "BarlowCondensed-BlackItalic"
        }
    }
}

enum AppFonts {
    private static let files = ["BarlowCondensed-ExtraBold", "BarlowCondensed-Black", "BarlowCondensed-BlackItalic"]

    /// Registers the bundled Barlow Condensed files for this process. Safe to call any number of times.
    @discardableResult
    static func register() -> Bool { registered }

    private static let registered: Bool = {
        let urls = files.compactMap { Bundle.main.url(forResource: $0, withExtension: "ttf") }
        guard !urls.isEmpty else { return false }
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
        return true
    }()

    /// True when Barlow Condensed is actually available (otherwise the UI falls back to the system font).
    static var barlowAvailable: Bool {
        register()
        return UIFont(name: "BarlowCondensed-Black", size: 12) != nil
    }
}

extension Font {
    /// Barlow Condensed at a fixed size. Falls back to the condensed system font if the files are missing.
    static func barlow(_ size: CGFloat, _ weight: BarlowWeight = .black) -> Font {
        if AppFonts.barlowAvailable {
            return .custom(weight.postScriptName, fixedSize: size)
        }
        let f = Font.system(size: size, weight: weight == .extraBold ? .heavy : .black).width(.condensed)
        return weight == .blackItalic ? f.italic() : f
    }

    /// The system font at a CSS-style weight (400, 500, 600, 650, 700, 750, 800).
    /// iOS Safari renders 650 and 750 exactly (SF is variable); so do we.
    static func ui(_ size: CGFloat, _ cssWeight: Int = 400) -> Font {
        let w: UIFont.Weight
        switch cssWeight {
        case ..<450: w = .regular
        case 450..<550: w = .medium
        case 550..<625: w = .semibold
        case 625..<675: w = UIFont.Weight(0.35)
        case 675..<725: w = .bold
        case 725..<775: w = UIFont.Weight(0.48)
        default: w = .heavy
        }
        return Font(UIFont.systemFont(ofSize: size, weight: w))
    }

    static func mono(_ size: CGFloat, _ cssWeight: Int = 400) -> Font {
        .system(size: size, weight: cssWeight >= 600 ? .semibold : .regular, design: .monospaced)
    }
}

// MARK: - Text with a CSS line height

/// Barlow numerals and display words ("CAN'T SEE YOU", "GO LOWER"): fixed size,
/// CSS-style line height. CSS centres the glyph box in the line box (half-leading),
/// which is what `frame(height:)` does with a centred, unwrapped Text.
struct BarlowText: View {
    var text: String
    var size: CGFloat
    var color: Color = Theme.fg
    var weight: BarlowWeight = .black
    /// Line height as a multiple of the font size (the 0.82 of `.big`, 0.9 of titles…).
    var lineHeight: CGFloat = 1
    /// Letter spacing in em.
    var trackingEm: CGFloat = 0
    var digits = false

    var body: some View {
        let t = Text(text)
            .font(.barlow(size, weight))
            .tracking(trackingEm * size)
            .foregroundStyle(color)
        Group {
            if digits { t.monospacedDigit() } else { t }
        }
        .lineLimit(1)
        .fixedSize()
        .frame(height: lineHeight * size)
    }
}

// MARK: - Icons

/// SF Symbols standing in for the web's inline SVG sprite (UI_SPEC §1.9).
enum Icon: String {
    case lock = "lock"
    case camOff = "video.slash"
    case speaker = "speaker.wave.2.fill"
    case check = "checkmark"
    case play = "play.fill"
    case pause = "pause.fill"
    case down = "arrow.down"
    case sun = "sun.max"
    case move = "arrow.up.and.down"
    case person = "person"
    case redo = "arrow.counterclockwise"
    case hand = "hand.raised"
    case phone = "iphone"
    case out = "arrow.up.right"
    case close = "xmark"
}

struct IconView: View {
    var icon: Icon
    var size: CGFloat = 20
    var color: Color = Theme.fg
    var weight: Font.Weight = .semibold

    var body: some View {
        Image(systemName: icon.rawValue)
            .font(.system(size: size * 0.9, weight: weight))
            .foregroundStyle(color)
            .frame(width: size, height: size)
    }
}

// MARK: - Buttons (UI_SPEC §1.4)

enum AppButtonKind {
    /// volt / volt-ink
    case primary
    /// panel2 / fg
    case secondary
    /// volt-ink / volt (on the Success screen)
    case black
    /// no background, muted text
    case ghost
    /// ghost with volt-ink text (on the Success screen)
    case ghostInk
}

struct AppButtonStyle: ButtonStyle {
    var kind: AppButtonKind
    var height: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(kind == .ghost ? 15 : (height > 55 ? 19 : 17), kind == .ghost ? 500 : 650))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .primary: return Theme.voltInk
        case .secondary: return Theme.fg
        case .black: return Theme.volt
        case .ghost: return Theme.mute
        case .ghostInk: return Theme.voltInk.opacity(0.8)
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return Theme.volt
        case .secondary: return Theme.panel2
        case .black: return Theme.voltInk
        case .ghost, .ghostInk: return .clear
        }
    }
}

struct AppButton: View {
    var title: String
    var icon: Icon?
    var kind: AppButtonKind = .primary
    var height: CGFloat?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { IconView(icon: icon, size: 18, color: iconColor) }
                Text(title)
            }
        }
        .buttonStyle(AppButtonStyle(kind: kind, height: height ?? (kind == .ghost || kind == .ghostInk ? 44 : 52)))
    }

    private var iconColor: Color {
        switch kind {
        case .primary: return Theme.voltInk
        case .secondary: return Theme.fg
        case .black: return Theme.volt
        case .ghost: return Theme.mute
        case .ghostInk: return Theme.voltInk.opacity(0.8)
        }
    }
}

// MARK: - Small shared shapes

/// A pill of the chips row ("Paused", "Didn't count"): height 28, padding 12, radius 14, gap 6.
struct Pill<Content: View>: View {
    var background: Color
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 6) { content() }
            .font(.ui(13, 650))
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(background, in: Capsule())
    }
}

/// CSS-style text shadow: blur radius ≈ 2 × SwiftUI's radius.
extension View {
    func textShadow(blur: CGFloat, y: CGFloat, _ color: Color) -> some View {
        shadow(color: color, radius: blur / 2, x: 0, y: y)
    }
}

/// Unit cubic-bezier easing, `cubic-bezier(x1, y1, x2, y2)` as in CSS.
struct CubicBezier {
    var x1: Double, y1: Double, x2: Double, y2: Double

    /// Eased progress for linear progress `t` in 0…1.
    func value(at t: Double) -> Double {
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }
        // Solve x(s) = t with Newton + bisection fallback, then return y(s).
        func bx(_ s: Double) -> Double { 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s }
        func by(_ s: Double) -> Double { 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s }
        func dbx(_ s: Double) -> Double {
            3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2)
        }
        var s = t
        for _ in 0..<8 {
            let err = bx(s) - t
            if abs(err) < 1e-6 { return by(s) }
            let d = dbx(s)
            if abs(d) < 1e-6 { break }
            s -= err / d
        }
        var lo = 0.0, hi = 1.0
        s = t
        for _ in 0..<40 {
            let v = bx(s)
            if abs(v - t) < 1e-7 { break }
            if v < t { lo = s } else { hi = s }
            s = (lo + hi) / 2
        }
        return by(s)
    }
}
