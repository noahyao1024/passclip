import SwiftUI

@main struct PassclipApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // For screenshots and manual checks only: `SIMCTL_CHILD_PASSCLIP_SAMPLE_TEXT='<json>' simctl launch …`
            // opens with that reply and previews it. Release builds ignore it.
            let sample = ProcessInfo.processInfo.environment["PASSCLIP_SAMPLE_TEXT"]
            ContentView(initialText: sample ?? "", previewOnAppear: sample != nil)
            #else
            ContentView()
            #endif
        }
    }
}
