import EventKit
import EventKitUI
import SwiftUI

/// A calendar event for a pass, with the same rules as the website's .ics file (src/lib/calendar/ics.ts):
/// event tickets and travel with a start; two hours long unless an end is given (one for travel); an alert
/// two hours before an event, three before a flight and thirty minutes before other travel.
enum CalendarEvent {
    static func offered(for pass: JSONValue) -> Bool {
        guard pass["start"]?.string != nil else { return false }
        if case .bool(let add) = pass["calendar"]?["add"] { return add }
        return ["eventTicket", "boardingPass"].contains(pass["type"]?.string ?? "")
    }

    static func event(for pass: JSONValue, in store: EKEventStore) -> EKEvent? {
        guard offered(for: pass), let startText = pass["start"]?.string else { return nil }
        let event = EKEvent(eventStore: store)
        let travel = pass["type"]?.string == "boardingPass"
        let transit = pass["transit"]
        let number = transit?["number"]?.string
        let title = pass["title"]?.string ?? "Event"
        event.title = pass["calendar"]?["title"]?.string ?? (travel && number != nil ? "\(number!) \(title)" : title)
        if let zone = pass["timeZone"]?.string.flatMap(TimeZone.init(identifier:)) { event.timeZone = zone }

        if startText.count == 10, let day = dayFormatter.date(from: startText) {
            event.isAllDay = true
            event.startDate = day
            event.endDate = day
        } else {
            guard let start = parse(startText) else { return nil }
            let end = pass["end"]?.string.flatMap(parse).flatMap { $0 > start ? $0 : nil }
            event.startDate = start
            event.endDate = end ?? start.addingTimeInterval(travel ? 3_600 : 7_200)
        }

        let venue = pass["venue"]
        let place = travel
            ? [stop(transit?["from"]), stop(transit?["to"])].compactMap { $0 }.joined(separator: " → ")
            : [venue?["name"], venue?["room"], venue?["address"], venue?["city"], venue?["country"]].compactMap { $0?.string }.joined(separator: ", ")
        if !place.isEmpty { event.location = place }

        let seat = pass["seat"]
        let seatLine = [seat?["section"]?.string.map { "Section \($0)" }, seat?["row"]?.string.map { "row \($0)" }, seat?["number"]?.string.map { "seat \($0)" }, seat?["description"]?.string]
            .compactMap { $0 }.joined(separator: ", ")
        event.notes = [seatLine.isEmpty ? nil : seatLine, transit?["gate"]?.string.map { "Gate: \($0)" }, pass["confirmationCode"]?.string.map { "Confirmation: \($0)" }, pass["notes"]?.string]
            .compactMap { $0 }.joined(separator: "\n")

        let minutes: Int = !travel ? 120 : transit?["mode"]?.string == "air" ? 180 : 30
        event.addAlarm(EKAlarm(relativeOffset: TimeInterval(-minutes * 60)))
        return event
    }

    private static func stop(_ value: JSONValue?) -> String? { value?["name"]?.string ?? value?["city"]?.string ?? value?["code"]?.string }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text)
    }
}

/// Apple's own "New Event" sheet, filled in. Since iOS 17 it needs no calendar permission: the person saves the
/// event themselves, and the app never reads their calendar.
struct CalendarSheet: UIViewControllerRepresentable {
    let event: EKEvent
    let store: EKEventStore
    let onDone: (EKEventEditViewAction) -> Void

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onDone: (EKEventEditViewAction) -> Void
        init(onDone: @escaping (EKEventEditViewAction) -> Void) { self.onDone = onDone }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) { onDone(action) }
    }
}
