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
        stored passes, or third-party trackers.
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

      <h2>Wallet downloads and native previews</h2>
      <p>
        When signing is configured, choosing Add to Apple Wallet sends that
        pass to the server to build and sign a Wallet file. The server does not
        store the pass or log its contents. Native app previews also send your
        import to the server for validation; the app explains this before you
        send it. Signing keys remain on the server. Attachment files are not
        uploaded or stored.
      </p>
    </main>
  );
}
