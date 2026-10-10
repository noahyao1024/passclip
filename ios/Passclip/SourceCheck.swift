import Foundation

/// The model has to copy names, codes and numbers from the text it reads. This checks every copy
/// against that text: a near miss is repaired from the text (a dropped character in a name), and a
/// value that isn't in the text at all is left out and reported, so a slip can't become a wrong
/// booking number or name on a pass. Dates and times are written differently from the text, so
/// the person still checks those (the "Check every detail" warning).
enum SourceCheck {
    struct Outcome {
        var passes: [ExtractedPass]
        var warnings: [String]
    }

    static func apply(to passes: [ExtractedPass], source: String) -> Outcome {
        let checker = Checker(source: source)
        var warnings: [String] = []
        let checked = passes.map { checker.check($0, warnings: &warnings) }
        var seen = Set<String>()
        return Outcome(passes: checked, warnings: warnings.filter { seen.insert($0).inserted })
    }

    /// Lowercase, no accents, one kind of quote and dash, single spaces.
    static func normalize(_ text: String) -> String {
        var result = text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
        result = result.replacingOccurrences(of: "[‘’‛ʼ`´]", with: "'", options: .regularExpression)
        result = result.replacingOccurrences(of: "[“”„]", with: "\"", options: .regularExpression)
        result = result.replacingOccurrences(of: "[‐-―]", with: "-", options: .regularExpression)
        result = result.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return result.trimmingCharacters(in: .whitespaces)
    }

    /// Only letters and numbers, so "1004-9407 71101" and "100494077 1101" match.
    static func compact(_ text: String) -> String { normalize(text).filter { $0.isLetter || $0.isNumber } }

    /// 1 for identical text, 0 for nothing in common.
    static func similarity(_ a: [Character], _ b: [Character]) -> Double {
        if a.isEmpty || b.isEmpty { return 0 }
        var previous = Array(0...b.count)
        for i in 1...a.count {
            var current = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count {
                current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
            }
            previous = current
        }
        return 1 - Double(previous[b.count]) / Double(max(a.count, b.count))
    }

    /// Notes that say something: not a timestamp or a web address, which models sometimes pick when a document has no rules.
    static func usefulNotes(_ notes: String?) -> String? {
        guard let notes = ImportJSONBuilder.clean(notes) else { return nil }
        let withoutLinks = notes.replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
        return withoutLinks.filter(\.isLetter).count >= 12 ? notes : nil
    }

    private struct Checker {
        let plain: String
        let compact: String
        let lines: [(text: String, key: [Character])]

        init(source: String) {
            plain = SourceCheck.normalize(source)
            compact = plain.filter { $0.isLetter || $0.isNumber }
            lines = source.components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && $0.count <= 300 }
                .map { ($0, Array(SourceCheck.normalize($0))) }
        }

        /// The line of the text that this value is a near miss of, if there is one.
        func repair(_ value: String) -> String? {
            let key = Array(SourceCheck.normalize(value))
            guard key.count >= 4 else { return nil }
            var best: (score: Double, text: String)?
            for line in lines {
                let length = Double(line.key.count)
                guard length >= Double(key.count) * 0.7, length <= Double(key.count) * 1.4 else { continue }
                let score = SourceCheck.similarity(key, line.key)
                if score >= 0.85, score > (best?.score ?? 0) { best = (score, line.text) }
            }
            return best?.text
        }

        func has(_ value: String) -> Bool { plain.contains(SourceCheck.normalize(value)) }
        func hasCode(_ value: String) -> Bool {
            let key = SourceCheck.compact(value)
            return key.isEmpty || compact.contains(key)
        }

        /// A name or phrase: kept, repaired from the text, or left out.
        func name(_ value: String?, _ label: String, _ warnings: inout [String]) -> String? {
            guard let value = ImportJSONBuilder.clean(value) else { return nil }
            if has(value) { return value }
            if let line = repair(value) { return line }
            warnings.append("Couldn't find the \(label) “\(value)” in your document, so it was left out.")
            return nil
        }

        /// A code or number: kept only if it's in the text, ignoring spaces and dashes.
        func code(_ value: String?, _ label: String, _ warnings: inout [String]) -> String? {
            guard let value = ImportJSONBuilder.clean(value) else { return nil }
            if hasCode(value) { return value }
            warnings.append("Couldn't find the \(label) “\(value)” in your document, so it was left out.")
            return nil
        }

        func check(_ original: ExtractedPass, warnings: inout [String]) -> ExtractedPass {
            var pass = original
            // A route is written by the model from several places, so only other titles are copies.
            if pass.type != "boardingPass", let title = ImportJSONBuilder.clean(pass.title) {
                if has(title) { pass.title = title }
                else if let line = repair(title) { pass.title = line }
                else { warnings.append("Check the title: it doesn't match your document word for word.") }
            }
            pass.shortTitle = groundedShortTitle(pass.shortTitle, title: pass.title)
            pass.organization = name(pass.organization, "organizer", &warnings)
            pass.holderName = name(pass.holderName, "name", &warnings)
            pass.venueName = name(pass.venueName, "venue", &warnings)
            pass.venueAddress = name(pass.venueAddress, "address", &warnings)
            pass.confirmationCode = code(pass.confirmationCode, "booking number", &warnings)
            pass.seatSection = code(pass.seatSection, "section", &warnings)
            pass.seatRow = code(pass.seatRow, "row", &warnings)
            pass.seatNumber = code(pass.seatNumber, "seat", &warnings)
            pass.seatEntrance = code(pass.seatEntrance, "entrance", &warnings)
            pass.number = code(pass.number, "number", &warnings)
            pass.fromCode = code(pass.fromCode, "departure code", &warnings)
            pass.toCode = code(pass.toCode, "arrival code", &warnings)
            pass.gate = code(pass.gate, "gate", &warnings)
            pass.notes = SourceCheck.usefulNotes(pass.notes)
            return pass
        }

        /// A short title is only used when its words come from the full title.
        func groundedShortTitle(_ short: String?, title: String) -> String? {
            guard let short = ImportJSONBuilder.clean(short), short.count >= 3, short.count < title.count else { return nil }
            let key = SourceCheck.normalize(title)
            if key.contains(SourceCheck.normalize(short)) { return short }
            func words(_ text: String) -> [String] { SourceCheck.normalize(text).split { !$0.isLetter && !$0.isNumber }.map(String.init) }
            let known = Set(words(title))
            let used = words(short)
            return !used.isEmpty && used.allSatisfy(known.contains) ? short : nil
        }
    }
}
