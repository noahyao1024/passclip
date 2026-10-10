import Foundation

/// What Apple's on-device AI found in an email, as plain values. There are deliberately no barcode
/// fields: a code comes only from a real scan of an image that the person chooses (CLAUDE.md rule 3).
struct ExtractedPass: Equatable {
    var type = "generic"
    var title = ""
    /// A shorter form of the title, copied from it, for the small space on a pass.
    var shortTitle: String?
    var organization: String?
    var confirmationCode: String?
    var holderName: String?
    /// Local time at the place, like 2026-10-10T19:30.
    var start: String?
    var end: String?
    /// IANA zone, like Asia/Singapore.
    var timeZone: String?
    var venueName: String?
    var venueCity: String?
    var venueAddress: String?
    var seatCategory: String?
    var seatSection: String?
    var seatRow: String?
    var seatNumber: String?
    var transitMode: String?
    var carrier: String?
    var number: String?
    var fromCode: String?
    var fromCity: String?
    var toCode: String?
    var toCity: String?
    var gate: String?
    var notes: String?
}

/// What the pass should say about where it came from, beyond the AI's own findings.
struct ImportContext {
    var source = DocumentSource()
    /// Links the person chose to put on the back of the pass.
    var links: [FoundLink] = []
    /// A barcode was read from the document, so the "add it yourself" reminder isn't needed.
    var hasCodes = false
}

/// Turns what the AI found into Passclip's import JSON (schema 1.1). The server still validates and
/// normalizes it like any pasted reply, so this only has to be careful, not complete: anything unclear
/// is left out rather than guessed.
enum ImportJSONBuilder {
    static let passTypes: Set<String> = ["eventTicket", "boardingPass", "storeCard", "coupon", "generic"]
    static let transitModes: Set<String> = ["air", "train", "bus", "boat", "other"]
    static let aiWarning = "Read by Apple Intelligence on this iPhone. Check every detail against your email."
    static let barcodeWarning = "The barcode isn't included. Add it from a screenshot of your ticket."

    /// Returns nil when nothing usable was found.
    static func json(from extracted: [ExtractedPass], context: ImportContext = ImportContext(), extraWarnings: [String] = []) -> String? {
        var warnings = extraWarnings
        let passes = extracted.compactMap { node(for: $0, links: context.links, warnings: &warnings) }
        guard !passes.isEmpty else { return nil }
        warnings.append(aiWarning)
        if !context.hasCodes { warnings.append(barcodeWarning) }
        var source: [(String, Node)] = [("kind", .string(context.source.kind))]
        add(&source, "subject", clean(context.source.name).map { String($0.prefix(200)) })
        return Node.object([
            ("schemaVersion", .string("1.1")),
            ("source", .object(source)),
            ("passes", .array(passes)),
            ("warnings", .array(warnings.map(Node.string))),
        ]).render()
    }

    // MARK: Passes

    private static func node(for item: ExtractedPass, links: [FoundLink], warnings: inout [String]) -> Node? {
        let organization = clean(item.organization)
        guard let fullTitle = clean(item.title) ?? organization else { return nil }
        // Wallet cuts long titles off. Use the model's short title when it has one, else trim this one.
        let title = fullTitle.count <= titleLimit ? fullTitle
            : (clean(item.shortTitle).flatMap { $0.count <= titleLimit ? $0 : nil } ?? shortTitle(fullTitle, city: clean(item.venueCity)))

        var type = passTypes.contains(item.type) ? item.type : "generic"
        var transit: Node?
        if type == "boardingPass" {
            transit = transitNode(for: item)
            if transit == nil {
                type = "generic"
                warnings.append("Couldn't read the route for “\(title)”, so it's a plain pass.")
            }
        }

        var fields: [(String, Node)] = [("type", .string(type)), ("title", .string(title))]
        add(&fields, "organization", organization)
        add(&fields, "confirmationCode", clean(item.confirmationCode))
        add(&fields, "holderName", clean(item.holderName).map { $0.replacingOccurrences(of: #"(\s+[.,;:·]+)+$"#, with: "", options: .regularExpression) })

        let start = localTime(item.start), end = localTime(item.end)
        if clean(item.start) != nil && start == nil { warnings.append("Couldn't read the date or time for “\(title)”, so it was left out.") }
        add(&fields, "start", start)
        add(&fields, "end", start == nil ? nil : end)
        // The place usually says the zone: "Singapore" is Asia/Singapore. Without it, the app asks.
        let place = type == "boardingPass" ? item.fromCity : item.venueCity
        add(&fields, "timeZone", start == nil ? nil : zone(item.timeZone) ?? zone(forCity: place))

        let venueName = clean(item.venueName) ?? clean(item.venueAddress) ?? clean(item.venueCity)
        if let venueName {
            var venue: [(String, Node)] = [("name", .string(venueName))]
            if clean(item.venueName) != nil { add(&venue, "address", clean(item.venueAddress)) }
            add(&venue, "city", clean(item.venueCity) == venueName ? nil : clean(item.venueCity))
            fields.append(("venue", .object(venue)))
        }

        var seat: [(String, Node)] = []
        add(&seat, "section", clean(item.seatSection))
        add(&seat, "row", clean(item.seatRow))
        add(&seat, "number", clean(item.seatNumber))
        add(&seat, "description", clean(item.seatCategory))
        if !seat.isEmpty { fields.append(("seat", .object(seat))) }

        if let transit { fields.append(("transit", transit)) }
        var notes = clean(item.notes)
        if title != fullTitle { notes = ["Full name: \(fullTitle)", notes].compactMap { $0 }.joined(separator: "\n") }
        add(&fields, "notes", notes)
        if !links.isEmpty {
            fields.append(("attachments", .array(links.map { .object([("title", .string(String($0.title.prefix(60)))), ("url", .string($0.url)), ("kind", .string("link"))]) })))
        }
        return .object(fields)
    }

    private static func transitNode(for item: ExtractedPass) -> Node? {
        func stop(code: String?, city: String?) -> Node? {
            var fields: [(String, Node)] = []
            add(&fields, "code", clean(code))
            add(&fields, "city", clean(city))
            return fields.isEmpty ? nil : .object(fields)
        }
        guard let from = stop(code: item.fromCode, city: item.fromCity), let to = stop(code: item.toCode, city: item.toCity) else { return nil }
        let mode = clean(item.transitMode).flatMap { transitModes.contains($0) ? $0 : nil } ?? "other"
        var fields: [(String, Node)] = [("mode", .string(mode))]
        add(&fields, "carrier", clean(item.carrier))
        add(&fields, "number", clean(item.number))
        fields.append(("from", from))
        fields.append(("to", to))
        add(&fields, "gate", clean(item.gate))
        return .object(fields)
    }

    // MARK: Values

    static let titleLimit = 60

    /// Wallet cuts long titles with "…", so keep it short: drop a trailing "in <city>", then cut at a word.
    static func shortTitle(_ title: String, city: String?) -> String {
        var text = title
        if let city, text.count > titleLimit {
            for joiner in [" in ", " at ", " - ", " – "] where text.lowercased().hasSuffix(joiner + city.lowercased()) {
                text = String(text.dropLast(joiner.count + city.count))
            }
        }
        guard text.count > titleLimit else { return text }
        let cut = String(text.prefix(titleLimit))
        let words = cut.split(separator: " ", omittingEmptySubsequences: true)
        let endsOnWord = cut.hasSuffix(" ") || text.dropFirst(titleLimit).first == " "
        let kept = words.count > 1 && !endsOnWord ? words.dropLast().joined(separator: " ") : words.joined(separator: " ")
        return kept.trimmingCharacters(in: CharacterSet(charactersIn: " -–,&")) + "…"
    }

    private static let empties: Set<String> = ["n/a", "na", "null", "none", "unknown", "-", "—", "not provided", "not specified", "not available"]

    /// Trimmed text, or nil when it's empty or one of the placeholders models like to write instead of leaving a field out.
    static func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || empties.contains(text.lowercased()) ? nil : text
    }

    /// "2026-10-10T19:30" (or with seconds or an offset), only when it's a real date and time.
    static func localTime(_ value: String?) -> String? {
        guard var text = clean(value) else { return nil }
        // "2026-10-10 19:30" is the same moment with a space where the schema wants a T.
        if text.range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}"#, options: .regularExpression) != nil {
            text = text.replacingCharacters(in: text.index(text.startIndex, offsetBy: 10)..<text.index(text.startIndex, offsetBy: 11), with: "T")
        }
        let pattern = #"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:(\d{2}))?(Z|[+-]\d{2}:\d{2})?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        func number(_ group: Int) -> Int? { Range(match.range(at: group), in: text).flatMap { Int(text[$0]) } }
        guard let year = number(1), let month = number(2), let day = number(3), let hour = number(4), let minute = number(5),
              hour < 24, minute < 60,
              DateComponents(calendar: Calendar(identifier: .gregorian), year: year, month: month, day: day).isValidDate else { return nil }
        let hasSeconds = match.range(at: 7).location != NSNotFound
        let hasZone = match.range(at: 8).location != NSNotFound
        return hasSeconds || hasZone ? text : text + ":00"
    }

    /// "Singapore" gives Asia/Singapore, when exactly one zone is named for the city.
    static func zone(forCity city: String?) -> String? {
        func key(_ text: String) -> String { text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).replacingOccurrences(of: "_", with: " ") }
        guard let wanted = clean(city).map(key) else { return nil }
        let matches = TimeZone.knownTimeZoneIdentifiers.filter { id in id.contains("/") && id.split(separator: "/").last.map { key(String($0)) } == wanted }
        return matches.count == 1 ? matches[0] : nil
    }

    static func zone(_ value: String?) -> String? {
        guard let text = clean(value), text.range(of: #"^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$"#, options: .regularExpression) != nil,
              TimeZone(identifier: text) != nil else { return nil }
        return text
    }

    private static func add(_ fields: inout [(String, Node)], _ key: String, _ value: String?) {
        if let value { fields.append((key, .string(value))) }
    }

    // MARK: Writing

    /// JSON with the keys in a readable order (a Dictionary would sort them alphabetically).
    private indirect enum Node {
        case string(String)
        case object([(String, Node)])
        case array([Node])

        func render(_ depth: Int = 0) -> String {
            let inner = String(repeating: "  ", count: depth + 1), outer = String(repeating: "  ", count: depth)
            switch self {
            case .string(let text): return Node.quote(text)
            case .object(let pairs):
                return "{\n" + pairs.map { inner + Node.quote($0.0) + ": " + $0.1.render(depth + 1) }.joined(separator: ",\n") + "\n" + outer + "}"
            case .array(let items):
                return items.isEmpty ? "[]" : "[\n" + items.map { inner + $0.render(depth + 1) }.joined(separator: ",\n") + "\n" + outer + "]"
            }
        }

        private static func quote(_ text: String) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: text, options: [.fragmentsAllowed, .withoutEscapingSlashes]) else { return "\"\"" }
            return String(decoding: data, as: UTF8.self)
        }
    }
}

/// Tells an AI reply (JSON) from a pasted email.
enum ImportDetector {
    static func looksLikeImportJSON(_ text: String) -> Bool {
        text.contains("\"passes\"") || text.contains("\"schemaVersion\"")
    }
}
