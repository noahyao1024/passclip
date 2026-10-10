import UIKit

/// Turns a poster or photo into Wallet's thumbnail files on this iPhone. Apple's guidelines (checked 2026-10-10):
/// 60 to 90 points wide, 90 high, an aspect ratio between 2:3 and 1:1 for a portrait poster, at @1x, @2x and @3x.
enum PosterImage {
    static let maxBytes = 300 * 1024

    /// The three PNG files, base64 encoded, keyed by their names in the pass. Nil when the image can't be used.
    static func thumbnailFiles(from image: UIImage) -> [String: String]? {
        guard let cgImage = normalized(image).cgImage else { return nil }
        let width = CGFloat(cgImage.width), height = CGFloat(cgImage.height)
        guard width >= 30, height >= 30 else { return nil }
        // Keep the middle of the picture at an aspect Wallet shows without cropping it further.
        let aspect = min(max(width / height, 2.0 / 3.0), 1)
        let crop = width / height > aspect
            ? CGRect(x: (width - height * aspect) / 2, y: 0, width: height * aspect, height: height)
            : CGRect(x: 0, y: (height - width / aspect) / 2, width: width, height: width / aspect)
        guard let cropped = cgImage.cropping(to: crop.integral) else { return nil }
        let points = CGSize(width: (90 * aspect).rounded(), height: 90)
        var files: [String: String] = [:]
        for (name, scale) in [("thumbnail.png", 1.0), ("thumbnail@2x.png", 2.0), ("thumbnail@3x.png", 3.0)] {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let size = CGSize(width: points.width * scale, height: points.height * scale)
            let data = UIGraphicsImageRenderer(size: size, format: format).pngData { _ in
                UIImage(cgImage: cropped).draw(in: CGRect(origin: .zero, size: size))
            }
            guard data.count <= maxBytes else { return nil }
            files[name] = data.base64EncodedString()
        }
        return files
    }

    /// The picture drawn upright, so its pixels match what the person sees.
    private static func normalized(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
    }

    /// Pass colors in the picture's main hue: a deep background with white text and a tinted label, like the
    /// server's own color schemes (colors.ts). Nil for a gray picture, which keeps the pass's colors.
    static func passColors(from image: UIImage) -> (background: String, foreground: String, label: String)? {
        guard let cgImage = normalized(image).cgImage else { return nil }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .medium
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
        // A hue histogram weighted by how colorful each pixel is, so the poster's main color wins over gray areas.
        var bins = [Double](repeating: 0, count: 36)
        var total = 0.0
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let color = UIColor(red: CGFloat(pixels[index]) / 255, green: CGFloat(pixels[index + 1]) / 255, blue: CGFloat(pixels[index + 2]) / 255, alpha: 1)
            var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0
            color.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: nil)
            let weight = Double(saturation * brightness)
            bins[min(35, Int(hue * 36))] += weight
            total += weight
        }
        guard total / Double(side * side) > 0.08, let best = bins.indices.max(by: { bins[$0] < bins[$1] }) else { return nil }
        // The weighted middle of the strongest bin and its neighbours.
        let near = [(best + 35) % 36, best, (best + 1) % 36]
        let weight = near.reduce(0) { $0 + bins[$1] }
        let offset = (bins[near[2]] - bins[near[0]]) / max(weight, 0.0001)
        let hue = (Double(best) + 0.5 + offset) * 10
        return (hex(hue: hue, saturation: 0.58, lightness: 0.17), "#FFFFFF", hex(hue: hue, saturation: 0.7, lightness: 0.88))
    }

    static func hex(hue: Double, saturation: Double, lightness: Double) -> String {
        let h = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let chroma = (1 - abs(2 * lightness - 1)) * saturation
        let x = chroma * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let match = lightness - chroma / 2
        let (r, g, b): (Double, Double, Double) = h < 60 ? (chroma, x, 0) : h < 120 ? (x, chroma, 0) : h < 180 ? (0, chroma, x) : h < 240 ? (0, x, chroma) : h < 300 ? (x, 0, chroma) : (chroma, 0, x)
        return String(format: "#%02X%02X%02X", Int(((r + match) * 255).rounded()), Int(((g + match) * 255).rounded()), Int(((b + match) * 255).rounded()))
    }
}
