import SwiftUI
import PassKit

struct WalletSheet: UIViewControllerRepresentable {
    let pass: PKPass
    let onFinish: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }
    func makeUIViewController(context: Context) -> UIViewController {
        guard let controller = PKAddPassesViewController(pass: pass) else { return UIViewController() }
        controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
    final class Coordinator: NSObject, PKAddPassesViewControllerDelegate {
        let onFinish: () -> Void
        init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }
        func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) { onFinish() }
    }
}

/// Apple's system-provided artwork, rather than a hand-drawn Wallet badge.
struct WalletAddButton: UIViewRepresentable {
    let action: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> PKAddPassButton {
        let button = PKAddPassButton(addPassButtonStyle: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.pressed), for: .touchUpInside)
        return button
    }
    func updateUIView(_ button: PKAddPassButton, context: Context) {
        button.isEnabled = context.environment.isEnabled
        context.coordinator.action = action
    }
    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func pressed() { action() }
    }
}
