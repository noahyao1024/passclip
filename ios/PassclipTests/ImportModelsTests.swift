import XCTest
import CoreImage
import UIKit
#if canImport(FoundationModels)
import FoundationModels
#endif
@testable import Passclip
final class ImportModelsTests: XCTestCase {
    func testSinglePassForwardingPreservesBarcodeAndOmitsPreviewMetadata() throws {
        let json = #"{"passes":[{"type":"generic","title":"Test","needsTimeZone":true,"barcode":{"format":"qr","message":"  EXACT Café 東京  "}}],"source":{"subject":"Ticket"}}"#
        let value = try JSONDecoder().decode(ImportedData.self, from: Data(json.utf8))
        let forwarded = try JSONDecoder().decode(JSONValue.self, from: Data(value.singlePassText(at: 0).utf8))
        guard case .array(let passes) = forwarded["passes"] else { return XCTFail("Expected passes") }
        XCTAssertEqual(passes[0]["barcode"]?["message"]?.string, "  EXACT Café 東京  ")
        XCTAssertNil(passes[0]["needsTimeZone"])
        XCTAssertEqual(forwarded["source"]?["subject"]?.string, "Ticket")
        XCTAssertThrowsError(try value.singlePassText(at: -1))
        XCTAssertThrowsError(try value.singlePassText(at: 1))
    }
    func testRejectsInsecureOrCredentialBearingServerURLs() {
        for address in ["http://server.example", "https://user:password@server.example", "https://server.example?secret=1", "not a URL"] { XCTAssertThrowsError(try PassclipService(server: address)) }
        XCTAssertNoThrow(try PassclipService(server: "https://server.example"))
    }
    func testJSONRoundTripPreservesAllSupportedValues() throws {
        let input = #"{"title":"Test","price":12.5,"flags":[true,false,null],"nested":{"x":"🎟"}}"#
        let decoded = try JSONDecoder().decode(JSONValue.self, from: Data(input.utf8))
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(decoded)), decoded)
    }
    func testChosenCodeGoesIntoThePassExactlyAndIsForwardedForSigning() throws {
        let json = #"{"passes":[{"type":"eventTicket","title":"Show","barcode":{"format":"qr","message":"OLD","altText":"Seat 12"}},{"type":"generic","title":"Other"}]}"#
        var value = try JSONDecoder().decode(ImportedData.self, from: Data(json.utf8))
        value.setBarcode(FoundCode(format: "qr", message: "OLD"), at: 0)
        XCTAssertEqual(value.passes[0]["barcode"]?["altText"]?.string, "Seat 12", "Same code keeps its text")
        value.setBarcode(FoundCode(format: "aztec", message: "  NEW 東京  "), at: 0)
        XCTAssertNil(value.passes[0]["barcode"]?["altText"], "A different code drops the old text")
        let forwarded = try JSONDecoder().decode(JSONValue.self, from: Data(value.singlePassText(at: 0).utf8))
        guard case .array(let passes) = forwarded["passes"] else { return XCTFail("Expected passes") }
        XCTAssertEqual(passes[0]["barcode"]?["message"]?.string, "  NEW 東京  ")
        XCTAssertEqual(passes[0]["barcode"]?["format"]?.string, "aztec")
        XCTAssertNil(value.passes[1]["barcode"], "Other passes are untouched")
    }
    func testReadsGeneratedCodesOnDevice() throws {
        #if targetEnvironment(simulator)
        // Vision's barcode reader needs real hardware: in the Simulator it fails ("Could not create
        // inference context") or finds nothing. The same calls were checked on a Mac (D21).
        throw XCTSkip("Vision barcode reading doesn't run in the Simulator; run this test on an iPhone.")
        #else
        for (filter, format, message) in [("CIQRCodeGenerator", "qr", "1004940771101-CAT2"), ("CICode128BarcodeGenerator", "code128", "R-55120")] {
            let generator = CIFilter(name: filter)!
            generator.setValue(Data(message.utf8), forKey: "inputMessage")
            let output = generator.outputImage!.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
            // A white margin around the code, like a real screenshot.
            let padded = output.composited(over: CIImage(color: .white).cropped(to: output.extent.insetBy(dx: -80, dy: -80)))
            let cgImage = CIContext().createCGImage(padded, from: padded.extent)!
            XCTAssertEqual(try BarcodeReader.read(UIImage(cgImage: cgImage)), [FoundCode(format: format, message: message)])
        }
        #endif
    }
}

final class EmailReadingTests: XCTestCase {
    private let maiseat = ExtractedPass(
        type: "eventTicket", title: "Deyun Club’s 30th Anniversary Cross Talk Show featuring Yue Yunpeng and Sun Yue - Singapore",
        organization: "MAISEAT", confirmationCode: "1004940771101", start: "2026-10-10T19:30", timeZone: "Asia/Singapore",
        venueName: "Resorts World Convention Centre", venueCity: "Singapore", seatCategory: "CAT 2",
        notes: "Tickets are non-refundable and non-exchangeable. One ticket per person is required."
    )

    private func object(_ json: String?) throws -> [String: Any] {
        let data = try XCTUnwrap(json).data(using: .utf8)!
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func firstPass(_ json: String?) throws -> [String: Any] {
        let passes = try XCTUnwrap(object(json)["passes"] as? [[String: Any]])
        return try XCTUnwrap(passes.first)
    }

    func testBuildsImportJSONForATicketAndMatchesTheGoldenFileTheWebTestsValidate() throws {
        let json = try XCTUnwrap(ImportJSONBuilder.json(from: [maiseat]))
        let url = try XCTUnwrap(Bundle(for: EmailReadingTests.self).url(forResource: "ai-ticket", withExtension: "json"))
        XCTAssertEqual(json, try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .newlines))
        let pass = try firstPass(json)
        XCTAssertEqual(pass["start"] as? String, "2026-10-10T19:30:00")
        XCTAssertEqual((pass["seat"] as? [String: String])?["description"], "CAT 2")
        XCTAssertNil(pass["barcode"], "The AI never supplies a barcode (CLAUDE.md rule 3)")
        XCTAssertEqual(try object(json)["schemaVersion"] as? String, "1.1")
        XCTAssertEqual((try object(json)["warnings"] as? [String])?.last, ImportJSONBuilder.barcodeWarning)
    }

    func testLeavesOutWhatItCannotTrustInsteadOfGuessing() throws {
        var item = maiseat
        item.start = "sometime in October"
        item.timeZone = "Mars/Olympus"
        item.confirmationCode = "N/A"
        item.venueCity = "  "
        let json = try XCTUnwrap(ImportJSONBuilder.json(from: [item]))
        let pass = try firstPass(json)
        XCTAssertNil(pass["start"]); XCTAssertNil(pass["timeZone"]); XCTAssertNil(pass["confirmationCode"])
        XCTAssertEqual((pass["venue"] as? [String: String])?["name"], "Resorts World Convention Centre")
        XCTAssertTrue((try object(json)["warnings"] as? [String] ?? []).contains { $0.contains("Couldn't read the date or time") })
    }

    func testReadsTimesWrittenInCommonWays() {
        XCTAssertEqual(ImportJSONBuilder.localTime("2026-10-10T19:30"), "2026-10-10T19:30:00")
        XCTAssertEqual(ImportJSONBuilder.localTime("2026-10-10 19:30"), "2026-10-10T19:30:00")
        XCTAssertEqual(ImportJSONBuilder.localTime("2026-10-10T19:30:15"), "2026-10-10T19:30:15")
        XCTAssertEqual(ImportJSONBuilder.localTime("2026-10-10T19:30+08:00"), "2026-10-10T19:30+08:00")
        for bad in ["2026-02-30T10:00", "2026-10-10", "2026-10-10T25:00", "10/10/2026 7:30 PM", "", nil] { XCTAssertNil(ImportJSONBuilder.localTime(bad), "\(bad ?? "nil")") }
        XCTAssertEqual(ImportJSONBuilder.zone("Asia/Singapore"), "Asia/Singapore")
        XCTAssertNil(ImportJSONBuilder.zone("Singapore time"))
    }

    func testBoardingPassNeedsARouteOtherwiseItBecomesAPlainPass() throws {
        var flight = ExtractedPass(type: "boardingPass", title: "ZQ 101", transitMode: "air", carrier: "Skylane Air", number: "ZQ 101", fromCode: "HND", fromCity: "Tokyo", toCode: "CDG", toCity: "Paris", gate: "112")
        flight.start = "2026-12-03T10:25"
        let pass = try firstPass(ImportJSONBuilder.json(from: [flight]))
        XCTAssertEqual(pass["type"] as? String, "boardingPass")
        let transit = try XCTUnwrap(pass["transit"] as? [String: Any])
        XCTAssertEqual(transit["mode"] as? String, "air")
        XCTAssertEqual((transit["from"] as? [String: String])?["code"], "HND")

        flight.fromCode = nil; flight.fromCity = nil
        let json = ImportJSONBuilder.json(from: [flight])
        XCTAssertEqual(try firstPass(json)["type"] as? String, "generic")
        XCTAssertNil(try firstPass(json)["transit"])
    }

    func testUnknownTypesBecomeGenericAndEmptyTitlesFallBackToTheOrganizer() throws {
        XCTAssertEqual(try firstPass(ImportJSONBuilder.json(from: [ExtractedPass(type: "ticket!", title: "Thing")]))["type"] as? String, "generic")
        XCTAssertEqual(try firstPass(ImportJSONBuilder.json(from: [ExtractedPass(title: " ", organization: "MAISEAT")]))["title"] as? String, "MAISEAT")
        XCTAssertNil(ImportJSONBuilder.json(from: [ExtractedPass(title: "", organization: nil)]))
        XCTAssertNil(ImportJSONBuilder.json(from: []))
    }

    func testTellsAnAIReplyFromAnEmail() {
        XCTAssertTrue(ImportDetector.looksLikeImportJSON(#"{ "schemaVersion": "1.1", "passes": [] }"#))
        XCTAssertTrue(ImportDetector.looksLikeImportJSON("```json\n{\"passes\": []}\n```"))
        XCTAssertFalse(ImportDetector.looksLikeImportJSON("Your order has been successfully placed! Order Number: 1004940771101"))
    }

    func testTrimsLongEmailsWithoutLosingTheDetails() {
        let details = "Order Number: 1004940771101\nEvent: Cross Talk Show\nDate: 10 Oct 2026, 7:30 PM\nVenue: Resorts World Convention Centre"
        let legal = String(repeating: "By purchasing you agree to the terms and conditions of sale, which apply to every order. ", count: 80)
        let email = """
        > old quoted reply with 12345
        \(details)

        See your tickets: https://tracking.example.com/click?id=\(String(repeating: "x", count: 300))

        \(legal)

        \(legal)

        Thanks for your order, see you at the show!
        """
        let prepared = EmailPreparer.prepare(email, maxCharacters: 600)
        XCTAssertLessThanOrEqual(prepared.count, 600)
        XCTAssertTrue(prepared.contains("Order Number: 1004940771101"))
        XCTAssertTrue(prepared.contains("Date: 10 Oct 2026, 7:30 PM"))
        XCTAssertFalse(prepared.contains("http"))
        XCTAssertFalse(prepared.contains("old quoted reply"))
        XCTAssertFalse(prepared.contains("terms and conditions"))
        XCTAssertEqual(EmailPreparer.prepare("  Hello \n\n\n\n there  ", maxCharacters: 100), "Hello\n\nthere")
    }

    #if canImport(FoundationModels)
    func testExplainsWhyTheModelIsUnavailable() throws {
        guard #available(iOS 26.0, *) else { throw XCTSkip("Needs iOS 26") }
        XCTAssertEqual(EmailReader.status(for: .available), .ready)
        for reason in [SystemLanguageModel.Availability.UnavailableReason.deviceNotEligible, .appleIntelligenceNotEnabled, .modelNotReady] {
            guard case .unavailable(let message) = EmailReader.status(for: .unavailable(reason)) else { return XCTFail("Expected a reason") }
            XCTAssertFalse(message.isEmpty)
            XCTAssertTrue(message.hasSuffix("."), "Messages are full sentences")
        }
    }

    func testExplainsFailuresInPlainEnglishWithoutEchoingAnything() throws {
        guard #available(iOS 26.0, *) else { throw XCTSkip("Needs iOS 26") }
        enum Stand: Error { case contextSizeExceeded(String), refusal, rateLimited(Int), somethingNew }
        let tooLong = OnDeviceExtractor.message(for: Stand.contextSizeExceeded("SECRET EMAIL TEXT"))
        XCTAssertTrue(tooLong.contains("too long"))
        XCTAssertFalse(tooLong.contains("SECRET"))
        XCTAssertTrue(OnDeviceExtractor.message(for: Stand.refusal).contains("declined"))
        XCTAssertTrue(OnDeviceExtractor.message(for: Stand.rateLimited(3)).contains("busy"))
        XCTAssertTrue(OnDeviceExtractor.message(for: Stand.somethingNew).hasPrefix("Apple Intelligence couldn't read"))
    }
    #endif
}

final class DocumentReadingTests: XCTestCase {
    private func samplePDF() -> Data {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            context.beginPage()
            let text = "SISTIC E-Ticket\nEvent: Test Concert\nVenue: Indoor Stadium\nDate: 12 Nov 2026 8:00 PM\nBooking reference 4031984497 for Alex Tan, Category 1"
            (text as NSString).draw(in: CGRect(x: 40, y: 40, width: 500, height: 300), withAttributes: [.font: UIFont.systemFont(ofSize: 16)])
        }
    }

    func testReadsPDFTextFromContentNotFileName() async throws {
        // The reader only sees bytes, so a file saved without ".pdf" works the same.
        let data = samplePDF()
        XCTAssertTrue(DocumentReader.isPDF(data))
        let document = try await DocumentReader.read(data)
        XCTAssertTrue(document.text.contains("Test Concert"))
        XCTAssertTrue(document.text.contains("4031984497"))
    }

    func testPlainTextPassesThroughAndJunkIsRejected() async throws {
        let text = try await DocumentReader.read(Data("Order 123 for Show".utf8))
        XCTAssertEqual(text.text, "Order 123 for Show")
        do { _ = try await DocumentReader.read(Data([0, 1, 2, 3, 255, 254])); XCTFail("Expected unsupported") }
        catch { XCTAssertTrue(error is DocumentError) }
    }
}

final class TitleShorteningTests: XCTestCase {
    func testLongEventTitleDropsCityThenCutsAtAWord() {
        let title = "2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore"
        let short = ImportJSONBuilder.shortTitle(title, city: "Singapore")
        XCTAssertLessThanOrEqual(short.count, ImportJSONBuilder.titleLimit + 1)
        XCTAssertTrue(short.hasSuffix("…"))
        XCTAssertEqual(ImportJSONBuilder.shortTitle("Short Show", city: "Singapore"), "Short Show")
    }
}
