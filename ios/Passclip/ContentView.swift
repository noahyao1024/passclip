import SwiftUI
import EventKit
import PassKit
import PhotosUI
import UniformTypeIdentifiers

struct ContentView: View {
    @AppStorage("serverURL", store: UserDefaults(suiteName: "group.noahyao.passclip")) private var server = "https://passclip.see.sg"
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
    @State private var source: DocumentSource
    @State private var linkChoices: [LinkChoice]
    /// Event pictures the person chose, by pass number, and one a ticket page offered.
    @State private var pictures: [Int: UIImage] = [:]
    @State private var suggestedPicture: UIImage?
    /// The shared screenshot or PDF page, shown to Apple Intelligence along with the text when it can see pictures.
    @State private var documentImage: Data?
    /// Each pass's colors before a picture changed them, to put back if the picture is removed.
    @State private var savedStyles: [Int: JSONValue] = [:]
    @State private var calendarEvent: EKEvent?
    @ObservedObject private var pending = PendingInput.shared
    @ObservedObject private var history = PassHistory.shared
    @AppStorage("seenOnboarding") private var seenOnboarding = false
    @State private var showingAllChecks = false
    @State private var showingSettings = false
    @State private var walletPasses: [PKPass] = []
    /// Codes read from each document of a batch, by pass number, to put on the right pass.
    @State private var batchCodes: [Int: FoundCode] = [:]
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showingWallet = false
    @FocusState private var editing: Bool
    @Environment(\.scenePhase) private var scenePhase
    private let onClose: (() -> Void)?
    private let startOnAppear: Bool
    /// Several files shared at once from the share sheet.
    private let startingDocuments: [ReadDocument]

    /// `startOnAppear` makes the pass right away, for text, links and files shared from Mail, Safari or Files.
    init(_ incoming: Incoming = Incoming(), onClose: (() -> Void)? = nil, startOnAppear: Bool = false) {
        _text = State(initialValue: incoming.text)
        _suggestedCodes = State(initialValue: incoming.codes)
        _source = State(initialValue: incoming.source)
        // The first link is the original; the others start switched off.
        _linkChoices = State(initialValue: incoming.links.enumerated().map { LinkChoice(link: $0.element, on: $0.offset == 0) })
        _error = State(initialValue: incoming.problem)
        _suggestedPicture = State(initialValue: incoming.picture.flatMap(UIImage.init(data:)))
        self.onClose = onClose
        self.startOnAppear = startOnAppear
        startingDocuments = incoming.documents
    }

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var readsEmails: Bool { reader.isReady && !ImportDetector.looksLikeImportJSON(text) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // With results, the passes take the screen; "Edit reply" brings the steps back.
                    if result == nil {
                        // The big welcome is for first visits; returning people go straight to their passes.
                        if history.passes.isEmpty { header }
                        // Returning people see their passes first; a new one starts in the box below.
                        if !history.passes.isEmpty && !busy { HistorySection(history: history) { open($0) } }
                        if reader.isReady {
                            pasteCard(number: nil, title: "Paste your ticket email", placeholder: "Select the text of your ticket email, copy it, and paste it here. A link to your ticket works too.",
                                      label: "Ticket email, link or AI reply", footnote: "Your email is read on this iPhone. Only the pass details found in it go to your Passclip server for the preview.")
                            linksCard
                            otherAI
                        } else {
                            if case .unavailable(let reason) = reader { Label(reason, systemImage: "sparkles").font(.footnote).foregroundStyle(Brand.muted) }
                            askStep
                            if source.kind != "email" { Label("Your document's text is in the box below. Copy it into your AI chat after the prompt, then paste the reply here.", systemImage: "info.circle").font(.footnote).foregroundStyle(Brand.muted) }
                            pasteCard(number: 2, title: "Paste the AI's reply", placeholder: "{ \"schemaVersion\": \"1.1\", \"passes\": [ … ] }",
                                      label: "AI reply", footnote: "Previews are checked by your Passclip server and not saved.")
                        }
                    }
                    if !error.isEmpty { errorCard }
                    if let result {
                        results(result).transition(.opacity.combined(with: .move(edge: .bottom)))
                    } else if !busy {
                        if history.passes.isEmpty { emptyState }
                    }
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
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.item], allowsMultipleSelection: true) { readFiles($0) }
            .sheet(isPresented: $showingSettings) { SettingsSheet(server: $server) }
            // The first time the app opens (not in the share sheet): three cards on how it works.
            .sheet(isPresented: Binding(get: { onClose == nil && !seenOnboarding && !startOnAppear }, set: { if !$0 { seenOnboarding = true } })) {
                OnboardingSheet { seenOnboarding = true }
            }
            .sheet(isPresented: $showingWallet) { if !walletPasses.isEmpty { WalletSheet(passes: walletPasses) { showingWallet = false; walletPasses = [] } } }
            .onChange(of: photoItems) { _, items in if !items.isEmpty { Task { await openPhotos(items) } } }
            .task {
                if !startingDocuments.isEmpty { await makeBatch(startingDocuments) }
                else if startOnAppear && hasText { await makePass() }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active { reader = EmailReader.status } }
            .onChange(of: text) { _, _ in result = nil; notice = ""; pictures = [:]; savedStyles = [:] }
            .onReceive(pending.$incoming) { incoming in
                // Siri or Shortcuts sent a ticket: start over with it and make the pass.
                guard let incoming else { return }
                pending.incoming = nil
                if !incoming.documents.isEmpty { Task { await makeBatch(incoming.documents) }; return }
                apply(incoming)
                if !incoming.text.isEmpty { Task { await makePass() } }
            }
            .sheet(isPresented: Binding(get: { calendarEvent != nil }, set: { if !$0 { calendarEvent = nil } })) {
                if let calendarEvent {
                    CalendarSheet(event: calendarEvent, store: Self.eventStore) { action in
                        self.calendarEvent = nil
                        if action == .saved { notice = "Added to your calendar." }
                    }
                    .ignoresSafeArea()
                }
            }
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

    /// Links found in a document or opened by the person, for the back of the pass.
    @ViewBuilder private var linksCard: some View {
        if readsEmails && !linkChoices.isEmpty {
            Card {
                Label("Links for the back of the pass", systemImage: "link").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                ForEach($linkChoices) { $choice in
                    Toggle(isOn: $choice.on) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.link.title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                            Text(choice.link.display).font(.caption).foregroundStyle(Brand.muted).lineLimit(1).truncationMode(.middle)
                        }
                    }
                }
                Text("Found in your document. In Wallet, a link lets you open the original.").font(.caption).foregroundStyle(Brand.muted)
            }
        }
    }

    private func pasteCard(number: Int?, title: String, placeholder: String, label: String, footnote: String) -> some View {
        Card {
            HStack {
                if let number { StepHeading(number: number, title: title) } else { Text(title).font(.headline).foregroundStyle(Brand.ink) }
                Spacer()
                if hasText { Button("Clear", role: .destructive) { text = ""; error = ""; resetSource() }.font(.subheadline) }
            }
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
                PasteButton(payloadType: String.self) { strings in if let first = strings.first { text = first; resetSource() } }
                    .buttonBorderShape(.roundedRectangle(radius: 10)).labelStyle(.titleAndIcon)
                Button { choosingFile = true } label: { Label("Files", systemImage: "folder").lineLimit(1).fixedSize() }.buttonStyle(SecondaryButtonStyle())
                    .accessibilityHint("Choose one or more PDFs, screenshots or text files")
                PhotosPicker(selection: $photoItems, maxSelectionCount: BatchImport.maxDocuments, matching: .images) { Label("Photos", systemImage: "photo.on.rectangle").lineLimit(1).fixedSize() }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityHint("Choose one or more screenshots of tickets")
                Spacer()
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
            Text(reader.isReady ? "Paste a ticket email or link, or choose a PDF or screenshot. Apple Intelligence fills in the pass on this iPhone, with the barcode from your ticket. Check it, then add it to Wallet."
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
        if result.value.passes.count > 1 && result.signingAvailable {
            Button { Task { await addAllToWallet() } } label: {
                Label("Add all \(result.value.passes.count) to Apple Wallet", systemImage: "wallet.pass")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !PKAddPassesViewController.canAddPasses())
        }
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
                NativePassPreview(pass: result.value.passes[index], layout: result.layouts[index], artwork: result.artwork(at: index), picture: pictures[index])
                // The main action sits right under the pass. A pass without a barcode asks for one first.
                let hasCode = result.value.passes[index]["barcode"]?["message"]?.string != nil
                if !hasCode { codeCard(index) }
                if result.signingAvailable {
                    WalletAddButton { Task { await addToWallet(index) } }
                        .frame(height: 50)
                        .disabled(busy || !PKAddPassesViewController.canAddPasses())
                        .accessibilityLabel("Add to Apple Wallet")
                } else {
                    Text("Pass signing isn't set up on this server yet, so this is a preview.").font(.caption).foregroundStyle(Brand.muted)
                }
                MoreOptions {
                    if CalendarEvent.offered(for: result.value.passes[index]) {
                        Button { calendarEvent = CalendarEvent.event(for: result.value.passes[index], in: Self.eventStore) } label: {
                            Label("Add to Calendar", systemImage: "calendar.badge.plus")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if ["eventTicket", "generic"].contains(result.value.passes[index]["type"]?.string ?? "") {
                        EventPictureCard(picture: Binding(get: { pictures[index] }, set: { setPicture($0, at: index) }))
                    }
                    if hasCode { codeCard(index) }
                }
            }
            .padding(.bottom, 8)
        }
    }

    @ViewBuilder private func warnings(_ notices: [ImportNotice]) -> some View {
        let checks = notices.filter { $0.kind != "fix" }
        let fixes = notices.filter { $0.kind == "fix" }
        // Read on this iPhone, the notes are Passclip's own, not another AI's.
        let readHere = notices.contains { $0.message == ImportJSONBuilder.aiWarning }
        if !checks.isEmpty {
            Card {
                Label("Check these details", systemImage: "exclamationmark.circle").font(.headline).foregroundStyle(Brand.ink)
                // The first two, then the rest on request, so the pass stays the main thing on screen.
                ForEach(checks.indices.prefix(showingAllChecks ? checks.count : 2), id: \.self) { i in
                    Text((checks[i].from == "ai" && !readHere ? "From your AI: " : "") + passPrefix(checks[i]) + checks[i].message).font(.subheadline).foregroundStyle(Brand.ink)
                }
                if checks.count > 2 {
                    Button(showingAllChecks ? "Show fewer" : "Show \(checks.count - 2) more") { withAnimation { showingAllChecks.toggle() } }.font(.subheadline.weight(.semibold))
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

    /// PDFs, screenshots, photos or text files. The kind comes from each file's content, not its name.
    private func readFiles(_ selection: Result<[URL], Error>) {
        do {
            let urls = try selection.get()
            var files: [(Data, String)] = []
            for url in urls.prefix(BatchImport.maxDocuments) {
                let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= DocumentReader.maxBytes else { throw DocumentError.tooLarge }
                files.append((try Data(contentsOf: url), url.lastPathComponent))
            }
            if files.count == 1 { Task { await openDocument(files[0].0, name: files[0].1) } }
            else if !files.isEmpty { Task { await openBatch(files) } }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func openPhotos(_ items: [PhotosPickerItem]) async {
        defer { photoItems = [] }
        var files: [(Data, String?)] = []
        for item in items { if let data = try? await item.loadTransferable(type: Data.self) { files.append((data, nil)) } }
        guard !files.isEmpty else { error = "These pictures couldn't be opened. Take screenshots of your tickets and try those."; return }
        if files.count == 1 { await openDocument(files[0].0, name: files[0].1) } else { await openBatch(files) }
    }

    /// Reads every document on this iPhone, then makes one pass per ticket.
    @MainActor private func openBatch(_ files: [(Data, String?)]) async {
        error = ""
        var documents: [ReadDocument] = []
        busy = true
        for (index, file) in files.enumerated() {
            busyLabel = "Opening \(index + 1) of \(files.count)…"
            if let document = try? await DocumentReader.read(file.0, name: file.1) { documents.append(document) }
        }
        busy = false; busyLabel = ""
        await makeBatch(documents)
    }

    @MainActor private func makeBatch(_ documents: [ReadDocument]) async {
        guard !documents.isEmpty else { error = "Passclip couldn't read these files. Choose PDFs or screenshots of your tickets."; return }
        guard reader.isReady else {
            // One PDF with several tickets still opens as one document; the person matches each code to its pass.
            if documents.count == 1 { apply(documents[0]); return }
            error = "Reading several tickets at once needs Apple Intelligence on this iPhone. Choose them one at a time and use the AI-chat steps."
            return
        }
        busy = true; defer { busy = false; busyLabel = "" }
        do {
            let outcome = try await BatchImport.read(documents) { done, total in busyLabel = "Reading ticket \(done) of \(total)…" }
            resetSource()
            text = outcome.json
            batchCodes = outcome.codes
            busy = false
            await preview()
            if outcome.skipped > 0 { notice = [notice, "\(outcome.skipped) of \(outcome.total) pages or files had no ticket Passclip could read."].filter { !$0.isEmpty }.joined(separator: " ") }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func openDocument(_ data: Data, name: String?) async {
        busy = true; busyLabel = "Reading your document…"; error = ""; defer { busy = false; busyLabel = "" }
        do {
            let document = try await DocumentReader.read(data, name: name)
            // A PDF with several tickets, each with its own code: one pass per ticket, each with its own code.
            if document.tickets.count > 1 && reader.isReady { busy = false; await makeBatch([document]) } else { apply(document) }
        } catch { self.error = error.localizedDescription }
    }

    /// A pasted link is opened first, then the text is read on this iPhone. An AI reply (JSON) goes straight to the preview.
    @MainActor private func makePass() async {
        error = ""
        if let url = LinkFetcher.link(in: text) {
            guard await openLink(url) else { return }
        }
        if readsEmails {
            busy = true; busyLabel = "Reading your ticket…"
            let sent = text
            let context = ImportContext(source: source, links: linkChoices.filter(\.on).map(\.link), hasCodes: !suggestedCodes.isEmpty, image: documentImage)
            do {
                let json = try await EmailReader.extract(from: sent, context: context)
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

    /// Opens a web link from this iPhone and puts what it holds in the box.
    @MainActor private func openLink(_ url: URL) async -> Bool {
        busy = true; busyLabel = "Opening the link…"; defer { busy = false; busyLabel = "" }
        do {
            apply(try await LinkFetcher.open(url))
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func apply(_ document: ReadDocument) {
        text = document.text; suggestedCodes = document.codes; source = document.source; documentImage = document.pageImage
        suggestedPicture = document.picture.flatMap(UIImage.init(data:))
        linkChoices = document.links.enumerated().map { LinkChoice(link: $0.element, on: $0.offset == 0) }
    }

    private func codeCard(_ index: Int) -> some View {
        CodeFromImage(current: result?.value.passes[index]["barcode"], suggested: suggestedCodes) { code in
            self.result?.value.setBarcode(code, at: index)
            notice = "Added the \(BarcodeReader.names[code.format] ?? "code") to pass \(index + 1)."
        }
    }

    /// Reopens a saved pass: its JSON goes back in the box and is previewed again.
    private func open(_ saved: SavedPass) {
        resetSource()
        text = saved.text
        Task { await makePass() }
    }

    private static let eventStore = EKEventStore()

    private func apply(_ incoming: Incoming) {
        text = incoming.text; suggestedCodes = incoming.codes; source = incoming.source; error = incoming.problem
        linkChoices = incoming.links.enumerated().map { LinkChoice(link: $0.element, on: $0.offset == 0) }
        suggestedPicture = incoming.picture.flatMap(UIImage.init(data:))
    }

    /// A picture also gives the pass its colors, so card and poster match. Removing it puts the colors back.
    private func setPicture(_ image: UIImage?, at index: Int) {
        guard let pass = result?.value.passes[safe: index] else { return }
        pictures[index] = image
        if let image, let colors = PosterImage.passColors(from: image) {
            if savedStyles[index] == nil { savedStyles[index] = pass["style"] ?? .null }
            let style = JSONValue.object(["backgroundColor": .string(colors.background), "foregroundColor": .string(colors.foreground), "labelColor": .string(colors.label)])
            result?.value.passes[index] = pass.setting("style", to: style)
        } else if image == nil, let saved = savedStyles.removeValue(forKey: index) {
            result?.value.passes[index] = saved == .null ? pass.removing("style") : pass.setting("style", to: saved)
        } else { return }
        Task { await refreshArtwork(index) }
    }

    /// The picture behind the card follows the pass's colors, so ask the server for it again.
    @MainActor private func refreshArtwork(_ index: Int) async {
        guard let current = result, let payload = try? current.value.singlePassText(at: index) else { return }
        guard let response = try? await PassclipService(server: server).preview(text: payload, timeZone: timeZone),
              result?.value.passes.indices.contains(index) == true else { return }
        if result?.artwork == nil { result?.artwork = Array(repeating: nil, count: result?.value.passes.count ?? 0) }
        if result?.artwork?.indices.contains(index) == true { result?.artwork?[index] = response.artwork?.first ?? nil }
        if let style = response.value.passes.first?["style"] { result?.value.passes[index] = result!.value.passes[index].setting("style", to: style) }
    }

    private func resetSource() { source = DocumentSource(); suggestedCodes = []; linkChoices = []; suggestedPicture = nil; batchCodes = [:]; documentImage = nil }

    @MainActor private func preview() async {
        busy = true; busyLabel = "Checking your pass…"; error = ""; defer { busy = false; busyLabel = "" }
        let sentText = text, sentServer = server, sentZone = timeZone
        do {
            let response = try await PassclipService(server: sentServer).preview(text: sentText, timeZone: sentZone)
            // Editing while a request is in flight must not replace current input with stale results.
            if text == sentText && server == sentServer && timeZone == sentZone {
                withAnimation(.spring(duration: 0.45)) { result = response }
                notice = ""
                // One pass and exactly one code read from the document the person shared: use it, and say so.
                // With several codes or passes, the person chooses (CLAUDE.md rule 3).
                if suggestedCodes.count == 1, let code = suggestedCodes.first, response.value.passes.count == 1,
                   response.value.passes[0]["barcode"]?["message"]?.string == nil {
                    result?.value.setBarcode(code, at: 0)
                    notice = "Added the \(BarcodeReader.names[code.format] ?? "code") found in your document. Check that it matches your ticket."
                }
                // A batch: each document's own code goes on the pass made from it.
                if !batchCodes.isEmpty {
                    for (index, code) in batchCodes where response.value.passes.indices.contains(index) && response.value.passes[index]["barcode"]?["message"]?.string == nil {
                        result?.value.setBarcode(code, at: index)
                    }
                    notice = "Added the codes found in your files. Check each one against its ticket."
                }
                // The ticket page's own picture goes on the first event pass; the person can change or remove it.
                if pictures.isEmpty, let picture = suggestedPicture, response.value.passes.first?["type"]?.string == "eventTicket" {
                    pictures[0] = picture
                    notice = [notice, "Added the picture from the ticket page."].filter { !$0.isEmpty }.joined(separator: " ")
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    /// Signs every pass, then shows them together in one Wallet sheet.
    @MainActor private func addAllToWallet() async {
        guard let result else { return }
        busy = true; error = ""; defer { busy = false; busyLabel = "" }
        var signed: [PKPass] = []
        do {
            for index in result.value.passes.indices {
                busyLabel = "Preparing pass \(index + 1) of \(result.value.passes.count)…"
                let payload = try result.value.singlePassText(at: index)
                var thumbnail: [String: String]?
                if let picture = pictures[index] { thumbnail = PosterImage.thumbnailFiles(from: picture) }
                let data = try await PassclipService(server: server).signedPass(text: payload, timeZone: timeZone, thumbnail: thumbnail)
                signed.append(try PKPass(data: data))
                history.save(pass: result.value.passes[index], text: payload)
            }
            walletPasses = signed; showingWallet = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func addToWallet(_ index: Int) async {
        guard let result else { return }
        busy = true; error = ""; defer { busy = false }
        do {
            let payload = try result.value.singlePassText(at: index)
            var thumbnail: [String: String]?
            if let picture = pictures[index] {
                guard let files = PosterImage.thumbnailFiles(from: picture) else { throw ServiceError.rejected("This picture couldn't be used. Choose another one, or remove it.") }
                thumbnail = files
            }
            let data = try await PassclipService(server: server).signedPass(text: payload, timeZone: timeZone, thumbnail: thumbnail)
            walletPasses = [try PKPass(data: data)]; showingWallet = true
            history.save(pass: result.value.passes[index], text: payload)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription }
    }
}

/// A poster or photo for the pass: Wallet shows it next to the title.
private struct EventPictureCard: View {
    @Binding var picture: UIImage?
    @State private var item: PhotosPickerItem?
    @State private var problem = ""

    var body: some View {
        Card {
            Label(picture == nil ? "Add an event picture" : "Event picture", systemImage: "photo").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Text("A poster or photo shows next to the title in Wallet. It's added to the pass and not kept anywhere else.").font(.caption).foregroundStyle(Brand.muted)
            HStack(spacing: 8) {
                PhotosPicker(selection: $item, matching: .images) {
                    Label(picture == nil ? "Choose a picture" : "Change picture", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(SecondaryButtonStyle())
                if picture != nil { Button("Remove", role: .destructive) { picture = nil }.font(.subheadline) }
            }
            if !problem.isEmpty { Text(problem).font(.caption).foregroundStyle(Brand.error) }
        }
        .onChange(of: item) { _, newItem in if let newItem { Task { await load(newItem) } } }
    }

    @MainActor private func load(_ item: PhotosPickerItem) async {
        problem = ""
        defer { self.item = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
              PosterImage.thumbnailFiles(from: image) != nil else {
            problem = "This picture couldn't be used. Choose another one."
            return
        }
        picture = image
    }
}

/// A link that may go on the back of the pass, and whether the person wants it.
private struct LinkChoice: Identifiable, Equatable {
    var link: FoundLink
    var on: Bool
    var id: String { link.url }
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
                    TextField("https://passclip.see.sg", text: $server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("Passclip server") } footer: {
                    Text("Previews and Wallet passes are made by this HTTPS server. It doesn't save your tickets.")
                }
                Section { Button("Use the default server") { server = "https://passclip.see.sg" } }
            }
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

/// Extra things to do with a pass, folded away so "Add to Apple Wallet" stays the one obvious step.
private struct MoreOptions<Content: View>: View {
    @ViewBuilder var content: Content
    @State private var open = false
    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 12) { content }.padding(.top, 10)
        } label: {
            Label("More options", systemImage: "ellipsis.circle").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        }
        .padding(.horizontal, 4)
    }
}
