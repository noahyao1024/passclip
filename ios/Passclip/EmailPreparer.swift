import Foundation

/// Gets an email ready for the on-device model, whose context is small (4K tokens, 8K on newer iPhones
/// in iOS 27.0; docs/DECISIONS.md D22). It removes what never holds ticket details (quoted replies, long
/// tracking links, blank runs, repeats) and, if the email is still too long, drops the longest paragraphs
/// without numbers first: legal text and marketing, not dates, times and codes.
enum EmailPreparer {
    static func prepare(_ raw: String, maxCharacters: Int) -> String {
        var text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        text = text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix(">") }
            .joined(separator: "\n")
        text = text.replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"[ \t\u{00A0}]+"#, with: " ", options: .regularExpression)

        var seen = Set<String>()
        var paragraphs: [String] = []
        for block in text.replacingOccurrences(of: #"\n\s*\n"#, with: "\n\n", options: .regularExpression).components(separatedBy: "\n\n") {
            let paragraph = block.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "\n")
            guard paragraph.contains(where: { $0.isLetter || $0.isNumber }), seen.insert(paragraph).inserted else { continue }
            paragraphs.append(paragraph)
        }

        func joined(_ kept: [String?]) -> String { kept.compactMap { $0 }.joined(separator: "\n\n") }
        var kept: [String?] = paragraphs
        var length = joined(kept).count
        if length > maxCharacters {
            // Longest paragraphs without any digit go first.
            let order = paragraphs.indices
                .filter { !paragraphs[$0].contains(where: \.isNumber) }
                .sorted { paragraphs[$0].count > paragraphs[$1].count }
            for index in order where length > maxCharacters {
                length -= paragraphs[index].count + 2
                kept[index] = nil
            }
        }
        let result = joined(kept)
        return result.count > maxCharacters ? String(result.prefix(maxCharacters)) : result
    }
}
