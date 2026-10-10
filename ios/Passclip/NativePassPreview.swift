import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

private extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x2f3640
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
struct NativePassPreview: View {
    let pass: JSONValue
    let layout: WalletLayout
    /// The picture Wallet shows, blurred, behind an event ticket's whole front.
    var artwork: Data?
    @State private var back = false
    private var picture: UIImage? { back ? nil : artwork.flatMap(UIImage.init(data:)) }
    private var background: Color { Color(hex: pass["style"]?["backgroundColor"]?.string ?? "#2F3640") }
    private var foreground: Color { Color(hex: pass["style"]?["foregroundColor"]?.string ?? "#FFFFFF") }
    private var label: Color { Color(hex: pass["style"]?["labelColor"]?.string ?? "#C9D1DC") }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(pass["organization"]?.string ?? pass["title"]?.string ?? "Pass") .font(.headline)
                Spacer()
                Button(back ? "Show front" : "Show back") { back.toggle() }.font(.caption).buttonStyle(.bordered)
            }
            if back {
                ForEach(layout.backFields, id: \.key) { field in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(field.label).font(.caption).foregroundStyle(label)
                        if field.attributedValue != nil, let value = field.value.string, let url = URL(string: value), url.scheme == "https" {
                            Link("Open \(field.label)", destination: url).underline()
                        } else { Text(display(field)).textSelection(.enabled) }
                    }
                }
            } else {
                row(layout.headerFields)
                row(layout.primaryFields, primary: true)
                row(layout.secondaryFields)
                row(layout.auxiliaryFields.filter { ($0.row ?? 0) == 0 })
                // An event ticket's second row of auxiliary fields, as Wallet shows it.
                if layout.auxiliaryFields.contains(where: { $0.row == 1 }) { row(layout.auxiliaryFields.filter { $0.row == 1 }) }
                // As in Wallet, the barcode sits at the bottom of the card and the picture fills the space above it.
                if picture != nil { Spacer(minLength: 12) }
                if let barcode = pass["barcode"], let message = barcode["message"]?.string {
                    if let image = barcodeImage(format: barcode["format"]?.string ?? "", message: message) {
                        Image(uiImage: image).interpolation(.none).resizable().scaledToFit().frame(maxHeight: 135).padding(8).background(.white).clipShape(RoundedRectangle(cornerRadius: 4)).accessibilityLabel("Barcode for this pass")
                    } else if ["ean13", "code39", "codabar", "itf"].contains(barcode["format"]?.string ?? "") {
                        Text("Wallet shows this barcode type on iOS 27 and later. The app can't preview it.").font(.caption)
                    } else { Text("Barcode preview unavailable. Check the original ticket.").font(.caption) }
                    if let alt = barcode["altText"]?.string { Text(alt).font(.caption).frame(maxWidth: .infinity) }
                } else { Text("No barcode yet. Add it from a screenshot below.").font(.caption) }
            }
        }
        .foregroundStyle(foreground).padding(20)
        .frame(maxWidth: .infinity, minHeight: picture == nil ? nil : 460, alignment: .topLeading)
        .background {
            ZStack {
                background
                if let picture { Image(uiImage: picture).resizable().scaledToFill().scaleEffect(1.15).blur(radius: 8) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
    private func row(_ fields: [WalletField], primary: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(fields, id: \.key) { field in
                VStack(alignment: .leading, spacing: 3) {
                    Text(field.label.uppercased()).font(.caption2).foregroundStyle(label)
                    Text(display(field)).font(primary ? .title2.weight(.semibold) : .subheadline)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private func display(_ field: WalletField) -> String {
        if case .number(let value) = field.value, let currency = field.currencyCode { return value.formatted(.currency(code: currency)) }
        guard let value = field.value.string, field.dateStyle != nil || field.timeStyle != nil else { return field.value.display }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = parser.date(from: value)
        if date == nil { parser.formatOptions = [.withInternetDateTime]; date = parser.date(from: value) }
        if date == nil && value.count == 10 { let day = DateFormatter(); day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = TimeZone(secondsFromGMT: 0); day.dateFormat = "yyyy-MM-dd"; date = day.date(from: value) }
        guard let date else { return value }
        let formatter = DateFormatter()
        // ISO offsets are authoritative; don't move travel arrival times into the device zone.
        if let range = value.range(of: #"[+-]\d{2}:\d{2}$"#, options: .regularExpression) {
            let offset = String(value[range]); let parts = offset.dropFirst().split(separator: ":")
            let seconds = ((Int(parts[0]) ?? 0) * 60 + (Int(parts[1]) ?? 0)) * 60 * (offset.hasPrefix("-") ? -1 : 1)
            formatter.timeZone = TimeZone(secondsFromGMT: seconds)
        } else { formatter.timeZone = TimeZone(secondsFromGMT: 0) }
        formatter.dateStyle = field.dateStyle == "PKDateStyleNone" || field.dateStyle == nil ? .none : field.dateStyle == "PKDateStyleShort" ? .short : .medium
        formatter.timeStyle = field.timeStyle == "PKDateStyleNone" || field.timeStyle == nil ? .none : .short
        return formatter.string(from: date)
    }
    private func barcodeImage(format: String, message: String) -> UIImage? {
        let names = ["qr": "CIQRCodeGenerator", "pdf417": "CIPDF417BarcodeGenerator", "aztec": "CIAztecCodeGenerator", "code128": "CICode128BarcodeGenerator"]
        guard let name = names[format], let filter = CIFilter(name: name),
              let data = message.data(using: .isoLatin1, allowLossyConversion: false) ?? message.data(using: .utf8) else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 3, y: 3)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
