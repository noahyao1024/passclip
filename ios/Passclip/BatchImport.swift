import Foundation

/// Many tickets at once: each document (a screenshot or PDF) is read on this iPhone on its own, and the passes are
/// put together into one import. A document's barcode goes only on the pass made from that document, and only when
/// it gave exactly one pass and one code (CLAUDE.md rule 3: a real read from the person's own ticket).
enum BatchImport {
    static let maxDocuments = 20

    struct Outcome {
        var json: String
        /// Pass number → the code read from that pass's own document.
        var codes: [Int: FoundCode]
        /// Documents with no ticket in them.
        var skipped: Int
        /// How many documents were read, counting each ticket of a PDF that holds several.
        var total: Int
    }

    /// The documents to read, with a PDF holding several tickets split into one document per ticket.
    static func expand(_ documents: [ReadDocument]) -> [ReadDocument] {
        Array(documents.flatMap { $0.tickets.count > 1 ? $0.tickets : [$0] }.prefix(maxDocuments))
    }

    static func read(_ documents: [ReadDocument], progress: @MainActor (Int, Int) -> Void) async throws -> Outcome {
        let documents = expand(documents)
        var passes: [JSONValue] = []
        var warnings: [String] = []
        var codes: [Int: FoundCode] = [:]
        var skipped = 0
        for (index, document) in documents.enumerated() {
            await progress(index + 1, documents.count)
            let context = ImportContext(source: document.source, links: [], hasCodes: !document.codes.isEmpty, image: document.pageImage)
            guard let json = try? await EmailReader.extract(from: document.text, context: context),
                  let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
                  case .array(var found)? = value["passes"], !found.isEmpty else { skipped += 1; continue }
            if found.count == 1, document.codes.count == 1 {
                let code = document.codes[0]
                codes[passes.count] = code
                // Tickets in one order often differ only by their code. When the code's text is printed on the ticket
                // as its ticket number (like a media code), show it, so the passes can be told apart.
                if found[0]["ticketNumber"]?.string == nil, code.message.count <= 60,
                   code.message.range(of: #"^[A-Za-z0-9-]{6,}$"#, options: .regularExpression) != nil, document.text.contains(code.message),
                   found[0]["confirmationCode"]?.string != code.message {
                    found[0] = found[0].setting("ticketNumber", to: .string(code.message))
                }
            }
            passes.append(contentsOf: found)
            if case .array(let notes)? = value["warnings"] { warnings.append(contentsOf: notes.compactMap(\.string)) }
        }
        guard !passes.isEmpty else { throw EmailReaderError.nothingFound }
        var seen = Set<String>()
        let combined = JSONValue.object([
            "schemaVersion": .string("1.1"),
            "source": .object(["kind": .string("other"), "subject": .string("\(documents.count) tickets")]),
            "passes": .array(passes),
            "warnings": .array(warnings.filter { seen.insert($0).inserted }.map(JSONValue.string)),
        ])
        return Outcome(json: String(decoding: try JSONEncoder().encode(combined), as: UTF8.self), codes: codes, skipped: skipped, total: documents.count)
    }
}
