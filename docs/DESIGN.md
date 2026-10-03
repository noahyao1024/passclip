# Milestone 1 design

The page feels like a quiet ticket counter: Paper (#E9EDF2) behind white surfaces, Ink (#1A2230) text, Signal (#3346D3) actions, and a small Stub (#F2B33D) accent when a file lands. Dark mode uses deep blue surfaces and lighter accessible text and controls. Schibsted Grotesk gives headings character; body copy and Wallet previews use the system font.

The main element is a ticket-shaped drop zone with a perforated edge and a steel paper clip. The desktop page puts the import area beside the three-step AI helper; narrow screens stack them. Passes appear below in a responsive grid, with one brief slide when results arrive and no animation when reduced motion is requested. There are no decorative gradients or repeated generic cards.

Paste is the primary path. Choose file and drag-and-drop are equivalent; a visible label, keyboard focus, persistent input, and error-location buttons support editing. An optional email box is clearly local to the browser. Global warnings, per-pass warnings, time-zone controls, and unavailable signing/calendar actions explain the current state without pretending later milestones exist.

Previews follow the five Wallet field layouts and type colors, use uppercase only for field labels, and flip with an explicit button. Back links remain real links. Barcodes use the exact imported message, load locally, and fail visibly if rendering cannot encode it. At 360 px, all text, controls, previews, and error snippets stay inside the viewport. Light/dark themes, keyboard navigation, production CSP, and fixtures are checked in Chromium; real iPhone Safari remains a device check.
