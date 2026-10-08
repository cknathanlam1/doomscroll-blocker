import Foundation

// Port of web-prototype/src/core/oneEuro.ts.

/// Low-pass smoothing factor for a sample that arrived `dtSec` after the
/// previous one, for a filter with cutoff frequency `cutoffHz`. Computing it
/// from the real dt (instead of a per-frame constant) keeps the smoothing the
/// same whether the phone delivers 15 or 30 frames per second.
private func smoothingFactor(_ dtSec: Double, _ cutoffHz: Double) -> Double {
    let tau = 1 / (2 * Double.pi * cutoffHz)
    return 1 / (1 + tau / dtSec)
}

/// One Euro filter (Casiez et al. 2012) for a scalar signal sampled at irregular times.
///
/// It is a low-pass filter whose cutoff rises with the signal's speed: when the
/// value barely moves (holding a plank) it smooths heavily to hide jitter; when
/// it moves fast (a quick push-up) it follows closely so the bottom of the rep
/// isn't clipped.
final class OneEuroFilter {
    private var cfg: SmoothingConfig
    /// Last filtered value, or nil before the first sample.
    private var x: Double?
    /// Last filtered derivative (signal units per second).
    private var dx = 0.0
    private var tPrevMs: Double?

    init(_ config: SmoothingConfig) {
        cfg = config
    }

    /// Filters `value` observed at time `tMs` (milliseconds).
    func filter(_ value: Double, _ tMs: Double) -> Double {
        if !value.isFinite { return x ?? value }
        guard let xPrev = x, let tPrev = tPrevMs else {
            // First sample: nothing to smooth against, pass it straight through.
            x = value
            dx = 0
            tPrevMs = tMs
            return value
        }
        let dtSec = (tMs - tPrev) / 1000
        // Repeated or out-of-order timestamp: dt would be 0 or negative and the
        // maths would divide by zero. Keep the previous output instead.
        if !(dtSec > 0) { return xPrev }
        tPrevMs = tMs

        let rawDx = (value - xPrev) / dtSec
        let aD = smoothingFactor(dtSec, cfg.dCutoff)
        dx = aD * rawDx + (1 - aD) * dx

        let cutoff = cfg.minCutoff + cfg.beta * abs(dx)
        let a = smoothingFactor(dtSec, cutoff)
        let out = a * value + (1 - a) * xPrev
        x = out
        return out
    }

    /// Forgets all history; the next sample passes straight through.
    func reset() {
        x = nil
        dx = 0
        tPrevMs = nil
    }

    /// Changes the parameters without losing the current state.
    func setConfig(_ config: SmoothingConfig) {
        cfg = config
    }
}
