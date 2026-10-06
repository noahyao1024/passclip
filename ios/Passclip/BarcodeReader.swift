import UIKit
import Vision

/// A code read from an image on this device. It's only used once the person chooses it (CLAUDE.md rule 3).
struct FoundCode: Hashable, Identifiable {
    let format: String
    let message: String
    var id: String { "\(format)\u{0}\(message)" }
}

/// Reads barcodes from a screenshot or photo with Apple's Vision framework. Nothing leaves the device.
enum BarcodeReader {
    /// Vision's symbologies, by the import format's names.
    static let formats: [VNBarcodeSymbology: String] = [
        .qr: "qr", .pdf417: "pdf417", .aztec: "aztec", .code128: "code128", .ean13: "ean13",
        .code39: "code39", .code39Checksum: "code39", .code39FullASCII: "code39", .code39FullASCIIChecksum: "code39",
        .codabar: "codabar", .itf14: "itf", .i2of5: "itf", .i2of5Checksum: "itf",
    ]
    static let names = [
        "qr": "QR code", "pdf417": "PDF417", "aztec": "Aztec", "code128": "Code 128",
        "ean13": "EAN-13", "code39": "Code 39", "codabar": "Codabar", "itf": "ITF",
    ]
    /// Types Wallet shows only on iOS 27 and later (docs/DECISIONS.md D17).
    static let newerFormats: Set<String> = ["ean13", "code39", "codabar", "itf"]

    static func read(_ image: UIImage) throws -> [FoundCode] {
        guard let cgImage = image.cgImage else { return [] }
        let request = VNDetectBarcodesRequest()
        request.symbologies = Array(formats.keys)
        try VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation)).perform([request])
        // Top to bottom, then left to right, so several codes come in reading order.
        let observations = (request.results ?? []).sorted {
            abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.05 ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.midX < $1.boundingBox.midX
        }
        var seen = Set<String>()
        return observations.compactMap { observation in
            guard let format = formats[observation.symbology], let message = observation.payloadStringValue, !message.isEmpty else { return nil }
            let code = FoundCode(format: format, message: message)
            return seen.insert(code.id).inserted ? code : nil
        }
    }
}

extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
