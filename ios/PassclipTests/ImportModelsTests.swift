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
    func samplePDFData() -> Data { samplePDF() }
    private func samplePDF() -> Data {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            context.beginPage()
            let text = "SISTIC E-Ticket\nEvent: Test Concert\nVenue: Indoor Stadium\nDate: 12 Nov 2026 8:00 PM\nBooking reference 4031984497 for Alex Tan, Category 1"
            (text as NSString).draw(in: CGRect(x: 40, y: 40, width: 500, height: 300), withAttributes: [.font: UIFont.systemFont(ofSize: 16)])
            ("https://tickets.example.com/eticket/download?linkId=abc 10/10/26, 12:37 AM\nSISTIC Terms and Conditions" as NSString)
                .draw(in: CGRect(x: 40, y: 700, width: 520, height: 40), withAttributes: [.font: UIFont.systemFont(ofSize: 10)])
            context.setURL(URL(string: "https://tickets.example.com/order/view?id=7")!, for: CGRect(x: 40, y: 400, width: 200, height: 20))
            context.setURL(URL(string: "https://tickets.example.com/terms-and-conditions")!, for: CGRect(x: 40, y: 740, width: 200, height: 20))
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
    func testSplitsSeriesAndShowWithoutDotsAndDropsThePlace() {
        let split = ImportJSONBuilder.splitTitle("2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore", city: nil)
        XCTAssertEqual(split.title, "Yue Yunpeng & Sun Yue Cross Talk Show")
        XCTAssertEqual(split.subtitle, "2026 Deyunshe 30th Anniversary")
    }

    func testEndsBeforeFeaturingOrAtAWholeWordAndNeverAddsDots() {
        let featuring = ImportJSONBuilder.splitTitle("Deyun Club’s 30th Anniversary Cross Talk Show featuring Yue Yunpeng and Sun Yue - Singapore", city: "Singapore")
        XCTAssertEqual(featuring.title, "Deyun Club’s 30th Anniversary Cross Talk Show")
        XCTAssertNil(featuring.subtitle)
        let plain = ImportJSONBuilder.splitTitle("An Extraordinarily Long Evening Of Music Played Under The Stars By Many Orchestras", city: nil)
        XCTAssertLessThanOrEqual(plain.title.count, ImportJSONBuilder.titleLimit)
        XCTAssertFalse(plain.title.contains("…"))
        XCTAssertFalse(plain.title.hasSuffix(" The") || plain.title.hasSuffix(" By"))
        XCTAssertEqual(ImportJSONBuilder.splitTitle("Short Show", city: "Singapore").title, "Short Show")
    }
}

extension DocumentReadingTests {
    func testKnowsTheKindNameAndLinksOfADocument() async throws {
        let document = try await DocumentReader.read(samplePDFData(), name: "SISTIC E-Ticket.pdf")
        XCTAssertEqual(document.source.kind, "pdf")
        XCTAssertEqual(document.source.name, "SISTIC E-Ticket")
        // The page address printed in the footer is the original; the order link in the PDF is next; terms are skipped.
        XCTAssertEqual(document.links.map(\.title), ["Original ticket", "Order details"])
        XCTAssertEqual(document.links.first?.url, "https://tickets.example.com/eticket/download?linkId=abc")
        XCTAssertEqual(document.links.last?.url, "https://tickets.example.com/order/view?id=7")
        XCTAssertEqual(DocumentReader.cleanName("Ticket.v2.pdf"), "Ticket.v2")
        XCTAssertNil(DocumentReader.cleanName("  "))
        let plain = try await DocumentReader.read(Data("Order 5".utf8))
        XCTAssertEqual(plain.source.kind, "other")
    }
}

final class SourceCheckTests: XCTestCase {
    private let document = """
    SISTIC E-Ticket
    2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore
    “三十而立 岁月流金” 2026 德云社成立
    三十周年系列演出之岳云鹏、孙越相声专场新加坡站
    10-Oct-2026 07:30 PM
    Resorts World Convention Centre
    Section A7 Row 22 Seat 13
    Patron Name DAMAI .
    Transaction No. 20261005-001796
    10/10/26, 12:37 AM
    """
    private func check(_ pass: ExtractedPass) -> SourceCheck.Outcome { SourceCheck.apply(to: [pass], source: document) }

    func testRepairsATitleThatLostACharacterFromTheDocument() {
        let outcome = check(ExtractedPass(type: "eventTicket", title: "三周年系列演出之岳云鹏、孙越相声专场新加坡站"))
        XCTAssertEqual(outcome.passes[0].title, "三十周年系列演出之岳云鹏、孙越相声专场新加坡站")
        XCTAssertTrue(outcome.warnings.isEmpty)
    }

    func testKeepsACopiedTitleAndWarnsAboutOneThatIsNotInTheDocument() {
        let english = "2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore"
        XCTAssertEqual(check(ExtractedPass(type: "eventTicket", title: english)).passes[0].title, english)
        let invented = check(ExtractedPass(type: "eventTicket", title: "Completely different festival of lights"))
        XCTAssertEqual(invented.passes[0].title, "Completely different festival of lights")
        XCTAssertTrue(invented.warnings.contains { $0.hasPrefix("Check the title") })
        // A route is put together by the model, so it isn't compared with the text.
        XCTAssertTrue(check(ExtractedPass(type: "boardingPass", title: "HND to CDG")).warnings.isEmpty)
    }

    func testLeavesOutANumberThatIsNotInTheDocument() {
        var item = ExtractedPass(type: "eventTicket", title: "SISTIC E-Ticket")
        item.confirmationCode = "20261005-001769"
        let wrong = check(item)
        XCTAssertNil(wrong.passes[0].confirmationCode)
        XCTAssertTrue(wrong.warnings.contains { $0.contains("booking number") && $0.contains("left out") })
        item.confirmationCode = "20261005 001796"
        XCTAssertEqual(check(item).passes[0].confirmationCode, "20261005 001796", "Spaces and dashes don't matter")
    }

    func testKeepsNamesThatAreThereAndDropsOnesThatAreNot() {
        var item = ExtractedPass(type: "eventTicket", title: "SISTIC E-Ticket")
        item.venueName = "Resorts World Convention Centre"
        item.holderName = "Alex Tan"
        item.seatSection = "A7"; item.seatRow = "22"; item.seatNumber = "99"
        let outcome = check(item)
        XCTAssertEqual(outcome.passes[0].venueName, "Resorts World Convention Centre")
        XCTAssertNil(outcome.passes[0].holderName)
        XCTAssertEqual(outcome.passes[0].seatRow, "22")
        XCTAssertEqual(outcome.passes[0].seatSection, "A7")
        XCTAssertNil(outcome.passes[0].seatNumber, "Seat 99 isn't in the document")
        XCTAssertEqual(outcome.warnings.count, 2)
        item.seatNumber = "13"
        XCTAssertEqual(check(item).passes[0].seatNumber, "13")
    }

    func testAShortTitleMustComeFromTheTitle() {
        var item = ExtractedPass(type: "eventTicket", title: "2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore")
        item.shortTitle = "Yue Yunpeng & Sun Yue Cross Talk Show"
        XCTAssertEqual(check(item).passes[0].shortTitle, "Yue Yunpeng & Sun Yue Cross Talk Show")
        item.shortTitle = "Cross Talk Show Yue Yunpeng"
        XCTAssertEqual(check(item).passes[0].shortTitle, "Cross Talk Show Yue Yunpeng", "Words from the title in a new order are fine")
        item.shortTitle = "Comedy Night"
        XCTAssertNil(check(item).passes[0].shortTitle)
    }

    func testDropsNotesThatAreOnlyATimestampOrAnAddress() {
        var item = ExtractedPass(type: "eventTicket", title: "SISTIC E-Ticket")
        item.notes = "10/10/26, 12:37 AM"
        XCTAssertNil(check(item).passes[0].notes)
        item.notes = "https://tickets.example.com/eticket/download?linkId=abc"
        XCTAssertNil(check(item).passes[0].notes)
        item.notes = "No refunds. Doors open one hour before the show."
        XCTAssertNotNil(check(item).passes[0].notes)
    }
}

final class LinksAndTitlesTests: XCTestCase {
    private func firstPass(_ json: String?) throws -> [String: Any] {
        let data = try XCTUnwrap(json).data(using: .utf8)!
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap((object["passes"] as? [[String: Any]])?.first)
    }
    private let longTitle = "2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore"

    func testUsesTheShortTitleAndKeepsTheFullNameInTheNotes() throws {
        var item = ExtractedPass(type: "eventTicket", title: longTitle, shortTitle: "Yue Yunpeng & Sun Yue Cross Talk Show")
        var pass = try firstPass(ImportJSONBuilder.json(from: [item]))
        XCTAssertEqual(pass["title"] as? String, "Yue Yunpeng & Sun Yue Cross Talk Show")
        XCTAssertEqual(pass["notes"] as? String, "Full name: \(longTitle)")
        item.title = "Short Show"
        item.shortTitle = "Show"
        pass = try firstPass(ImportJSONBuilder.json(from: [item]))
        XCTAssertEqual(pass["title"] as? String, "Short Show", "A title that fits is never replaced")
        XCTAssertNil(pass["notes"])
    }

    func testReadsTheTimeZoneFromTheCity() throws {
        XCTAssertEqual(ImportJSONBuilder.zone(forCity: "Singapore"), "Asia/Singapore")
        XCTAssertEqual(ImportJSONBuilder.zone(forCity: " new york "), "America/New_York")
        XCTAssertNil(ImportJSONBuilder.zone(forCity: "Atlantis"))
        XCTAssertNil(ImportJSONBuilder.zone(forCity: nil))
        let item = ExtractedPass(type: "eventTicket", title: "Show", start: "2026-10-10T19:30", venueCity: "Singapore")
        XCTAssertEqual(try firstPass(ImportJSONBuilder.json(from: [item]))["timeZone"] as? String, "Asia/Singapore")
    }

    func testTidiesAHolderNameAndMatchesTheGoldenPDFFile() throws {
        var item = ExtractedPass(type: "eventTicket", title: longTitle, shortTitle: "Yue Yunpeng & Sun Yue Cross Talk Show", organization: "SISTIC",
                                 confirmationCode: "20261005-001796", holderName: "DAMAI .", start: "2026-10-10T19:30",
                                 venueName: "Resorts World Convention Centre", venueCity: "Singapore", seatCategory: "CAT 2")
        item.seatSection = "A7"; item.seatRow = "22"; item.seatNumber = "13"
        let link = FoundLink(title: "Original ticket", url: "https://sistic.stixcloud.com/Stix/eticket/downloadEticketLive.htm?linkId=IkT1mGrIek")
        let context = ImportContext(source: DocumentSource(kind: "pdf", name: "SISTIC E-Ticket"), links: [link], hasCodes: true)
        let json = try XCTUnwrap(ImportJSONBuilder.json(from: [item], context: context))
        let url = try XCTUnwrap(Bundle(for: LinksAndTitlesTests.self).url(forResource: "ai-pdf-ticket", withExtension: "json"))
        XCTAssertEqual(json, try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .newlines))
        XCTAssertEqual(try firstPass(json)["holderName"] as? String, "DAMAI")
    }

    func testFindsTheOriginalLinkAndSkipsTermsAndSocialLinks() {
        let text = """
        https://sistic.stixcloud.com/Stix/eticket/downloadEticketLive.htm?linkId=IkT1mGrIek 10/10/26, 12:37 AM
        See https://www.sistic.com.sg/terms-and-conditions and https://facebook.com/sistic
        Your order: https://sistic.stixcloud.com/Stix/order/view?id=20261005-001796.
        """
        let links = LinkFinder.links(in: text)
        XCTAssertEqual(links.map(\.title), ["Original ticket", "Order details"])
        XCTAssertEqual(links.last?.url, "https://sistic.stixcloud.com/Stix/order/view?id=20261005-001796")
        XCTAssertTrue(links.first?.display.hasPrefix("sistic.stixcloud.com/Stix/eticket/") == true)
        XCTAssertTrue(links.first?.display.hasSuffix("…") == true)
        XCTAssertLessThanOrEqual(links.first?.display.count ?? 99, 48)
        XCTAssertTrue(LinkFinder.links(in: "Visit https://example.com/about and http://insecure.example.com/ticket").isEmpty)
    }

    func testRecognizesAPastedWebLinkAndNothingElse() async {
        XCTAssertEqual(LinkFetcher.link(in: " https://example.com/ticket?id=1\n")?.host, "example.com")
        XCTAssertNil(LinkFetcher.link(in: "see https://example.com/ticket"))
        XCTAssertNil(LinkFetcher.link(in: "https://example"))
        XCTAssertNil(LinkFetcher.link(in: ""))
        XCTAssertNil(LinkFetcher.link(in: #"{"passes": []}"#))
        XCTAssertNotNil(LinkFetcher.link(in: "http://example.com/ticket"), "Detected, then refused with a clear message")
        do { _ = try await LinkFetcher.open(URL(string: "http://example.com/ticket")!); XCTFail("Expected a refusal") }
        catch { XCTAssertTrue(error is LinkError); XCTAssertTrue(error.localizedDescription.contains("https://")) }
    }

    func testReadsTheTextOfAWebPage() {
        let html = """
        <html><head><title>My &amp; Ticket</title><style>.a{color:red}</style></head>
        <body><h1>Cross Talk Show</h1><p>Seat&nbsp;A7 &#8211; Row&#x20;22</p><script>var secret = 1;</script><table><tr><td>Door</td><td>East</td></tr></table></body></html>
        """
        let page = HTMLText.extract(html)
        XCTAssertEqual(page.title, "My & Ticket")
        XCTAssertTrue(page.text.contains("Cross Talk Show"))
        XCTAssertTrue(page.text.contains("Seat A7 – Row 22"))
        XCTAssertTrue(page.text.contains("Door East"))
        XCTAssertFalse(page.text.contains("secret"))
        XCTAssertFalse(page.text.contains("color"))
    }
}

final class ArtworkResponseTests: XCTestCase {
    func testReadsThePictureForEachPassAndToleratesOlderServers() throws {
        let png = Data([0x89, 0x50, 0x4e, 0x47]).base64EncodedString()
        let withArt = #"{"value":{"passes":[{},{}]},"warnings":[],"layouts":[],"signingAvailable":true,"artwork":["\#(png)",null]}"#
        let response = try JSONDecoder().decode(ImportResponse.self, from: Data(withArt.utf8))
        XCTAssertEqual(response.artwork(at: 0), Data([0x89, 0x50, 0x4e, 0x47]))
        XCTAssertNil(response.artwork(at: 1))
        XCTAssertNil(response.artwork(at: 5))
        let older = #"{"value":{"passes":[{}]},"warnings":[],"layouts":[],"signingAvailable":false}"#
        XCTAssertNil(try JSONDecoder().decode(ImportResponse.self, from: Data(older.utf8)).artwork(at: 0))
    }
}

final class PrintedCodeTests: XCTestCase {
    func testNumberCodesShowTheirNumberUnderTheBarsAndSquareCodesDoNot() throws {
        var value = try JSONDecoder().decode(ImportedData.self, from: Data(#"{"passes":[{"type":"eventTicket","title":"Show"}]}"#.utf8))
        value.setBarcode(FoundCode(format: "code128", message: "40319844972"), at: 0)
        XCTAssertEqual(value.passes[0]["barcode"]?["altText"]?.string, "40319844972")
        value.setBarcode(FoundCode(format: "pdf417", message: "LONG|PAYLOAD|12345"), at: 0)
        XCTAssertNil(value.passes[0]["barcode"]?["altText"])
        value.setBarcode(FoundCode(format: "code128", message: String(repeating: "9", count: 60)), at: 0)
        XCTAssertNil(value.passes[0]["barcode"]?["altText"], "A very long number isn't printed")
    }

    func testEntranceReachesTheSeat() throws {
        var item = ExtractedPass(type: "eventTicket", title: "Show")
        item.seatSection = "A7"; item.seatEntrance = "East"
        let json = try XCTUnwrap(ImportJSONBuilder.json(from: [item]))
        let seat = try XCTUnwrap(((try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])?["passes"] as? [[String: Any]])?.first?["seat"] as? [String: String])
        XCTAssertEqual(seat, ["section": "A7", "entrance": "East"])
        let outcome = SourceCheck.apply(to: [item], source: "Section A7  Door / Entrance East")
        XCTAssertEqual(outcome.passes[0].seatEntrance, "East")
        item.seatEntrance = "Gate 9"
        XCTAssertNil(SourceCheck.apply(to: [item], source: "Section A7  Door / Entrance East").passes[0].seatEntrance)
    }
}

final class BilingualTitleTests: XCTestCase {
    // What PDFKit really returned for the SISTIC ticket: English first, then Chinese in Kangxi radical forms.
    private let document = """
    2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore
    “三⼗⽽⽴ 岁⽉流⾦” 2026 德云社成⽴
    三⼗周年系列演出之岳云鹏、孙越相声专场新加坡站
    10-Oct-2026 07:30 PM
    Resorts World Convention Centre
    """
    private let english = "2026 Deyunshe 30th Anniversary - Yue Yunpeng & Sun Yue Cross Talk Show in Singapore"

    func testMapsKangxiRadicalsToTheUsualCharactersAndTellsScripts() {
        XCTAssertEqual(SourceCheck.cleanCJK("三⼗⽽⽴ 岁⽉流⾦"), "三十而立 岁月流金")
        XCTAssertEqual(SourceCheck.cleanCJK("Plain text ①"), "Plain text ①", "Only Chinese compatibility forms change")
        XCTAssertEqual(SourceCheck.script(of: "三十周年系列演出"), .cjk)
        XCTAssertEqual(SourceCheck.script(of: english), .latin)
        XCTAssertEqual(SourceCheck.script(of: "10:30"), .other)
        XCTAssertTrue(SourceCheck.normalize("三⼗周年").contains("三十周年"), "Comparisons ignore the two forms")
    }

    func testAReaderOfEnglishGetsTheEnglishNameAndTheChineseGoesOnTheBack() throws {
        var item = ExtractedPass(type: "eventTicket", title: "三十周年系列演出之岳云鹏、孙越相声专场新加坡站", titleLatin: english)
        item.shortTitle = "Yue Yunpeng & Sun Yue Cross Talk Show"
        let outcome = SourceCheck.apply(to: [item], source: SourceCheck.cleanCJK(document), readerPrefersLatin: true)
        XCTAssertEqual(outcome.passes[0].title, english)
        XCTAssertEqual(outcome.passes[0].alternateTitle, "三十周年系列演出之岳云鹏、孙越相声专场新加坡站")
        XCTAssertEqual(outcome.passes[0].shortTitle, "Yue Yunpeng & Sun Yue Cross Talk Show")
        let json = try XCTUnwrap(ImportJSONBuilder.json(from: outcome.passes))
        let pass = try XCTUnwrap(((try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])?["passes"] as? [[String: Any]])?.first)
        XCTAssertEqual(pass["title"] as? String, "Yue Yunpeng & Sun Yue Cross Talk Show")
        XCTAssertEqual(pass["notes"] as? String, "Also: 三十周年系列演出之岳云鹏、孙越相声专场新加坡站\nFull name: \(english)")
    }

    func testNothingChangesForAReaderOfChineseOrWhenTheEnglishNameIsNotInTheDocument() {
        let chinese = "三十周年系列演出之岳云鹏、孙越相声专场新加坡站"
        let item = ExtractedPass(type: "eventTicket", title: chinese, titleLatin: english)
        XCTAssertEqual(SourceCheck.apply(to: [item], source: SourceCheck.cleanCJK(document), readerPrefersLatin: false).passes[0].title, chinese)
        let invented = ExtractedPass(type: "eventTicket", title: chinese, titleLatin: "Yue Yunpeng Comedy Gala 2026 Live")
        let outcome = SourceCheck.apply(to: [invented], source: SourceCheck.cleanCJK(document), readerPrefersLatin: true)
        XCTAssertEqual(outcome.passes[0].title, chinese)
        XCTAssertNil(outcome.passes[0].alternateTitle)
        // An English title stays as it is, with no note.
        let already = SourceCheck.apply(to: [ExtractedPass(type: "eventTicket", title: english)], source: document, readerPrefersLatin: true)
        XCTAssertEqual(already.passes[0].title, english)
        XCTAssertNil(already.passes[0].alternateTitle)
    }
}
