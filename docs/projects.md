# Projects (B2B 0.6.0)

The full architecture, API, permissions, PDFs, QR and runbook are in `staff_arasyahome/docs/b2b-projects.md`. This file
records the B2B client boundaries.

- Quick wholesale stays the Classic workstation (`/comenzi/noua`); it never creates or requires a project.
- `/proiecte`, `/proiecte/nou`, `/proiecte/{id}?camera={roomId}`. Permissions `b2b.projects.view|create|update|archive|convert`;
  the server decides, the UI only hides what the access gate does not grant.
- The workspace keeps editable text forms and persists changed nodes through `POST /b2b/projects/{id}/changes` after a
  1.5 s pause, on Ctrl/Cmd+S, on room switch and before structural actions. A failed transport batch is resent unchanged
  with the same idempotency key (2 s → 30 s backoff, and on `online`); conflicts and validation errors wait for the
  employee. Nothing is stored in the browser.
- The 2D sketch reads only `GET /b2b/projects/{id}/scene` (`arasya.scene/1`). It is a structural validation view, not a
  renderer. Real-time 3D belongs to a separate renderer phase.
- Conversion picks rooms; every not-yet-ordered treatment of those rooms becomes a line of one Classic draft
  (maximum 100). The order page links back to the project and labels each converted line with its location.
