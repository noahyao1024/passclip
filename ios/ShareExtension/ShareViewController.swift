import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let loading = UIHostingController(rootView: ProgressView("Reading what you shared…"))
        addChild(loading); view.addSubview(loading.view); loading.view.frame = view.bounds; loading.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; loading.didMove(toParent: self)
        Task { @MainActor in
            var text = ""
            var codes: [FoundCode] = []
            var problem = ""
            if let item = extensionContext?.inputItems.first as? NSExtensionItem, let providers = item.attachments {
                for provider in providers {
                    guard let input = await DocumentReader.load(provider) else { continue }
                    switch input {
                    case .text(let shared): text = shared
                    case .file(let data):
                        do { let document = try await DocumentReader.read(data); text = document.text; codes = document.codes }
                        catch { problem = error.localizedDescription }
                    }
                    if !text.isEmpty || !problem.isEmpty { break }
                }
            }
            loading.willMove(toParent: nil); loading.view.removeFromSuperview(); loading.removeFromParent()
            let safeText = text.utf8.count <= 256 * 1024 ? text : ""
            let controller = UIHostingController(rootView: SharedContent(text: safeText, codes: codes, problem: problem, onClose: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil) }))
            self.addChild(controller); self.view.addSubview(controller.view); controller.view.frame = self.view.bounds; controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; controller.didMove(toParent: self)
        }
    }
}
private struct SharedContent: View {
    let text: String
    let codes: [FoundCode]
    let problem: String
    let onClose: () -> Void
    var body: some View { ContentView(initialText: text, initialCodes: codes, initialError: problem, onClose: onClose, startOnAppear: true) }
}
