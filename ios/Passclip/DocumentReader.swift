import UIKit
import PDFKit
import Vision
import UniformTypeIdentifiers

/// Where a pass's text came from, for the back of the pass ("Imported from SISTIC E-Ticket").
/// The kind is one of the import schema's source kinds.
struct DocumentSource: Equatable {
    var kind = "email"
    var name: String?
}

/// What was found in a shared or chosen document: its text (for "Make pass"), any barcodes it shows
/// (offered to the person, never added on their behalf: CLAUDE.md rule 3) and any links worth keeping.
struct ReadDocument {
    var text: String
    var codes: [FoundCode] = []
    var links: [FoundLink] = []
    var source = DocumentSource()
    /// A picture of the event, like the preview image a ticket page declares. Offered for the pass.
    var picture: Data? = nil
    /// The ticket as a small picture (JPEG), for Apple Intelligence models that can look at images (iOS 27).
    var pageImage: Data? = nil
    /// A PDF holding several tickets, one code per page: each ticket on its own, read like a batch (BatchImport).
    var tickets: [ReadDocument] = []
}

/// What the screen starts with when something was shared to Passclip or opened in it.
struct Incoming {
    var text = ""
    var codes: [FoundCode] = []
    var links: [FoundLink] = []
    var source = DocumentSource()
    var picture: Data?
    var problem = ""
    /// Several documents shared or chosen at once, read one by one into passes (BatchImport).
    var documents: [ReadDocument] = []

    init(text: String = "", problem: String = "") { self.text = text; self.problem = problem }
    init(_ document: ReadDocument) { text = document.text; codes = document.codes; links = document.links; source = document.source; picture = document.picture }
}

enum DocumentError: LocalizedError {
    case tooLarge
    case unsupported
    case noText
    var errorDescription: String? {
        switch self {
        case .tooLarge: return "This file is too large. Choose a file under 25 MB."
        case .unsupported: return "Passclip can read PDFs, screenshots, photos and .txt or .json files. This file is none of those."
        case .noText: return "Passclip couldn't find any text in this document. Try a sharper copy, or copy the text from your email instead."
        }
    }
}

/// What a share sheet or the file picker handed over.
enum SharedInput {
    case text(String)
    case file(Data, name: String?)
}

/// Reads PDFs, screenshots and photos on this iPhone. The file type comes from the file's own
/// bytes, never from its name, so a PDF saved without ".pdf" still works. Nothing is uploaded.
enum DocumentReader {
    static let maxBytes = 25 * 1024 * 1024
    private static let maxPages = 20
    private static let maxTextBytes = 256 * 1024

    static func read(_ data: Data, name: String? = nil) async throws -> ReadDocument {
        guard data.count <= maxBytes else { throw DocumentError.tooLarge }
        var document = try await Task.detached(priority: .userInitiated) { try readNow(data) }.value
        document.source.name = cleanName(name)
        for index in document.tickets.indices { document.tickets[index].source.name = document.source.name }
        return document
    }

    /// "SISTIC E-Ticket.pdf" becomes "SISTIC E-Ticket".
    static func cleanName(_ name: String?) -> String? {
        guard var text = name?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        if let dot = text.lastIndex(of: "."), text.distance(from: dot, to: text.endIndex) <= 5 { text = String(text[..<dot]) }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : String(text.prefix(200))
    }

    static func isPDF(_ data: Data) -> Bool {
        // The header may follow a few stray bytes.
        data.prefix(1024).range(of: Data("%PDF-".utf8)) != nil
    }

    private static func readNow(_ data: Data) throws -> ReadDocument {
        if isPDF(data) {
            guard let pdf = PDFDocument(data: data) else { throw DocumentError.unsupported }
            return try read(pdf)
        }
        if let image = UIImage(data: data) {
            let text = (try? recognizeText(in: image)) ?? ""
            let codes = (try? BarcodeReader.read(image)) ?? []
            var result = try document(text: text, codes: codes, kind: "screenshot")
            result.pageImage = modelPicture(image)
            return result
        }
        if data.count <= maxTextBytes, let text = String(data: data, encoding: .utf8),
           !text.contains("\u{0}"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ReadDocument(text: text, source: DocumentSource(kind: "other"))
        }
        throw DocumentError.unsupported
    }

    private static func read(_ pdf: PDFDocument) throws -> ReadDocument {
        let pages = (0..<min(pdf.pageCount, maxPages)).compactMap { pdf.page(at: $0) }
        var pageTexts = pages.map { $0.string ?? "" }
        // Links come from the PDF's own text and link areas, never from scanned text, which can misread a character.
        let links = LinkFinder.links(in: pageTexts.joined(separator: "\n\n"), also: pages.flatMap { page in page.annotations.compactMap { $0.url ?? ($0.action as? PDFActionURL)?.url } })
        var pageCodes: [[FoundCode]] = []
        var pagePictures: [Data?] = []
        var seen = Set<String>()
        // A QR code is a drawing, so it isn't in the page's text; look at the page as a picture.
        let needsOCR = pageTexts.joined().filter { $0.isLetter || $0.isNumber }.count < 80
        for (index, page) in pages.enumerated() {
            autoreleasepool {
                let image = render(page)
                let found = ((try? BarcodeReader.read(image)) ?? []).filter { seen.insert($0.id).inserted }
                pageCodes.append(found)
                // Kept small, and only for the first page and pages with a code: those are what the model looks at.
                pagePictures.append(index == 0 || !found.isEmpty ? modelPicture(image) : nil)
                // Scanned pages are read as pictures. Other pages can still have words only in a picture, like an
                // event's name in its logo, so those words are added in front of the page's own text.
                let seenText = (try? recognizeText(in: image)) ?? ""
                pageTexts[index] = needsOCR ? seenText : withPictureWords(seenText, text: pageTexts[index])
            }
        }
        var codes = pageCodes.flatMap { $0 }
        // A web page printed to PDF can split a code across a page break. If no page holds a whole code,
        // look again at each page break: the bottom of one page joined to the top of the next.
        if codes.isEmpty {
            for index in pages.indices.dropLast() {
                autoreleasepool {
                    guard let joined = pageBreak(render(pages[index]), render(pages[index + 1])) else { return }
                    for code in (try? BarcodeReader.read(joined)) ?? [] where seen.insert(code.id).inserted { codes.append(code) }
                }
            }
        }
        var result = try document(text: pageTexts.joined(separator: "\n\n"), codes: codes, kind: "pdf")
        result.links = links
        result.pageImage = pagePictures.first ?? nil
        result.tickets = tickets(pages: Array(zip(pageTexts, pageCodes)), kind: "pdf")
        // Each ticket gets the picture of its own code page.
        let codePictures = pageCodes.indices.filter { !pageCodes[$0].isEmpty }.map { pagePictures[$0] }
        if codePictures.count == result.tickets.count { for index in result.tickets.indices { result.tickets[index].pageImage = codePictures[index] } }
        return result
    }

    /// The page's text, with the lines that appear only in its pictures (logos, banners) in front.
    static func withPictureWords(_ seen: String, text: String) -> String {
        func key(_ line: String) -> String { String(line.lowercased().filter { $0.isLetter || $0.isNumber }) }
        let pageKey = key(text)
        let extra = seen.split(separator: "\n").map(String.init).filter { line in
            let lineKey = key(line)
            return lineKey.count >= 3 && !pageKey.contains(lineKey)
        }
        guard !extra.isEmpty else { return text }
        return "Words in the page's pictures, like logos: " + extra.joined(separator: " / ") + "\n\n" + text
    }

    /// A JPEG at most 1,280 pixels on its longer side: enough to read a ticket, small enough to keep many.
    static func modelPicture(_ image: UIImage) -> Data? {
        let longest = max(image.size.width * image.scale, image.size.height * image.scale)
        guard longest > 0 else { return nil }
        let factor = min(1, 1_280 / longest)
        let size = CGSize(width: (image.size.width * image.scale * factor).rounded(), height: (image.size.height * image.scale * factor).rounded())
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.8) { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// A page as a picture about 2,000 pixels on its longer side, sharp enough for small codes.
    private static func render(_ page: PDFPage) -> UIImage {
        let size = page.bounds(for: .mediaBox).size
        let scale = 2_000 / max(size.width, size.height, 1)
        return page.thumbnail(of: CGSize(width: size.width * scale, height: size.height * scale), for: .mediaBox)
    }

    /// Splits a PDF into tickets when it holds several, each page with its own single code, like an e-ticket PDF for
    /// a group. Pages without a code (the event details before a code page) go with the next code page; pages after
    /// the last code (terms and conditions) are left out. A page with more than one code can't be split safely, so
    /// then the PDF stays one document and the person matches the codes to the passes.
    static func tickets(pages: [(text: String, codes: [FoundCode])], kind: String) -> [ReadDocument] {
        let codePages = pages.filter { !$0.codes.isEmpty }
        guard codePages.count > 1, codePages.allSatisfy({ $0.codes.count == 1 }) else { return [] }
        var tickets: [ReadDocument] = []
        var waiting: [String] = []
        for page in pages {
            waiting.append(page.text)
            guard let code = page.codes.first else { continue }
            let text = waiting.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
            waiting = []
            guard !text.isEmpty else { return [] }
            tickets.append(ReadDocument(text: String(text.prefix(maxTextBytes / 4)), codes: [code], source: DocumentSource(kind: kind)))
        }
        return tickets
    }

    /// The bottom half of one page on top of the top half of the next, at the same width.
    static func pageBreak(_ upper: UIImage, _ lower: UIImage) -> UIImage? {
        guard let top = upper.cgImage, let bottom = lower.cgImage else { return nil }
        let width = max(top.width, bottom.width)
        let topPart = top.cropping(to: CGRect(x: 0, y: top.height / 2, width: top.width, height: top.height - top.height / 2))
        let bottomPart = bottom.cropping(to: CGRect(x: 0, y: 0, width: bottom.width, height: bottom.height / 2))
        guard let topPart, let bottomPart else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: width, height: topPart.height + bottomPart.height)
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            UIImage(cgImage: topPart).draw(in: CGRect(x: 0, y: 0, width: topPart.width, height: topPart.height))
            UIImage(cgImage: bottomPart).draw(in: CGRect(x: 0, y: topPart.height, width: bottomPart.width, height: bottomPart.height))
        }
    }

    private static func document(text: String, codes: [FoundCode], kind: String) throws -> ReadDocument {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw DocumentError.noText }
        return ReadDocument(text: String(trimmed.prefix(maxTextBytes / 4)), codes: codes, source: DocumentSource(kind: kind))
    }

    private static func recognizeText(in image: UIImage) throws -> String {
        guard let cgImage = image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation)).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    // MARK: Share sheet

    /// Takes whatever the share sheet offers: selected text, a web page's link, a PDF (including from the
    /// print preview), a screenshot, or any file. Files are judged by their content, not their name.
    static func load(_ provider: NSItemProvider) async -> SharedInput? {
        let types: [UTType] = [.pdf, .image, .fileURL, .url, .plainText, .data]
        for type in types where provider.hasItemConformingToTypeIdentifier(type.identifier) {
            if let input = await load(provider, as: type) { return input }
        }
        return nil
    }

    private static func load(_ provider: NSItemProvider, as type: UTType) async -> SharedInput? {
        do {
            if type == .plainText || type == .fileURL || type == .url {
                let value = try await provider.loadItem(forTypeIdentifier: type.identifier)
                if let url = value as? URL { return url.isFileURL ? try file(at: url, name: provider.suggestedName) : .text(url.absoluteString) }
                if let text = value as? String { return .text(text) }
                if let data = value as? Data {
                    if type == .plainText, let text = String(data: data, encoding: .utf8) { return .text(text) }
                    return .file(data, name: provider.suggestedName)
                }
                return nil
            }
            let data: Data? = await withCheckedContinuation { continuation in
                _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in continuation.resume(returning: data) }
            }
            return data.map { .file($0, name: provider.suggestedName) }
        } catch {
            // Never log: it can name or echo the shared document.
            return nil
        }
    }

    private static func file(at url: URL, name: String?) throws -> SharedInput? {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= maxBytes else { return nil }
        return .file(try Data(contentsOf: url), name: name ?? url.lastPathComponent)
    }
}
