import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Passclip",
  description: "How Passclip handles your ticket emails and pass previews.",
};

export default function PrivacyPage() {
  return (
    <main id="main" className="page-shell privacy-page">
      <Link className="text-link" href="/">← Back to your tickets</Link>
      <h1>Your tickets stay with you.</h1>
      <p>
        Passclip currently makes previews in your browser. There are no accounts,
        stored passes, or third-party trackers. The only things Passclip stores
        are files you choose to attach to a pass.
      </p>

      <h2>What happens to your import</h2>
      <p>
        The AI reply you paste, drop, or choose as a file is read and checked in
        your browser. Names, ticket details, links, and barcode text are used to
        draw the preview. Previewing on this website does not send that content
        to a Passclip server, save it in browser storage, or include it in logs.
        Choosing a Wallet download sends the selected pass for signing.
      </p>
      <p>
        The app keeps your input in memory while you work. Clear it when you are
        finished. Your browser may restore page contents when you go back, and
        copied text stays on your clipboard until you replace it. Attachment
        links open only when you choose them; those websites have their own
        privacy policies.
      </p>

      <h2>Barcode screenshots</h2>
      <p>
        When you add a screenshot or photo of a barcode, your browser reads the
        code on your device. The image is never uploaded or saved. A code is
        only added to your pass when you choose it.
      </p>
      <h2>You choose the AI service</h2>
      <p>
        Copying our prompt does not contact an AI service. If you fill in the
        optional ticket email box, that text stays in your browser and is added
        to the prompt on your clipboard when you copy it.
      </p>
      <p>
        When you paste into an AI chat, your email goes to the service you choose.
        Its privacy policy applies there. Remove anything you do not want to
        share, including unrelated messages or personal details.
      </p>

      <h2>What the website receives</h2>
      <p>
        Opening Passclip sends ordinary page and asset requests to our hosting
        service. Like any website host, it receives connection information such
        as your IP address. Your ticket content is not part of those requests.
        The heading font is served with the website, so your browser does not
        contact Google Fonts.
      </p>

      <h2>Calendar files</h2>
      <p>
        Choosing Add to calendar sends that pass to the server, which turns it
        into a calendar file and sends it straight back. The server doesn’t
        store the pass or log its contents.
      </p>
      <h2>Wallet downloads and native previews</h2>
      <p>
        When signing is configured, choosing Add to Apple Wallet sends that
        pass to the server to build and sign a Wallet file. The server does not
        store the pass or log its contents. Native app previews also send your
        import to the server for validation; the app explains this before you
        send it. Signing keys remain on the server. Files you attach are
        linked from the pass, never put inside it.
      </p>

      <h2>The iPhone app and your emails</h2>
      <p>
        On an iPhone with Apple Intelligence, the app reads a ticket email you
        paste or share with Apple’s model on the iPhone itself. The email is not
        sent to Passclip. Only the pass details found in it, such as the title,
        date and venue, go to the server to make the preview and the Wallet
        pass, and the server does not store them.
      </p>
      <p>
        PDFs, screenshots and photos you choose or share are read the same way,
        on the iPhone. If you paste a web link, the app opens it from your
        iPhone, as Safari would, and reads the page there. The page and the
        file never go to Passclip. If you switch it on, a link found in your
        document goes on the back of the pass.
      </p>
      <p>
        If you add an event picture, or the ticket page you opened has one,
        the app shrinks it on your iPhone and sends it to the server with the
        pass details only so it can be put inside your Wallet pass. The server
        does not store it.
      </p>
      <p>
        Add to Calendar in the app opens Apple’s own new-event screen, filled in
        on your iPhone. You save the event yourself; Passclip never reads your
        calendar.
      </p>

      <h2>Files you attach</h2>
      <p>
        When you attach a PDF or photo to a pass, your browser uploads it
        straight to our storage provider, under a long random link. That link
        goes on the back of the pass, so anyone who has the pass, or the link,
        can open the file. Passclip doesn’t keep a list of files or who
        uploaded them. Like any host, the storage provider receives connection
        information, such as your IP address, when a file is uploaded or opened.
      </p>
      <p>
        After an upload you get a delete link, once. Passclip doesn’t keep it,
        so save it if you might want to delete the file later. Opening it and
        confirming deletes the file; a copy cached along the way can take a few
        minutes to disappear.
      </p>
    </main>
  );
}
