import AppIntents
import SwiftUI

/// "Make a pass with Passclip": from Siri, the Shortcuts app, or an automation (for example "when an email arrives
/// from my ticket seller"). The ticket can be text, a link, a PDF or a screenshot; Passclip opens and makes the pass.
struct MakePassIntent: AppIntent {
    static let title: LocalizedStringResource = "Make a pass"
    // Apple refuses Siri text that contains "Apple" (ITMS-90626), so it says "Wallet".
    static let description = IntentDescription("Turns a ticket email, link, PDF or screenshot into a Wallet pass.")
    static let openAppWhenRun = true

    // Any file: Passclip tells PDFs, pictures and text apart by their content (DocumentReader).
    @Parameter(title: "Ticket", description: "A PDF, a screenshot or a text file of the ticket.")
    var ticket: IntentFile?

    @Parameter(title: "Text", description: "The ticket email's text or a link, if you're not sharing a file.")
    var text: String?

    static var parameterSummary: some ParameterSummary { Summary("Make a pass from \(\.$ticket)") { \.$text } }

    @MainActor
    func perform() async throws -> some IntentResult {
        var incoming: Incoming?
        if let ticket {
            do { incoming = Incoming(try await DocumentReader.read(ticket.data, name: ticket.filename)) }
            catch { incoming = Incoming(problem: error.localizedDescription) }
        } else if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            incoming = Incoming(text: text)
        }
        PendingInput.shared.incoming = incoming
        return .result()
    }
}

struct PassclipShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: MakePassIntent(), phrases: ["Make a pass with \(.applicationName)", "Add a ticket to \(.applicationName)", "Make a Wallet pass with \(.applicationName)"],
                    shortTitle: "Make a pass", systemImageName: "wallet.pass")
    }
}
