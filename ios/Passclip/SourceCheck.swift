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

    /// `readerPrefersLatin`: the person doesn't read Chinese, Japanese or Korean, so a name the document gives
    /// in Latin letters is used instead of its Chinese form (the other form is kept in the pass notes).
    static func apply(to passes: [ExtractedPass], source: String, readerPrefersLatin: Bool = ReaderLanguage.prefersLatin) -> Outcome {
        let checker = Checker(source: source, readerPrefersLatin: readerPrefersLatin)
        var warnings: [String] = []
        let checked = passes.map { checker.check($0, warnings: &warnings) }
        var seen = Set<String>()
        return Outcome(passes: checked, warnings: warnings.filter { seen.insert($0).inserted })
    }

    /// Chinese characters in PDFs often come as Kangxi radicals (U+2F00 block) or compatibility ideographs. They look
    /// the same as the usual characters but aren't equal to them, so they are mapped to the usual ones.
    static func cleanCJK(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: { (0x2E80...0x2FDF).contains($0.value) || (0xF900...0xFAFF).contains($0.value) }) else { return text }
        var result = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if (0x2E80...0x2FDF).contains(scalar.value) || (0xF900...0xFAFF).contains(scalar.value) { result.append(contentsOf: String(scalar).precomposedStringWithCompatibilityMapping.unicodeScalars) }
            else { result.append(scalar) }
        }
        return String(result)
    }

    enum Script { case cjk, latin, other }

    /// The script most of a text's letters are in.
    static func script(of text: String) -> Script {
        var cjk = 0, latin = 0
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x3400...0x4DBF, 0x4E00...0x9FFF, 0x3040...0x30FF, 0xAC00...0xD7AF, 0x2E80...0x2FDF, 0xF900...0xFAFF: cjk += 1
            case 0x41...0x5A, 0x61...0x7A, 0xC0...0x24F: latin += 1
            default: break
            }
        }
        return cjk > latin ? .cjk : (latin > 0 ? .latin : .other)
    }

    /// Lowercase, no accents, one kind of quote and dash, single spaces.
    static func normalize(_ text: String) -> String {
        var result = cleanCJK(text).folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
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
        let readerPrefersLatin: Bool

        init(source: String, readerPrefersLatin: Bool) {
            self.readerPrefersLatin = readerPrefersLatin
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
            // A bilingual ticket: a reader of English gets the English name, and the Chinese one goes on the back.
            if readerPrefersLatin, pass.type != "boardingPass", SourceCheck.script(of: pass.title) == .cjk,
               let latin = ImportJSONBuilder.clean(pass.titleLatin), SourceCheck.script(of: latin) == .latin {
                let verified = has(latin) ? latin : repair(latin)
                if let verified { pass.alternateTitle = pass.title; pass.title = verified }
            }
            pass.shortTitle = groundedShortTitle(pass.shortTitle, title: pass.title)
            pass.organization = name(pass.organization, "organizer", &warnings)
            pass.holderName = name(pass.holderName, "name", &warnings)
            pass.venueName = name(pass.venueName, "venue", &warnings)
            pass.venueAddress = name(pass.venueAddress, "address", &warnings)
            pass.confirmationCode = code(pass.confirmationCode, "booking number", &warnings) ?? labeledBookingNumber()
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

        /// A booking number the model missed, read from a labeled line like "Transaction No. 20261005-001796" or a
        /// label on one line and the number on the next. Taken straight from the text, so nothing is guessed.
        func labeledBookingNumber() -> String? {
            let label = #"^(transaction|booking|order|confirmation|reservation|reference)\s*(no\.?|number|#|id|code|reference|ref\.?)?\s*[:：#]?\s*(.*)$"#
            guard let regex = try? NSRegularExpression(pattern: label, options: [.caseInsensitive]) else { return nil }
            let looksLikeCode = { (text: String) -> Bool in
                text.count >= 4 && text.count <= 30 && !text.contains(" ") && text.contains(where: \.isNumber)
            }
            for (index, line) in lines.enumerated() {
                let text = line.text
                guard let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
                      let rest = Range(match.range(at: 3), in: text) else { continue }
                let sameLine = String(text[rest]).trimmingCharacters(in: .whitespaces)
                if looksLikeCode(sameLine) { return sameLine }
                if sameLine.isEmpty, index + 1 < lines.count, looksLikeCode(lines[index + 1].text) { return lines[index + 1].text }
            }
            return nil
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

/// Which script the person reads, from the iPhone's first language.
enum ReaderLanguage {
    static var prefersLatin: Bool {
        let code = Locale.preferredLanguages.first.flatMap { Locale(identifier: $0).language.languageCode?.identifier } ?? "en"
        return !["zh", "ja", "ko"].contains(code)
    }
}
