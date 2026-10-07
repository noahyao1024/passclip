import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let loading = UIHostingController(rootView: ProgressView("Reading shared text…"))
        addChild(loading); view.addSubview(loading.view); loading.view.frame = view.bounds; loading.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; loading.didMove(toParent: self)
        Task { @MainActor in
            var text = ""
            if let item = extensionContext?.inputItems.first as? NSExtensionItem, let providers = item.attachments {
                for provider in providers {
                    do {
                        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                            let value = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
                            if let value = value as? String { text = value }
                            else if let value = value as? Data { text = String(data: value, encoding: .utf8) ?? "" }
                        } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                            let value = try await provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier)
                            if let url = value as? URL, ["json", "txt"].contains(url.pathExtension.lowercased()) {
                                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                                if size <= 256 * 1024 { let data = try Data(contentsOf: url); if data.count <= 256 * 1024 { text = String(data: data, encoding: .utf8) ?? "" } }
                            }
                        }
                    } catch { /* Fixed empty-state UI; never log shared ticket content. */ }
                    if !text.isEmpty { break }
                }
            }
            loading.willMove(toParent: nil); loading.view.removeFromSuperview(); loading.removeFromParent()
            let safeText = text.utf8.count <= 256 * 1024 ? text : ""
            let controller = UIHostingController(rootView: SharedContent(text: safeText, onClose: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil) }))
            self.addChild(controller); self.view.addSubview(controller.view); controller.view.frame = self.view.bounds; controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]; controller.didMove(toParent: self)
        }
    }
}
private struct SharedContent: View {
    let text: String
    let onClose: () -> Void
    var body: some View { ContentView(initialText: text, onClose: onClose, startOnAppear: true) }
}
