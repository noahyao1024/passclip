import XCTest
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
}
