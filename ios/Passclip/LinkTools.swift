import UIKit

/// A web link found in a document, offered for the back of the pass. Never added without the person's say-so.
struct FoundLink: Hashable, Identifiable {
    var title: String
    var url: String
    var id: String { url }

    /// "sistic.stixcloud.com/Stix/eticket/…", short enough for one line.
    var display: String {
        guard let parts = URL(string: url), let host = parts.host else { return url }
        let text = host + parts.path
        return text.count > 48 ? String(text.prefix(47)) + "…" : text
    }
}

/// Finds the links worth keeping: the page a ticket was downloaded from and order pages, not terms,
/// privacy or social links. No AI is involved, so a link is always exactly what the document says.
enum LinkFinder {
    private static let skippedHosts = ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com", "apps.apple.com", "play.google.com", "wa.me"]
    private static let skippedWords = ["terms", "privacy", "policy", "unsubscribe", "optout", "opt-out", "preferences", "faq", "help", "contact", "cookie"]
    private static let originalWords = ["eticket", "e-ticket", "ticket", "download"]
    private static let detailWords = ["order", "booking", "confirm", "reservation", "itinerary", "manage", "transaction", "receipt", "invoice", "voucher"]

    static func links(in text: String, also extra: [URL] = [], limit: Int = 2) -> [FoundLink] {
        var seen = Set<String>()
        var candidates: [(url: String, score: Int)] = []
        func consider(_ raw: String) {
            let url = raw.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?)]}>\"'"))
            let lower = url.lowercased()
            guard lower.hasPrefix("https://"), url.count <= 2000, let host = URL(string: url)?.host?.lowercased(),
                  !skippedHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }),
                  !skippedWords.contains(where: { lower.contains($0) }),
                  seen.insert(url).inserted else { return }
            // Only the page's path and query say what it is; "tickets.example.com" says nothing.
            let page = (URLComponents(string: url).map { $0.path + "?" + ($0.query ?? "") } ?? "").lowercased()
            let score = originalWords.contains(where: { page.contains($0) }) ? 2 : (detailWords.contains(where: { page.contains($0) }) ? 1 : 0)
            if score > 0 { candidates.append((url, score)) }
        }
        let decoded = text.replacingOccurrences(of: "&amp;", with: "&")
        if let regex = try? NSRegularExpression(pattern: #"https://[^\s<>"'`]+"#) {
            for match in regex.matches(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)) {
                if let range = Range(match.range, in: decoded) { consider(String(decoded[range])) }
            }
        }
        for url in extra { consider(url.absoluteString) }
        let ordered = candidates.enumerated().sorted { ($0.element.score, -$0.offset) > ($1.element.score, -$1.offset) }.map(\.element)
        return ordered.prefix(limit).map { FoundLink(title: $0.score == 2 ? "Original ticket" : "Order details", url: $0.url) }
    }
}

enum LinkError: LocalizedError {
    case insecure, needsSignIn, failed, tooLarge, noText
    private static let viaSafari = "Open it in Safari, tap Share, choose Options, then PDF, and share that to Passclip."
    var errorDescription: String? {
        switch self {
        case .insecure: return "Passclip opens secure links that start with https:// only. " + Self.viaSafari
        case .needsSignIn: return "This link needs you to sign in, so Passclip can't open it. " + Self.viaSafari
        case .failed: return "Passclip couldn't open this link. Check your connection, or: " + Self.viaSafari
        case .tooLarge: return "This file is too large. Choose a file under 25 MB."
        case .noText: return "This page has no text Passclip can read. It may need you to sign in. " + Self.viaSafari
        }
    }
}

/// Opens a web link from this iPhone, the way Safari would, and reads what's there. The page goes
/// nowhere else; only the pass details found in it reach your Passclip server for the preview.
enum LinkFetcher {
    /// The text is nothing but one web link, which is what "Copy Link" gives.
    static func link(in text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 2_000, !trimmed.contains(where: \.isWhitespace),
              let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host, host.contains(".") else { return nil }
        return url
    }

    static func open(_ url: URL) async throws -> ReadDocument {
        guard url.scheme?.lowercased() == "https" else { throw LinkError.insecure }
        let (data, response) = try await download(url)
        var document: ReadDocument
        if DocumentReader.isPDF(data) || UIImage(data: data) != nil {
            document = try await DocumentReader.read(data)
        } else {
            let page = HTMLText.extract(decode(data, response))
            guard page.text.filter({ $0.isLetter || $0.isNumber }).count >= 40 else { throw LinkError.noText }
            document = ReadDocument(text: String(page.text.prefix(64 * 1024)), links: LinkFinder.links(in: decode(data, response)),
                                    source: DocumentSource(kind: "webpage", name: page.title ?? url.host))
        }
        // The link the person opened comes first: it is the original.
        document.links.removeAll { $0.url == url.absoluteString }
        if url.absoluteString.count <= 2_000 { document.links.insert(FoundLink(title: "Original ticket", url: url.absoluteString), at: 0) }
        if document.source.name == nil { document.source.name = url.host }
        return document
    }

    private static func download(_ url: URL) async throws -> (Data, URLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 45
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url)
        request.setValue("application/pdf, text/html;q=0.9, image/*;q=0.8, */*;q=0.5", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw LinkError.failed }
            if http.statusCode == 401 || http.statusCode == 403 { throw LinkError.needsSignIn }
            guard (200..<300).contains(http.statusCode) else { throw LinkError.failed }
            guard data.count <= DocumentReader.maxBytes else { throw LinkError.tooLarge }
            // A redirect to a sign-in page reads as a page with no ticket in it.
            if let final = response.url?.absoluteString.lowercased(), final != url.absoluteString.lowercased(),
               ["login", "signin", "sign-in", "sso", "/auth"].contains(where: { final.contains($0) }) { throw LinkError.needsSignIn }
            return (data, response)
        } catch let error as LinkError {
            throw error
        } catch {
            throw LinkError.failed
        }
    }

    private static func decode(_ data: Data, _ response: URLResponse) -> String {
        if let name = response.textEncodingName {
            let encoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
            if encoding != kCFStringEncodingInvalidId,
               let text = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(encoding))) { return text }
        }
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }
}

/// Plain text from a web page: no scripts, styles or tags, with lines where the page has them.
enum HTMLText {
    static func extract(_ html: String) -> (text: String, title: String?) {
        let title = firstMatch(#"<title[^>]*>(.*?)</title>"#, in: html).map { collapse(decode($0)) }.flatMap { $0.isEmpty ? nil : String($0.prefix(120)) }
        var text = html
        for pattern in [#"<!--.*?-->"#, #"<(script|style|head|svg|noscript)\b.*?</\1\s*>"#] {
            text = text.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
        }
        text = text.replacingOccurrences(of: #"<br\s*/?>|</(p|div|tr|li|ul|ol|table|section|article|header|footer|h[1-6])\s*>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(of: #"</(td|th)\s*>"#, with: "  ", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let lines = decode(text).components(separatedBy: .newlines).map(collapse).filter { !$0.isEmpty }
        return (lines.joined(separator: "\n"), title)
    }

    private static func collapse(_ text: String) -> String {
        text.replacingOccurrences(of: "[ \t\u{00A0}]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    private static let named = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "copy": "©", "ndash": "–", "mdash": "—",
                                "hellip": "…", "rsquo": "’", "lsquo": "‘", "ldquo": "“", "rdquo": "”", "middot": "·", "bull": "•"]

    static func decode(_ text: String) -> String {
        guard text.contains("&"), let regex = try? NSRegularExpression(pattern: #"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);"#) else { return text }
        var result = text
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let whole = Range(match.range, in: result), let inner = Range(match.range(at: 1), in: result) else { continue }
            let entity = String(result[inner])
            var replacement: String?
            if entity.hasPrefix("#x") || entity.hasPrefix("#X") { replacement = UInt32(entity.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String($0) } }
            else if entity.hasPrefix("#") { replacement = UInt32(entity.dropFirst()).flatMap(Unicode.Scalar.init).map { String($0) } }
            else { replacement = named[entity.lowercased()] }
            if let replacement { result.replaceSubrange(whole, with: replacement) }
        }
        return result
    }
}
