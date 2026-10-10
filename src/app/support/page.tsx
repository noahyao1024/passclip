import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support · Passclip",
  description: "Help with Passclip and how to reach us.",
};

// The contact address is a setting (SUPPORT_EMAIL), so it isn't written into the code.
const supportEmail = process.env.SUPPORT_EMAIL;

export default function SupportPage() {
  return (
    <main id="main" className="page-shell privacy-page">
      <Link className="text-link" href="/">← Back to your tickets</Link>
      <h1>Help with Passclip</h1>

      <h2>Contact</h2>
      {supportEmail ? (
        <p>
          Email <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>. Say which ticket seller
          your ticket is from and what went wrong; please don’t send the ticket itself unless we ask.
        </p>
      ) : (
        <p>Contact details will be here soon.</p>
      )}

      <h2>Making a pass</h2>
      <p>
        In the iPhone app, paste your ticket email, a link to your e-ticket, or choose a PDF or screenshot, then tap
        “Make pass”. On iPhones with Apple Intelligence the app reads it on the iPhone. On other iPhones, copy
        Passclip’s prompt into any AI chat with your ticket email and paste the reply back. On this website, paste the
        AI’s reply.
      </p>

      <h2>The barcode is missing or wrong</h2>
      <p>
        Passclip only uses a barcode read from your own ticket. Choose a screenshot of the code from your ticket under
        “Add code from a screenshot”, check that it matches, and add the pass again. Delete the old pass from Wallet
        first.
      </p>

      <h2>A detail is wrong</h2>
      <p>
        Check every detail before adding the pass: the app shows what it couldn’t confirm in your document. Tap “Edit
        reply”, correct the text, and preview again.
      </p>

      <h2>Privacy</h2>
      <p>
        Your emails and documents are read on your iPhone. Only the pass details go to the Passclip server to sign the
        Wallet pass, and nothing is stored. Read the <Link className="text-link" href="/privacy">privacy page</Link>.
      </p>
    </main>
  );
}
