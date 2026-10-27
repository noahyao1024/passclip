import Foundation

/// When to ask for an App Store rating: after a pass goes to Wallet, once the person has made a few passes, and once per
/// app version. Ratings help people find the app in App Store search. iOS still decides whether the rating sheet
/// appears (at most three times a year, never in TestFlight).
enum ReviewPrompt {
    /// Passes in "Your passes", from the app and the share sheet.
    static let passesBeforeAsking = 2

    static func shouldAsk(passesMade: Int, version: String, lastAskedVersion: String) -> Bool {
        passesMade >= passesBeforeAsking && !version.isEmpty && version != lastAskedVersion
    }

    static var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }
}
