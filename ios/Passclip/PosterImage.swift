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
}
