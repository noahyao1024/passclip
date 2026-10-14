import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let loading = UIHostingController(rootView: ProgressView("Reading what you shared…"))
        addChild(loading); view.addSubview(loading.view); loading.view.frame = view.bounds; loading.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; loading.didMove(toParent: self)
        Task { @MainActor in
            var incoming = Incoming()
            var documents: [ReadDocument] = []
            if let item = extensionContext?.inputItems.first as? NSExtensionItem, let providers = item.attachments {
                for provider in providers {
                    guard let input = await DocumentReader.load(provider) else { continue }
                    switch input {
                    case .text(let shared): if documents.isEmpty && incoming.text.isEmpty { incoming = Incoming(text: shared) }
                    case .file(let data, let name):
                        do { documents.append(try await DocumentReader.read(data, name: name)) }
                        catch { if documents.isEmpty { incoming = Incoming(problem: error.localizedDescription) } }
                    }
                    if documents.count >= BatchImport.maxDocuments { break }
                }
            }
            // Several files become one batch; one file works as before.
            if documents.count == 1 { incoming = Incoming(documents[0]) }
            else if documents.count > 1 { incoming = Incoming(); incoming.documents = documents }
            loading.willMove(toParent: nil); loading.view.removeFromSuperview(); loading.removeFromParent()
            if incoming.text.utf8.count > 256 * 1024 { incoming.text = "" }
            let controller = UIHostingController(rootView: SharedContent(incoming: incoming, onClose: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil) }))
            self.addChild(controller); self.view.addSubview(controller.view); controller.view.frame = self.view.bounds; controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; controller.didMove(toParent: self)
        }
    }
}
private struct SharedContent: View {
    let incoming: Incoming
    let onClose: () -> Void
    var body: some View { ContentView(incoming, onClose: onClose, startOnAppear: true) }
}
