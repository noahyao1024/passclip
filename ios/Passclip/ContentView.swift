import SwiftUI
import PassKit
import PhotosUI
import UniformTypeIdentifiers

struct ContentView: View {
    @AppStorage("serverURL", store: UserDefaults(suiteName: "group.noahyao.passclip")) private var server = "https://passclip.vercel.app"
    @State private var text: String
    @State private var timeZone = TimeZone.current.identifier
    @State private var result: ImportResponse?
    @State private var error: String
    @State private var notice = ""
    @State private var busy = false
    @State private var busyLabel = ""
    @State private var reader = EmailReader.status
    @State private var copied = false
    @State private var choosingFile = false
    @State private var suggestedCodes: [FoundCode]
    @State private var showingSettings = false
    @State private var walletPass: PKPass?
    @State private var showingWallet = false
    @FocusState private var editing: Bool
    @Environment(\.scenePhase) private var scenePhase
    private let onClose: (() -> Void)?
    private let startOnAppear: Bool

    /// `startOnAppear` makes the pass right away, for text shared from Mail or Safari.
    init(initialText: String = "", initialCodes: [FoundCode] = [], initialError: String = "", onClose: (() -> Void)? = nil, startOnAppear: Bool = false) {
        _text = State(initialValue: initialText)
        _suggestedCodes = State(initialValue: initialCodes)
        _error = State(initialValue: initialError)
        self.onClose = onClose
        self.startOnAppear = startOnAppear
    }

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var readsEmails: Bool { reader.isReady && !ImportDetector.looksLikeImportJSON(text) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // With results, the passes take the screen; "Edit reply" brings the steps back.
                    if result == nil {
                        header
                        if reader.isReady {
                            pasteCard(number: nil, title: "Paste your ticket email", placeholder: "Select the text of your ticket email, copy it, and paste it here.",
                                      label: "Ticket email or AI reply", footnote: "Your email is read on this iPhone. Only the pass details found in it go to your Passclip server for the preview.")
                            otherAI
                        } else {
                            if case .unavailable(let reason) = reader { Label(reason, systemImage: "sparkles").font(.footnote).foregroundStyle(Brand.muted) }
                            askStep
                            pasteCard(number: 2, title: "Paste the AI's reply", placeholder: "{ \"schemaVersion\": \"1.1\", \"passes\": [ … ] }",
                                      label: "AI reply", footnote: "Previews are checked by your Passclip server and not saved.")
                        }
                    }
                    if !error.isEmpty { errorCard }
                    if let result { results(result) } else if !busy { emptyState }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Brand.paper.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { if result == nil { previewBar } }
            .navigationTitle("Passclip").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onClose { ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose) } }
                ToolbarItem(placement: .primaryAction) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
                }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { editing = false } }
            }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.item]) { readFile($0) }
            .sheet(isPresented: $showingSettings) { SettingsSheet(server: $server) }
            .sheet(isPresented: $showingWallet) { if let walletPass { WalletSheet(pass: walletPass) { showingWallet = false; self.walletPass = nil } } }
            .task { if startOnAppear && hasText { await makePass() } }
            .onChange(of: scenePhase) { _, phase in if phase == .active { reader = EmailReader.status } }
            .onChange(of: text) { _, _ in result = nil; notice = "" }
            .onChange(of: server) { _, _ in result = nil }
            .onChange(of: timeZone) { _, _ in if result != nil { Task { await preview() } } }
        }
        .tint(Brand.signal)
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("A little less digging for your ticket.", systemImage: "paperclip").font(.footnote).foregroundStyle(Brand.muted)
            Text("Turn any ticket into a Wallet pass.").font(.title.weight(.bold)).foregroundStyle(Brand.ink)
        }
        .padding(.top, 4)
    }

    private var askStep: some View {
        Card {
            StepHeading(number: 1, title: "Ask any AI")
            askContent
        }
    }

    private var askContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Copy our prompt, then paste it with your ticket email into ChatGPT, Claude or any AI chat. Paste its reply back here.")
                .font(.subheadline).foregroundStyle(Brand.muted)
            Button(action: copyPrompt) {
                Label(copied ? "Copied" : "Copy AI prompt", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    /// The old way, kept for anyone who prefers another AI.
    private var otherAI: some View {
        Card {
            DisclosureGroup("Use another AI instead") { askContent.padding(.top, 8) }
                .font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        }
    }

    private func pasteCard(number: Int?, title: String, placeholder: String, label: String, footnote: String) -> some View {
        Card {
            if let number { StepHeading(number: number, title: title) } else { Text(title).font(.headline).foregroundStyle(Brand.ink) }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .focused($editing)
                    .font(ImportDetector.looksLikeImportJSON(text) ? .system(.footnote, design: .monospaced) : .footnote)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 150, maxHeight: 260)
                    .padding(8)
                    .background(Brand.input, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityLabel(label)
                if !hasText {
                    Text(placeholder)
                        .font(.footnote).foregroundStyle(Brand.muted)
                        .padding(.horizontal, 13).padding(.vertical, 16).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
            HStack(spacing: 8) {
                PasteButton(payloadType: String.self) { strings in if let first = strings.first { text = first } }
                    .buttonBorderShape(.roundedRectangle(radius: 10)).labelStyle(.titleAndIcon)
                Button { choosingFile = true } label: { Label("PDF or file", systemImage: "folder") }.buttonStyle(SecondaryButtonStyle())
                Spacer()
                if hasText { Button("Clear", role: .destructive) { text = ""; error = "" }.font(.subheadline) }
            }
            Label(footnote, systemImage: "lock")
                .font(.caption).foregroundStyle(Brand.muted)
        }
    }

    private var previewBar: some View {
        VStack(spacing: 0) {
            Button { editing = false; Task { await makePass() } } label: {
                if busy {
                    HStack(spacing: 10) { ProgressView().tint(Brand.signalText); if !busyLabel.isEmpty { Text(busyLabel) } }
                } else {
                    Text(readsEmails ? "Make pass" : "Preview passes")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !hasText)
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .background(.bar)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "wallet.pass").font(.system(size: 40, weight: .light)).foregroundStyle(Brand.signal)
            Text("Your passes appear here").font(.headline).foregroundStyle(Brand.ink)
            Text(reader.isReady ? "Paste your ticket email and Apple Intelligence fills in the pass on this iPhone. Then add the barcode from a screenshot and add it to Wallet."
                                : "Check every detail against your ticket, add the barcode from a screenshot if it's missing, then add the pass to Wallet.")
                .font(.subheadline).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 20)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private var errorCard: some View {
        Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline).foregroundStyle(Brand.error)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.error.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityLabel("Problem: \(error)")
    }

    @ViewBuilder private func results(_ result: ImportResponse) -> some View {
        HStack {
            Text(result.value.passes.count == 1 ? "1 pass found" : "\(result.value.passes.count) passes found").font(.title3.weight(.semibold)).foregroundStyle(Brand.ink)
            Spacer()
            Button("Edit reply") { self.result = nil; editing = true }.font(.subheadline)
        }
        .padding(.top, 8)
        if result.value.passes.isEmpty {
            Card { Text("No passes found. Ask your AI to extract a ticket, booking, membership or coupon, then paste its reply.").font(.subheadline).foregroundStyle(Brand.muted) }
        }
        warnings(result.warnings)
        if result.value.passes.contains(where: { $0["needsTimeZone"] == .bool(true) }) {
            Card {
                Text("Check the time zone").font(.headline).foregroundStyle(Brand.ink)
                Text("Some times arrived without a time zone. Choose where the event or departure happens.").font(.subheadline).foregroundStyle(Brand.muted)
                Picker("Time zone", selection: $timeZone) { ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) } }
            }
        }
        if !notice.isEmpty { Label(notice, systemImage: "checkmark.circle.fill").font(.subheadline).foregroundStyle(Brand.signal) }
        ForEach(result.value.passes.indices, id: \.self) { index in
            VStack(alignment: .leading, spacing: 12) {
                if result.value.passes.count > 1 { Text("Pass \(index + 1)").font(.footnote.weight(.semibold)).foregroundStyle(Brand.muted) }
                NativePassPreview(pass: result.value.passes[index], layout: result.layouts[index])
                CodeFromImage(current: result.value.passes[index]["barcode"], suggested: suggestedCodes) { code in
                    self.result?.value.setBarcode(code, at: index)
                    notice = "Added the \(BarcodeReader.names[code.format] ?? "code") to pass \(index + 1)."
                }
                if result.signingAvailable {
                    WalletAddButton { Task { await addToWallet(index) } }
                        .frame(height: 50)
                        .disabled(busy || !PKAddPassesViewController.canAddPasses())
                        .accessibilityLabel("Add to Apple Wallet")
                } else {
                    Text("Pass signing isn't set up on this server yet, so this is a preview.").font(.caption).foregroundStyle(Brand.muted)
                }
            }
            .padding(.bottom, 8)
        }
    }

    @ViewBuilder private func warnings(_ notices: [ImportNotice]) -> some View {
        let checks = notices.filter { $0.kind != "fix" }
        let fixes = notices.filter { $0.kind == "fix" }
        if !checks.isEmpty {
            Card {
                Label("Check these details", systemImage: "exclamationmark.circle").font(.headline).foregroundStyle(Brand.ink)
                ForEach(checks.indices, id: \.self) { i in
                    Text((checks[i].from == "ai" ? "From your AI: " : "") + passPrefix(checks[i]) + checks[i].message).font(.subheadline).foregroundStyle(Brand.ink)
                }
            }
            .overlay(alignment: .leading) { Rectangle().fill(Brand.stub).frame(width: 3).padding(.vertical, 12) }
        }
        if !fixes.isEmpty {
            DisclosureGroup("\(fixes.count) \(fixes.count == 1 ? "change" : "changes") already applied") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(fixes.indices, id: \.self) { i in Text(passPrefix(fixes[i]) + fixes[i].message).font(.caption).foregroundStyle(Brand.muted) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
            }
            .font(.subheadline).padding(.horizontal, 4)
        }
    }

    private func passPrefix(_ notice: ImportNotice) -> String {
        guard let pass = notice.pass, let count = result?.value.passes.count, count > 1 else { return "" }
        return "Pass \(pass + 1): "
    }

    // MARK: Actions

    private func copyPrompt() {
        guard let url = Bundle.main.url(forResource: "extract-to-passclip", withExtension: "txt"), let prompt = try? String(contentsOf: url, encoding: .utf8) else {
            error = "The AI prompt is missing from the app. Reinstall Passclip and try again."
            return
        }
        UIPasteboard.general.string = prompt
        copied = true
        Task { try? await Task.sleep(for: .seconds(2)); copied = false }
    }

    /// A PDF, screenshot, photo or text file. The kind comes from the file's content, not its name.
    private func readFile(_ selection: Result<URL, Error>) {
        do {
            let url = try selection.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= DocumentReader.maxBytes else { throw DocumentError.tooLarge }
            let data = try Data(contentsOf: url)
            Task { await openDocument(data) }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func openDocument(_ data: Data) async {
        busy = true; busyLabel = "Reading your document…"; error = ""; defer { busy = false; busyLabel = "" }
        do {
            let document = try await DocumentReader.read(data)
            text = document.text; suggestedCodes = document.codes
        } catch { self.error = error.localizedDescription }
    }

    /// A pasted email is read on this iPhone first; an AI reply (JSON) goes straight to the preview.
    @MainActor private func makePass() async {
        error = ""
        if readsEmails {
            busy = true; busyLabel = "Reading your email…"
            let sent = text
            do {
                let json = try await EmailReader.extract(from: sent)
                // Editing while the model works must not replace the new text with a stale answer.
                guard text == sent else { busy = false; busyLabel = ""; return }
                text = json
            } catch {
                busy = false; busyLabel = ""
                self.error = error.localizedDescription
                return
            }
        }
        await preview()
    }

    @MainActor private func preview() async {
        busy = true; busyLabel = "Checking your pass…"; error = ""; defer { busy = false; busyLabel = "" }
        let sentText = text, sentServer = server, sentZone = timeZone
        do {
            let response = try await PassclipService(server: sentServer).preview(text: sentText, timeZone: sentZone)
            // Editing while a request is in flight must not replace current input with stale results.
            if text == sentText && server == sentServer && timeZone == sentZone {
                result = response; notice = ""
                // One pass and exactly one code read from the document the person shared: use it, and say so.
                // With several codes or passes, the person chooses (CLAUDE.md rule 3).
                if suggestedCodes.count == 1, let code = suggestedCodes.first, response.value.passes.count == 1,
                   response.value.passes[0]["barcode"]?["message"]?.string == nil {
                    result?.value.setBarcode(code, at: 0)
                    notice = "Added the \(BarcodeReader.names[code.format] ?? "code") found in your document. Check that it matches your ticket."
                }
            }
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

/// Reads a barcode from a screenshot or photo, on this device, and offers it for one pass.
private struct CodeFromImage: View {
    let current: JSONValue?
    var suggested: [FoundCode] = []
    let onUse: (FoundCode) -> Void
    @State private var item: PhotosPickerItem?
    @State private var reading = false
    @State private var found: [FoundCode] = []
    @State private var problem = ""
    @State private var fromDocument = false

    private var hasCode: Bool { current?["message"]?.string != nil }

    var body: some View {
        Card {
            if hasCode {
                Label("Barcode ready", systemImage: "checkmark.seal").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Text("To double-check it, choose a screenshot of the code from your ticket.").font(.caption).foregroundStyle(Brand.muted)
            } else {
                Label("No barcode yet", systemImage: "qrcode.viewfinder").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Text("Choose a screenshot or photo of the code from your ticket. Passclip reads it on this iPhone; the image isn't uploaded.").font(.caption).foregroundStyle(Brand.muted)
            }
            PhotosPicker(selection: $item, matching: .images) {
                Label(reading ? "Reading…" : (hasCode ? "Check with a screenshot" : "Add code from a screenshot"), systemImage: "photo.on.rectangle")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(reading)
            if !problem.isEmpty { Text(problem).font(.caption).foregroundStyle(Brand.error) }
            if fromDocument && !found.isEmpty { Text("Found in the document you shared. Check it, then choose it.").font(.caption).foregroundStyle(Brand.muted) }
            ForEach(found) { code in
                VStack(alignment: .leading, spacing: 6) {
                    Text(BarcodeReader.names[code.format] ?? code.format).font(.caption.weight(.semibold)).foregroundStyle(Brand.muted)
                    Text(code.message).font(.system(.footnote, design: .monospaced)).foregroundStyle(Brand.ink).textSelection(.enabled).lineLimit(4)
                    if BarcodeReader.newerFormats.contains(code.format) {
                        Text("Wallet shows this type on iOS 27 and later.").font(.caption2).foregroundStyle(Brand.muted)
                    }
                    if current?["message"]?.string == code.message && current?["format"]?.string == code.format {
                        Label("Matches the code in your pass", systemImage: "checkmark").font(.caption.weight(.semibold)).foregroundStyle(Brand.signal)
                    } else {
                        Button("Use this code") { onUse(code); found = [] }.buttonStyle(.borderedProminent).controlSize(.small)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.input, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .onAppear { if found.isEmpty && !hasCode && !suggested.isEmpty { found = suggested; fromDocument = true } }
        .onChange(of: item) { _, newItem in if let newItem { Task { await read(newItem) } } }
    }

    @MainActor private func read(_ item: PhotosPickerItem) async {
        reading = true; problem = ""; found = []; fromDocument = false
        defer { reading = false; self.item = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                problem = "This image couldn't be opened. Take a screenshot of the code and try that."; return
            }
            let codes = try await Task.detached(priority: .userInitiated) { try BarcodeReader.read(image) }.value
            if codes.isEmpty { problem = "No barcode found. Try a sharper screenshot that shows the whole code." }
            found = codes
        } catch {
            problem = "This image couldn't be read. Take a screenshot of the code and try that."
        }
    }
}

private struct SettingsSheet: View {
    @Binding var server: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://passclip.vercel.app", text: $server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("Passclip server") } footer: {
                    Text("Previews and Wallet passes are made by this HTTPS server. It doesn't save your tickets.")
                }
                Section { Button("Use the default server") { server = "https://passclip.vercel.app" } }
            }
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
