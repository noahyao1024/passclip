import SwiftUI
import UIKit

/// The website's palette (docs/SPEC.md §10), with the same dark-mode values as globals.css.
enum Brand {
    static let paper = Color(light: 0xE9EDF2, dark: 0x131B28)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1C2839)
    static let ink = Color(light: 0x1A2230, dark: 0xE9EDF2)
    static let muted = Color(light: 0x536176, dark: 0xB3BFD0)
    static let border = Color(light: 0xB9C2D0, dark: 0x536176)
    static let signal = Color(light: 0x3346D3, dark: 0xA8B2FF)
    static let signalText = Color(light: 0xFFFFFF, dark: 0x152049)
    static let stub = Color(light: 0xF2B33D, dark: 0xF2B33D)
    static let error = Color(light: 0xB3261E, dark: 0xFFACA5)
    static let input = Color(light: 0xF5F7FA, dark: 0x172231)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        })
    }
}

/// A white rounded card, like the website's surfaces.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.border.opacity(0.35)))
    }
}

/// "1  Ask any AI": a numbered step heading.
struct StepHeading: View {
    let number: Int
    let title: String
    var body: some View {
        HStack(spacing: 10) {
            Text("\(number)").font(.footnote.weight(.bold)).foregroundStyle(Brand.signal)
                .frame(width: 26, height: 26).overlay(Circle().strokeBorder(Brand.signal, lineWidth: 1.5))
                .accessibilityHidden(true)
            Text(title).font(.headline).foregroundStyle(Brand.ink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number): \(title)")
    }
}

/// The main action style: full width, Signal blue.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(enabled ? Brand.signalText : Brand.muted)
            .background(enabled ? Brand.signal : Brand.input, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// A quieter action: outlined, Signal blue text.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14).frame(minHeight: 44)
            .foregroundStyle(Brand.signal)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.border))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
