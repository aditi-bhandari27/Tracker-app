# Private-link sync setup

The app opens one shared board through a 256-bit private link, without a sign-in flow. Anyone with the complete link can view and edit. GitHub Pages hosts application code only.

1. Run `schema.sql`, then `private-links.sql` in Supabase's SQL editor. Existing boards and history are preserved.
2. Create a cryptographically random 32-byte token, encoded as 64 lowercase hex characters, outside the repository. Compute SHA-256 of the UTF-8 token. Register **only its hash** in `taskline_links`, mapping it to an existing board's `owner_id`. Keep the raw token out of SQL snippets, GitHub, logs, and backups.
3. Keep the project URL and publishable key in `public/config.js`. Never publish a service-role key.
4. Open `https://<host>/<path>/#board=<token>` on each computer. The app remembers the link locally after a successful read. **Copy private link** copies the full URL.
5. To revoke a link, set that row's `revoked_at` to `now()`. To rotate access, register a new random token hash for the same board and revoke the old hash. Keep at least one usable link until the replacement is verified.

No Supabase Auth session, GitHub provider, SMTP, or email verification is used by this client. Existing auth-owned board rows are retained so the migration does not recreate or overwrite tasks. Do not delete the legacy owner user: the original schema's foreign keys cascade its board/history.

## Access and save guarantees

`taskline_links`, `taskline_boards`, and `taskline_history` are protected by RLS. Anonymous callers cannot read tables directly. Narrow `SECURITY DEFINER` RPCs hash and validate the supplied link token, map it to exactly one owner, and deny missing, invalid, or revoked links. No owner ID is accepted from the client. The functions have an empty search path.

Writes use the same owner lock and atomic revision check as the original authenticated RPC. Previous tasks are snapshotted in the same transaction; the latest 20 snapshots are retained. Stale saves fail rather than overwriting newer data. The browser polls every 3 seconds while visible and refreshes on focus/online. Open forms pause incoming changes to preserve drafts.

The token appears only in the URL fragment (not sent as a page URL request) and in HTTPS RPC bodies to this Supabase project. Page referrers are disabled. Browser history and anyone to whom the link is forwarded can retain it; treat it like a password. **Export backup** excludes the link.

With cloud configuration empty, the original browser-only mode remains available. The `taskline.prototype.v1` local records and JSON backup format remain compatible.
