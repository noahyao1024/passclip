import SwiftUI

@main struct PassclipApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // For screenshots and manual checks only: `SIMCTL_CHILD_PASSCLIP_SAMPLE_TEXT='<json>' simctl launch …`
            // opens with that reply and previews it. Release builds ignore it.
            ContentView(Self.debugIncoming(), startOnAppear: Self.debugStarts)
            #else
            ContentView()
            #endif
        }
    }

    #if DEBUG
    private static let environment = ProcessInfo.processInfo.environment
    private static var debugStarts: Bool { environment["PASSCLIP_SAMPLE_TEXT"] != nil && environment["PASSCLIP_NO_START"] != "1" }
    private static func debugIncoming() -> Incoming {
        var incoming = Incoming(text: environment["PASSCLIP_SAMPLE_TEXT"] ?? "")
        if environment["PASSCLIP_SAMPLE_LINKS"] == "1" {
            incoming.source = DocumentSource(kind: "pdf", name: "SISTIC E-Ticket")
            incoming.links = [FoundLink(title: "Original ticket", url: "https://sistic.stixcloud.com/Stix/eticket/downloadEticketLive.htm?linkId=IkT1mGrIek"),
                              FoundLink(title: "Order details", url: "https://sistic.stixcloud.com/Stix/order/view?id=20261005-001796")]
        }
        return incoming
    }
    #endif
}
