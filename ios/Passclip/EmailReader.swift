import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Whether this iPhone can read an email with Apple's on-device model.
enum EmailReaderStatus: Equatable {
    case ready
    /// A plain-English reason that says what to do next.
    case unavailable(String)

    var isReady: Bool { self == .ready }
}

enum EmailReaderError: LocalizedError {
    case nothingFound
    case failed(String)
    var errorDescription: String? {
        switch self {
        case .nothingFound: return "Passclip couldn't find a ticket, booking or card in this text. Paste the whole email, or use the AI-chat steps."
        case .failed(let message): return message
        }
    }
}

/// Reads a pasted email with Apple's on-device model (free, private, works offline) and returns
/// Passclip import JSON. The email never leaves the iPhone; only the pass details found in it go
/// to the Passclip server for the preview. No barcode is ever read or made up here (CLAUDE.md rule 3).
enum EmailReader {
    static var status: EmailReaderStatus {
        #if DEBUG
        if ProcessInfo.processInfo.environment["PASSCLIP_FAKE_AI"] == "1" { return .ready }
        #endif
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) { return status(for: SystemLanguageModel.default.availability) }
        #endif
        return .unavailable("Reading emails needs iOS 26 or later with Apple Intelligence. Use the AI-chat steps below instead.")
    }

    static func extract(from email: String, context: ImportContext = ImportContext()) async throws -> String {
        #if DEBUG
        if ProcessInfo.processInfo.environment["PASSCLIP_FAKE_AI"] == "1" {
            try await Task.sleep(for: .seconds(1))
            guard let json = ImportJSONBuilder.json(from: [DebugSample.ticket], context: context) else { throw EmailReaderError.nothingFound }
            return json
        }
        #endif
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            do {
                let found = try await OnDeviceExtractor.extract(from: email)
                // Every copied name and number must be in the text; see SourceCheck.
                let checked = SourceCheck.apply(to: found, source: email)
                guard let json = ImportJSONBuilder.json(from: checked.passes, context: context, extraWarnings: checked.warnings) else { throw EmailReaderError.nothingFound }
                return json
            } catch let error as EmailReaderError {
                throw error
            } catch {
                // Never log the error: it can echo the email.
                throw EmailReaderError.failed(OnDeviceExtractor.message(for: error))
            }
        }
        #endif
        throw EmailReaderError.failed("Reading emails needs iOS 26 or later with Apple Intelligence.")
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    static func status(for availability: SystemLanguageModel.Availability) -> EmailReaderStatus {
        switch availability {
        case .available:
            return .ready
        case .unavailable(.deviceNotEligible):
            return .unavailable("This iPhone can't run Apple Intelligence, so Passclip can't read emails itself. Use the AI-chat steps below instead.")
        case .unavailable(.appleIntelligenceNotEnabled):
            return .unavailable("Turn on Apple Intelligence in Settings, then Passclip can read your ticket emails on this iPhone.")
        case .unavailable(.modelNotReady):
            return .unavailable("Apple Intelligence is still getting ready on this iPhone. It downloads in the background, so try again in a few minutes.")
        case .unavailable:
            return .unavailable("Apple Intelligence isn't available right now. Use the AI-chat steps below instead.")
        }
    }
    #endif
}

#if DEBUG
/// For screenshots and manual checks of the screens, when launched with PASSCLIP_FAKE_AI=1.
enum DebugSample {
    static let ticket = ExtractedPass(
        type: "eventTicket", title: "Deyun Club’s 30th Anniversary Cross Talk Show featuring Yue Yunpeng and Sun Yue - Singapore",
        organization: "MAISEAT", confirmationCode: "1004940771101", start: "2026-10-10T19:30", timeZone: "Asia/Singapore",
        venueName: "Resorts World Convention Centre", venueCity: "Singapore", seatCategory: "CAT 2",
        notes: "Tickets are non-refundable and non-exchangeable. One ticket per person is required."
    )
}
#endif

#if canImport(FoundationModels)

// MARK: The model's answer, as guided generation

@available(iOS 26.0, *)
@Generable(description: "Everything in an email that could become a Wallet pass")
struct GeneratedEmail {
    @Guide(description: "One entry per ticket, person or travel leg. Empty when the email has no ticket, booking, membership or coupon.", .maximumCount(4))
    var passes: [GeneratedPass]
}

@available(iOS 26.0, *)
@Generable(description: "One ticket, booking, card or coupon, with only what the email says")
struct GeneratedPass {
    @Guide(description: "eventTicket for concerts, shows, movies, sports and exhibitions; boardingPass for flights, trains, buses and ferries; storeCard for memberships and loyalty cards; coupon for offers; generic for anything else", .anyOf(["eventTicket", "boardingPass", "storeCard", "coupon", "generic"]))
    var type: String
    @Guide(description: "Event name or route, copied from the email. If it is written in several languages, copy the first one only.")
    var title: String
    @Guide(description: "A short version of the title for a small space: 2 to 6 words copied from the title, without the city or year. Empty when the title is already short.")
    var shortTitle: String?
    @Guide(description: "Ticket seller, airline or organizer, like SISTIC or Ticketmaster")
    var organization: String?
    @Guide(description: "Order, booking, confirmation, reference or transaction number")
    var confirmationCode: String?
    @Guide(description: "Ticket holder or passenger name")
    var holderName: String?
    @Guide(description: "Start or departure, local time at the place, written YYYY-MM-DDTHH:mm. Empty when the email gives no date or no time.")
    var start: String?
    @Guide(description: "End or arrival, same format. Usually empty.")
    var end: String?
    @Guide(description: "IANA time zone of the place, like Asia/Singapore. Fill it whenever the venue's city or country is known.")
    var timeZone: String?
    var venueName: String?
    @Guide(description: "City of the venue. If it isn't written separately, take it from the event name or address, like Singapore")
    var venueCity: String?
    var venueAddress: String?
    @Guide(description: "Seat category such as CAT 2, Gold or Balcony")
    var seatCategory: String?
    var seatSection: String?
    var seatRow: String?
    var seatNumber: String?
    @Guide(description: "For boardingPass only", .anyOf(["air", "train", "bus", "boat", "other"]))
    var transitMode: String?
    var carrier: String?
    @Guide(description: "Flight or train number, like NH 7")
    var number: String?
    @Guide(description: "Departure airport or station code, like HND")
    var fromCode: String?
    var fromCity: String?
    var toCode: String?
    var toCity: String?
    var gate: String?
    @Guide(description: "Entry rules, refund terms or what to bring, only if the email states them, in at most three short sentences. Leave empty if there are none. Never a date, time or web address.")
    var notes: String?

    var extracted: ExtractedPass {
        ExtractedPass(
            type: type, title: title, shortTitle: shortTitle, organization: organization, confirmationCode: confirmationCode, holderName: holderName,
            start: start, end: end, timeZone: timeZone, venueName: venueName, venueCity: venueCity, venueAddress: venueAddress,
            seatCategory: seatCategory, seatSection: seatSection, seatRow: seatRow, seatNumber: seatNumber,
            transitMode: transitMode, carrier: carrier, number: number, fromCode: fromCode, fromCity: fromCity,
            toCode: toCode, toCity: toCity, gate: gate, notes: notes
        )
    }
}

// MARK: Running the model

@available(iOS 26.0, *)
enum OnDeviceExtractor {
    private static let instructions = """
    You read ticket, booking and membership emails and fill in the fields.
    - Copy names, places, codes and numbers exactly as written, in the email's own language. Never translate or invent anything.
    - If a name is written in more than one language, copy only the first one.
    - Leave a field empty when the email doesn't say. Never guess.
    - Write times as local time at the place: YYYY-MM-DDTHH:mm.
    - Never write barcode or QR code data.
    - One entry per ticket or travel leg. Ignore ads and legal text.
    """

    /// Room kept for the answer, in tokens.
    private static let answerTokens = 1_100

    static func extract(from email: String) async throws -> [ExtractedPass] {
        let model = SystemLanguageModel.default
        let today = Date.now.formatted(.iso8601.year().month().day())
        // The person's language decides which one to copy when a name is written in several.
        let language = Locale(identifier: "en").localizedString(forLanguageCode: Locale.current.language.languageCode?.identifier ?? "en") ?? "English"
        let fullInstructions = instructions + "\nThe person reads \(language). If a name is written in several languages, copy the \(language) one when there is one, and otherwise the first.\nToday is \(today)."
        let prompt = try await fitPrompt(for: email, instructions: fullInstructions, model: model)

        let session = LanguageModelSession(model: model, instructions: fullInstructions)
        var options = GenerationOptions()
        options.temperature = 0
        let response = try await session.respond(to: prompt, generating: GeneratedEmail.self, options: options)
        return response.content.passes.map(\.extracted)
    }

    /// Trims the email until instructions, answer format, email and answer all fit the model's context.
    private static func fitPrompt(for email: String, instructions: String, model: SystemLanguageModel) async throws -> String {
        let context = model.contextSize
        // About two characters per token is safe for English and for Chinese, Japanese and Korean alike.
        var limit = max(1_200, (context - answerTokens - 600) * 2)
        guard #available(iOS 26.4, *) else { return prompt(EmailPreparer.prepare(email, maxCharacters: min(limit, 3_500))) }

        let fixed = try await model.tokenCount(for: Instructions(instructions)) + model.tokenCount(for: GeneratedEmail.generationSchema)
        var text = prompt(EmailPreparer.prepare(email, maxCharacters: limit))
        for _ in 0..<5 {
            let used = try await model.tokenCount(for: Prompt(text))
            if fixed + used + answerTokens <= context { break }
            let room = max(200, context - fixed - answerTokens)
            limit = max(600, Int(Double(limit) * Double(room) / Double(max(used, 1)) * 0.9))
            text = prompt(EmailPreparer.prepare(email, maxCharacters: limit))
        }
        return text
    }

    private static func prompt(_ email: String) -> String { "Email:\n\(email)" }

    /// Plain-English text for a failure, without anything from the email. Errors are matched by case
    /// name so this builds on every iOS 26 SDK: iOS 27 renamed and moved the model's error types.
    static func message(for error: Error) -> String {
        let name = Mirror(reflecting: error).children.first?.label ?? String(describing: error)
        switch name {
        case "contextSizeExceeded", "exceededContextWindowSize": return tooLong
        case "guardrailViolation", "refusal": return declined
        case "unsupportedLanguageOrLocale": return language
        case "rateLimited", "concurrentRequests", "timeout": return busy
        default: return generic
        }
    }

    private static let tooLong = "This email is too long for the model on your iPhone. Select just the part with your ticket details, copy it and try again."
    private static let declined = "Apple Intelligence declined to read this text. Try selecting only the ticket details, or use the AI-chat steps."
    private static let language = "Apple Intelligence can't read this language with your iPhone's current language settings. Use the AI-chat steps instead."
    private static let busy = "Apple Intelligence is busy right now. Wait a moment and try again."
    private static let generic = "Apple Intelligence couldn't read this email. Try again, or use the AI-chat steps."
}
#endif
