import type { Metadata } from "next";
import Link from "next/link";
import { DeleteFileForm } from "@/components/DeleteFileForm";

export const metadata: Metadata = {
  title: "Delete a file · Passclip",
  description: "Delete a file you attached to a pass.",
  robots: { index: false, follow: false },
};

export default async function DeleteFilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const deleted = (await searchParams).deleted === "1";
  return (
    <main id="main" className="page-shell delete-page">
      <Link className="text-link" href="/">← Back to Passclip</Link>
      {deleted ? (
        <>
          <h1>File deleted.</h1>
          <p>Its link on your pass no longer opens it. A copy cached along the way can take a few minutes to disappear.</p>
        </>
      ) : (
        <DeleteFileForm />
      )}
    </main>
  );
}
