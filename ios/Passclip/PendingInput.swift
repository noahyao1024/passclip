import Foundation

/// What Siri or Shortcuts handed over (MakePassIntent), waiting for the screen to pick it up.
@MainActor final class PendingInput: ObservableObject {
    static let shared = PendingInput()
    @Published var incoming: Incoming?
}
