import Foundation

/// Keeps schema data intact when forwarding a validated pass back for signing.
indirect enum JSONValue: Codable, Equatable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
    subscript(_ key: String) -> JSONValue? { if case .object(let fields) = self { return fields[key] }; return nil }
    var string: String? { if case .string(let value) = self { return value }; return nil }
    var display: String {
        switch self { case .string(let value): return value; case .number(let value): return value.formatted(); default: return "" }
    }
    func removing(_ key: String) -> JSONValue { if case .object(var fields) = self { fields.removeValue(forKey: key); return .object(fields) }; return self }
    func setting(_ key: String, to value: JSONValue) -> JSONValue { if case .object(var fields) = self { fields[key] = value; return .object(fields) }; return self }
}
struct ImportNotice: Decodable {
    let message: String
    let pass: Int?
    let kind: String?
    let from: String?
}
struct WalletField: Decodable {
    let key: String
    let label: String
    let value: JSONValue
    let dateStyle: String?
    let timeStyle: String?
    let currencyCode: String?
    let attributedValue: String?
}
struct WalletLayout: Decodable {
    let headerFields: [WalletField]
    let primaryFields: [WalletField]
    let secondaryFields: [WalletField]
    let auxiliaryFields: [WalletField]
    let backFields: [WalletField]
}
struct ImportedData: Decodable {
    var passes: [JSONValue]
    let source: JSONValue?
    /// Puts a code the person chose into pass `index`. The text under the code is kept only if the code didn't change.
    mutating func setBarcode(_ code: FoundCode, at index: Int) {
        guard passes.indices.contains(index) else { return }
        let previous = passes[index]["barcode"]
        var barcode: [String: JSONValue] = ["format": .string(code.format), "message": .string(code.message)]
        if previous?["message"]?.string == code.message, let alt = previous?["altText"] { barcode["altText"] = alt }
        passes[index] = passes[index].setting("barcode", to: .object(barcode))
    }
    func singlePassText(at index: Int) throws -> String {
        guard passes.indices.contains(index) else { throw ServiceError.invalidResponse }
        var fields: [String: JSONValue] = ["schemaVersion": .string("1.1"), "passes": .array([passes[index].removing("needsTimeZone")])]
        if let source { fields["source"] = source }
        return String(decoding: try JSONEncoder().encode(JSONValue.object(fields)), as: UTF8.self)
    }
}
struct ImportResponse: Decodable {
    var value: ImportedData
    let warnings: [ImportNotice]
    let layouts: [WalletLayout]
    let signingAvailable: Bool
    /// The picture behind each event ticket, as base64 PNG (null for other passes). Older servers send none.
    let artwork: [String?]?

    func artwork(at index: Int) -> Data? {
        guard let artwork, artwork.indices.contains(index), let encoded = artwork[index] else { return nil }
        return Data(base64Encoded: encoded)
    }
}
struct APIErrorResponse: Decodable { let errors: [ImportNotice] }
struct ImportRequest: Encodable {
    let text: String
    let fallbackTimeZone: String
    var index: Int = 0
}
