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
    }

    static func read(_ documents: [ReadDocument], progress: @MainActor (Int, Int) -> Void) async throws -> Outcome {
        var passes: [JSONValue] = []
        var warnings: [String] = []
        var codes: [Int: FoundCode] = [:]
        var skipped = 0
        for (index, document) in documents.prefix(maxDocuments).enumerated() {
            await progress(index + 1, min(documents.count, maxDocuments))
            let context = ImportContext(source: document.source, links: [], hasCodes: !document.codes.isEmpty)
            guard let json = try? await EmailReader.extract(from: document.text, context: context),
                  let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
                  case .array(let found)? = value["passes"], !found.isEmpty else { skipped += 1; continue }
            if found.count == 1, document.codes.count == 1 { codes[passes.count] = document.codes[0] }
            passes.append(contentsOf: found)
            if case .array(let notes)? = value["warnings"] { warnings.append(contentsOf: notes.compactMap(\.string)) }
        }
        guard !passes.isEmpty else { throw EmailReaderError.nothingFound }
        var seen = Set<String>()
        let combined = JSONValue.object([
            "schemaVersion": .string("1.1"),
            "source": .object(["kind": .string("other"), "subject": .string("\(documents.count) documents")]),
            "passes": .array(passes),
            "warnings": .array(warnings.filter { seen.insert($0).inserted }.map(JSONValue.string)),
        ])
        return Outcome(json: String(decoding: try JSONEncoder().encode(combined), as: UTF8.self), codes: codes, skipped: skipped)
    }
}
