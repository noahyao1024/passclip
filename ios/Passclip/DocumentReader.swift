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
}

/// What the screen starts with when something was shared to Passclip or opened in it.
struct Incoming {
    var text = ""
    var codes: [FoundCode] = []
    var links: [FoundLink] = []
    var source = DocumentSource()
    var picture: Data?
    var problem = ""

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
    private static let maxPages = 6
    private static let maxTextBytes = 256 * 1024

    static func read(_ data: Data, name: String? = nil) async throws -> ReadDocument {
        guard data.count <= maxBytes else { throw DocumentError.tooLarge }
        var document = try await Task.detached(priority: .userInitiated) { try readNow(data) }.value
        document.source.name = cleanName(name)
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
            return try document(text: text, codes: codes, kind: "screenshot")
        }
        if data.count <= maxTextBytes, let text = String(data: data, encoding: .utf8),
           !text.contains("\u{0}"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ReadDocument(text: text, source: DocumentSource(kind: "other"))
        }
        throw DocumentError.unsupported
    }

    private static func read(_ pdf: PDFDocument) throws -> ReadDocument {
        let pages = (0..<min(pdf.pageCount, maxPages)).compactMap { pdf.page(at: $0) }
        var text = pages.compactMap(\.string).joined(separator: "\n\n")
        // Links come from the PDF's own text and link areas, never from scanned text, which can misread a character.
        let links = LinkFinder.links(in: text, also: pages.flatMap { page in page.annotations.compactMap { $0.url ?? ($0.action as? PDFActionURL)?.url } })
        var codes: [FoundCode] = []
        var seen = Set<String>()
        // A QR code is a drawing, so it isn't in the page's text; look at the page as a picture.
        let needsOCR = text.filter { $0.isLetter || $0.isNumber }.count < 80
        var recognized: [String] = []
        for page in pages {
            let size = page.bounds(for: .mediaBox).size
            let scale = 2_000 / max(size.width, size.height, 1)
            let image = page.thumbnail(of: CGSize(width: size.width * scale, height: size.height * scale), for: .mediaBox)
            for code in (try? BarcodeReader.read(image)) ?? [] where seen.insert(code.id).inserted { codes.append(code) }
            if needsOCR, let found = try? recognizeText(in: image) { recognized.append(found) }
        }
        if needsOCR { text = recognized.joined(separator: "\n\n") }
        var result = try document(text: text, codes: codes, kind: "pdf")
        result.links = links
        return result
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
