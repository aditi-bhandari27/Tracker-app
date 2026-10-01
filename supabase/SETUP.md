# Live sync setup

The public GitHub Pages app can use Supabase Auth and Postgres for private, account-based sync. Sign in with the same email on each computer. Different accounts have separate task lists; team invitations are not implemented.

1. Create a Supabase project and run `schema.sql` in its SQL editor.
2. In Authentication → URL Configuration, set the Site URL and allowed redirect URL to `https://aditi-bhandari27.github.io/Tracker-app/`. For local development, also allow the exact local URL in use.
3. Keep the Email provider enabled. For email sign-in outside the project's authorized team addresses, configure a production SMTP provider according to Supabase's email requirements.
4. Put the project URL and **publishable** key in `public/config.js`. Never use the database password, secret key, or service-role key in the browser or repository.
5. Publish `main` and `gh-pages` using the README commands.
6. Sign in on the computer with your saved tasks. Select **Sync existing tasks** once to migrate the local records to the empty cloud account. The local copy is preserved. If tasks were saved on another address, use **Import backup** after signing in instead.
7. Open the public link on a second computer and sign in with the same email. Confirm that tasks load, and that an edit on either computer reaches the other.

Changes are received through Supabase Realtime, with a 10-second refresh fallback while the tab is visible. While a task form is open, incoming updates wait so they cannot replace an unsaved draft. Save uses an atomic revision check: a stale computer cannot overwrite a newer revision. Close the form to load the latest state before retrying a conflicting edit. Export backup includes the unsaved draft for recovery.

The server retains the previous 20 revisions in `taskline_history`. Tables use row-level security for reads. Writes go through a narrowly scoped database function that uses the authenticated account ID, validates the revision, and saves history in the same transaction. Anonymous reads and writes are denied.

The application requires a connection to save cloud changes. It does not silently save them locally and claim they are synced. Configuration left empty keeps the original local mode until a database is ready.

References: [Supabase passwordless sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp).
