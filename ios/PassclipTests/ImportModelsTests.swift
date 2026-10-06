import XCTest
import CoreImage
import UIKit
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
        #endif
        for (filter, format, message) in [("CIQRCodeGenerator", "qr", "1004940771101-CAT2"), ("CICode128BarcodeGenerator", "code128", "R-55120")] {
            let generator = CIFilter(name: filter)!
            generator.setValue(Data(message.utf8), forKey: "inputMessage")
            let output = generator.outputImage!.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
            // A white margin around the code, like a real screenshot.
            let padded = output.composited(over: CIImage(color: .white).cropped(to: output.extent.insetBy(dx: -80, dy: -80)))
            let cgImage = CIContext().createCGImage(padded, from: padded.extent)!
            XCTAssertEqual(try BarcodeReader.read(UIImage(cgImage: cgImage)), [FoundCode(format: format, message: message)])
        }
    }
}
