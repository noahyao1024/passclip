import Foundation

// A 307/308 redirect must not forward ticket contents to an unchosen server.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum ServiceError: LocalizedError {
    case invalidServer, tooLarge, rejected(String), invalidResponse
    var errorDescription: String? {
        switch self {
        case .invalidServer: return "Enter your Passclip server's HTTPS address in Settings."
        case .tooLarge: return "This import is over 256 KB. Paste only the AI's JSON reply."
        case .rejected(let message): return message
        case .invalidResponse: return "The server returned an unexpected response. Check its address and try again."
        }
    }
}
struct PassclipService {
    let baseURL: URL
    private let session: URLSession
    init(server: String, session: URLSession? = nil) throws {
        guard let url = URL(string: server), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { throw ServiceError.invalidServer }
        baseURL = url
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    }
    private func post(_ endpoint: String, text: String, timeZone: String, thumbnail: [String: String]? = nil) async throws -> Data {
        guard text.utf8.count <= 256 * 1024 else { throw ServiceError.tooLarge }
        let body = try JSONEncoder().encode(ImportRequest(text: text, fallbackTimeZone: timeZone, thumbnail: thumbnail))
        // The picture (three small PNG files) may add up to about 1.2 MB.
        guard body.count <= 256 * 1024 + (thumbnail == nil ? 0 : 1_290_240) else { throw ServiceError.tooLarge }
        var request = URLRequest(url: baseURL.appendingPathComponent("api").appendingPathComponent(endpoint))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let errors = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            throw ServiceError.rejected(errors?.errors.map(\.message).joined(separator: "\n") ?? "The server couldn't process this import. Try again later.")
        }
        if endpoint == "pass", http.mimeType != "application/vnd.apple.pkpass" { throw ServiceError.invalidResponse }
        return data
    }
    func preview(text: String, timeZone: String) async throws -> ImportResponse {
        let data = try await post("import", text: text, timeZone: timeZone)
        do {
            let result = try JSONDecoder().decode(ImportResponse.self, from: data)
            guard result.value.passes.count == result.layouts.count else { throw ServiceError.invalidResponse }
            return result
        }
        catch { throw ServiceError.invalidResponse }
    }
    func signedPass(text: String, timeZone: String, thumbnail: [String: String]? = nil) async throws -> Data { try await post("pass", text: text, timeZone: timeZone, thumbnail: thumbnail) }
}
