import SwiftUI

/// A pass the person added to Wallet, kept on this iPhone only so they can find and reopen it.
struct SavedPass: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var organization: String?
    var type: String
    /// ISO date or date-time with offset, as the server normalized it.
    var start: String?
    var venue: String?
    var backgroundColor: String?
    /// The single-pass import JSON, so the pass can be previewed and added again.
    var text: String
    var savedAt = Date()

    var startDate: Date? { start.flatMap(CalendarEvent.parse) ?? start.flatMap { $0.count == 10 ? Self.day.date(from: $0) : nil } }
    var isUpcoming: Bool { (startDate ?? .distantFuture) >= Calendar.current.startOfDay(for: .now) }
    private static let day: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()
}

/// The person's passes, newest first, in the app group so the share sheet adds to the same list. Nothing leaves the iPhone.
@MainActor final class PassHistory: ObservableObject {
    static let shared = PassHistory()
    @Published private(set) var passes: [SavedPass] = []
    private let url: URL?

    init(directory: URL? = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.noahyao.passclip")) {
        url = directory?.appendingPathComponent("passes.json")
        if let url, let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([SavedPass].self, from: data) { passes = saved }
    }

    /// Upcoming passes, soonest first, then past ones, latest first.
    var upcoming: [SavedPass] { passes.filter(\.isUpcoming).sorted { ($0.startDate ?? .distantFuture) < ($1.startDate ?? .distantFuture) } }
    var past: [SavedPass] { passes.filter { !$0.isUpcoming }.sorted { ($0.startDate ?? .distantPast) > ($1.startDate ?? .distantPast) } }

    func save(pass: JSONValue, text: String) {
        let entry = SavedPass(title: pass["title"]?.string ?? "Pass", organization: pass["organization"]?.string, type: pass["type"]?.string ?? "generic",
                              start: pass["start"]?.string, venue: pass["venue"]?["name"]?.string, backgroundColor: pass["style"]?["backgroundColor"]?.string, text: text)
        // The same pass added again replaces its earlier copy.
        passes.removeAll { $0.text == text || ($0.title == entry.title && $0.start == entry.start && $0.organization == entry.organization) }
        passes.insert(entry, at: 0)
        write()
    }

    func remove(_ pass: SavedPass) {
        passes.removeAll { $0.id == pass.id }
        write()
    }

    private func write() {
        guard let url, let data = try? JSONEncoder().encode(passes) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
    }
}

/// "Your passes" on the start screen: upcoming first, each one reopens with a tap.
struct HistorySection: View {
    @ObservedObject var history: PassHistory
    let onOpen: (SavedPass) -> Void
    @State private var showingPast = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your passes").font(.title3.weight(.semibold)).foregroundStyle(Brand.ink)
            ForEach(history.upcoming) { row($0) }
            if !history.past.isEmpty {
                DisclosureGroup(isExpanded: $showingPast) {
                    VStack(spacing: 10) { ForEach(history.past) { row($0) } }.padding(.top, 8)
                } label: {
                    Text("Past events (\(history.past.count))").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.muted)
                }
            }
        }
    }

    private func row(_ pass: SavedPass) -> some View {
        Button { onOpen(pass) } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hexString: pass.backgroundColor ?? "#3346D3"))
                    .frame(width: 44, height: 56)
                    .overlay(Image(systemName: icon(pass.type)).font(.body.weight(.semibold)).foregroundStyle(.white))
                VStack(alignment: .leading, spacing: 3) {
                    Text(pass.title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink).lineLimit(2).multilineTextAlignment(.leading)
                    Text(subtitle(pass)).font(.caption).foregroundStyle(Brand.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Brand.muted)
            }
            .padding(12)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.border.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .contextMenu { Button("Remove from this list", systemImage: "trash", role: .destructive) { withAnimation { history.remove(pass) } } }
        .accessibilityHint("Opens the pass again")
    }

    private func subtitle(_ pass: SavedPass) -> String {
        var parts: [String] = []
        if let date = pass.startDate, let start = pass.start { parts.append(Self.localTime(date, written: start)) }
        if let place = pass.venue ?? pass.organization { parts.append(place) }
        return parts.joined(separator: " · ")
    }

    /// The time at the event's own place, as the ticket and Wallet show it, not converted to this iPhone's zone.
    static func localTime(_ date: Date, written: String) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        if written.count == 10 { formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.timeStyle = .none; return formatter.string(from: date) }
        formatter.timeStyle = .short
        if let range = written.range(of: #"[+-]\d{2}:\d{2}$"#, options: .regularExpression) {
            let offset = written[range], parts = offset.dropFirst().split(separator: ":")
            formatter.timeZone = TimeZone(secondsFromGMT: ((Int(parts[0]) ?? 0) * 60 + (Int(parts[1]) ?? 0)) * 60 * (offset.hasPrefix("-") ? -1 : 1))
        } else if written.hasSuffix("Z") { formatter.timeZone = TimeZone(secondsFromGMT: 0) }
        return formatter.string(from: date)
    }

    private func icon(_ type: String) -> String {
        switch type {
        case "boardingPass": return "airplane"
        case "storeCard": return "creditcard"
        case "coupon": return "tag"
        case "eventTicket": return "ticket"
        default: return "wallet.pass"
        }
    }
}

extension Color {
    init(hexString: String) {
        let value = UInt64(hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x3346D3
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}

/// Three cards the first time the app opens: the ways in, and what to check.
struct OnboardingSheet: View {
    let onDone: () -> Void
    @State private var page = 0
    private let pages: [(icon: String, title: String, text: String)] = [
        ("doc.on.clipboard", "Paste, share or open", "Paste a ticket email or a link, or choose a PDF or screenshot. Passclip reads it on this iPhone and makes the pass."),
        ("square.and.arrow.up", "Share straight from Mail", "In Mail, select the ticket email’s text and tap Share, then Passclip. For a PDF ticket, open it and share it the same way."),
        ("checkmark.seal", "Check, then add to Wallet", "Passclip shows what to check. The barcode always comes from your own ticket. You can also say “Make a pass with Passclip” to Siri."),
    ]

    var body: some View {
        VStack(spacing: 24) {
            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { index in
                    VStack(spacing: 18) {
                        Image(systemName: pages[index].icon).font(.system(size: 54, weight: .regular)).foregroundStyle(Brand.signal)
                            .frame(width: 110, height: 110).background(Brand.signal.opacity(0.12), in: Circle())
                        Text(pages[index].title).font(.title2.weight(.bold)).foregroundStyle(Brand.ink).multilineTextAlignment(.center)
                        Text(pages[index].text).font(.body).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 28)
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            Button(page < pages.count - 1 ? "Next" : "Get started") {
                if page < pages.count - 1 { withAnimation { page += 1 } } else { onDone() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 24)
        .background(Brand.paper.ignoresSafeArea())
        .interactiveDismissDisabled(false)
    }
}
