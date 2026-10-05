import SwiftUI
import PassKit
import UniformTypeIdentifiers

struct ContentView: View {
    @AppStorage("serverURL", store: UserDefaults(suiteName: "group.noahyao.passclip")) private var server = "https://passclip.vercel.app"
    @State private var text: String
    @State private var timeZone = TimeZone.current.identifier
    @State private var result: ImportResponse?
    @State private var error = ""
    @State private var busy = false
    @State private var choosingFile = false
    @State private var walletPass: PKPass?
    @State private var showingWallet = false
    init(initialText: String = "") { _text = State(initialValue: initialText) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Turn any ticket into an Apple Wallet pass.").font(.largeTitle.weight(.semibold))
                    DisclosureGroup("Settings") { TextField("Passclip server HTTPS address", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    Text("Copy our prompt into any AI chat with your ticket, then paste its reply here.").foregroundStyle(.secondary)
                    Button("Copy AI prompt") {
                        if let url = Bundle.main.url(forResource: "extract-to-passclip", withExtension: "txt"), let prompt = try? String(contentsOf: url, encoding: .utf8) { UIPasteboard.general.string = prompt }
                        else { error = "The AI prompt resource is missing. Rebuild the app with its resources." }
                    }
                    TextEditor(text: $text).frame(minHeight: 200).padding(8).background(.quaternary, in: RoundedRectangle(cornerRadius: 8)).accessibilityLabel("AI reply")
                    Text("Preview sends these details to your configured Passclip server for validation. They are not saved.").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Choose file") { choosingFile = true }
                        Spacer()
                        Button("Preview passes") { Task { await preview() } }.buttonStyle(.borderedProminent).disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    if busy { ProgressView("Checking your reply…") }
                    if !error.isEmpty { Text(error).foregroundStyle(.red).accessibilityLabel("Import error: \(error)") }
                    if let result {
                        if result.value.passes.isEmpty { Text("No passes found") }
                        ForEach(result.warnings.indices, id: \.self) { index in Text(result.warnings[index].message).font(.caption).foregroundStyle(result.warnings[index].kind == "fix" ? .secondary : .primary) }
                        if result.value.passes.contains(where: { $0["needsTimeZone"] == .bool(true) }) {
                            Picker("Event or departure time zone", selection: $timeZone) { ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0).tag($0) } }
                            Text("Choose the correct zone, then preview again.").font(.caption)
                        }
                        ForEach(result.value.passes.indices, id: \.self) { index in
                            NativePassPreview(pass: result.value.passes[index], layout: result.layouts[index])
                            if result.signingAvailable {
                                WalletAddButton { Task { await addToWallet(index) } }.frame(height: 44).disabled(busy || !PKAddPassesViewController.canAddPasses()).accessibilityLabel("Add to Apple Wallet")
                            } else { Text("Pass signing isn't set up yet.").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }.padding()
            }.navigationTitle("Passclip").navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.json, .plainText]) { selection in
                do {
                    let url = try selection.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 256 * 1024 else { throw ServiceError.tooLarge }
                    let data = try Data(contentsOf: url)
                    guard data.count <= 256 * 1024 else { throw ServiceError.tooLarge }
                    guard let input = String(data: data, encoding: .utf8) else { throw ServiceError.rejected("Choose a UTF-8 .json or .txt file.") }
                    text = input; result = nil
                } catch { self.error = error.localizedDescription }
            }
            .sheet(isPresented: $showingWallet) { if let walletPass { WalletSheet(pass: walletPass) { showingWallet = false; self.walletPass = nil } } }
            .onChange(of: text) { _, _ in result = nil }
            .onChange(of: server) { _, _ in result = nil }
            .onChange(of: timeZone) { _, _ in result = nil }
        }
    }
    @MainActor private func preview() async {
        busy = true; error = ""; result = nil; defer { busy = false }
        let sentText = text, sentServer = server, sentZone = timeZone
        do {
            let response = try await PassclipService(server: sentServer).preview(text: sentText, timeZone: sentZone)
            // Editing while a request is in flight must not replace current input with stale results.
            if text == sentText && server == sentServer && timeZone == sentZone { result = response }
        } catch { self.error = error.localizedDescription }
    }
    @MainActor private func addToWallet(_ index: Int) async {
        guard let result else { return }
        busy = true; error = ""; defer { busy = false }
        do {
            let payload = try result.value.singlePassText(at: index)
            let data = try await PassclipService(server: server).signedPass(text: payload, timeZone: timeZone)
            walletPass = try PKPass(data: data); showingWallet = true
        } catch { self.error = error.localizedDescription }
    }
}
