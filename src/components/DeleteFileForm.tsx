"use client";

import { useSyncExternalStore } from "react";
import { readDeleteFragment } from "@/lib/attachments/rules";

// The delete link's secret sits after the "#", which browsers keep to themselves, so only this
// page's script reads it. The form then sends it to the server once, when the person confirms.

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function DeleteFileForm() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => null);
  if (hash === null) return <h1>Delete a file</h1>;

  const link = readDeleteFragment(hash);
  if (!link) {
    return <>
      <h1>This delete link is incomplete.</h1>
      <p>Copy the whole link from where you saved it, including everything after the #, and open it again.</p>
    </>;
  }
  return <>
    <h1>Delete this file?</h1>
    <p>This deletes <strong className="file-name">{link.fileName}</strong> from Passclip’s storage. The link to it on your pass stops working, and you can’t undo this.</p>
    <form method="post" action="/api/attachments/delete" className="delete-file-form">
      <input type="hidden" name="token" value={link.token} />
      <input type="hidden" name="file" value={link.fileName} />
      <button className="button button-primary" type="submit">Delete this file</button>
    </form>
  </>;
}
