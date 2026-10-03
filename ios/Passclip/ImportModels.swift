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
    let passes: [JSONValue]
    let source: JSONValue?
    func singlePassText(at index: Int) throws -> String {
        guard passes.indices.contains(index) else { throw ServiceError.invalidResponse }
        var fields: [String: JSONValue] = ["schemaVersion": .string("1.0"), "passes": .array([passes[index].removing("needsTimeZone")])]
        if let source { fields["source"] = source }
        return String(decoding: try JSONEncoder().encode(JSONValue.object(fields)), as: UTF8.self)
    }
}
struct ImportResponse: Decodable {
    let value: ImportedData
    let warnings: [ImportNotice]
    let layouts: [WalletLayout]
    let signingAvailable: Bool
}
struct APIErrorResponse: Decodable { let errors: [ImportNotice] }
struct ImportRequest: Encodable {
    let text: String
    let fallbackTimeZone: String
    var index: Int = 0
}
