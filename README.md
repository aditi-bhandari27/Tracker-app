# Taskline

A dark-mode task tracker for **Agent Architect** and **AI+ Studio**. Each workspace has its own **Current** and **Backlog** lists.

**Public app:** https://aditi-bhandari27.github.io/Tracker-app/

Live sync uses a **private sync link**, with no GitHub login or email verification. Open the complete link on each computer, or use **Copy private link** in the app. Anyone who has that link can view and edit the board. The plain public URL does not grant access to tasks.

## Live sync

See [Supabase setup](supabase/SETUP.md). The backend configuration in `public/config.js` contains only the public project URL and publishable key. The private link is never committed to GitHub, included in exports, or placed in page requests/referrers. The browser remembers it locally after a successful connection.

Cloud saves are acknowledged by the server. Visible tabs check for updates every 3 seconds and when focused or reconnected. Incoming changes wait while a task form is open. Revision conflicts preserve the draft instead of overwriting newer work. Offline changes are not marked as synced. The last 20 server revisions remain available for recovery.

## Run locally

Install Node.js 20 or newer, then run:

```sh
git clone https://github.com/aditi-bhandari27/Tracker-app.git
cd Tracker-app
npm start
```

Open **http://127.0.0.1:3000**. There are no packages to install. You can also run `node scripts/server.mjs` directly.

```sh
npm test      # Storage safety and task workflow checks
npm run build # Copy static application into dist/
```

Set `PORT` to change the port. The server binds to your computer only by default. Files in `public/` or `dist/` can be served by any static web host.

## Publish updates to GitHub Pages

GitHub Pages serves the root of the `gh-pages` branch. After committing your changes to `main`, publish the public directory:

```sh
git push origin main
git subtree push --prefix public origin gh-pages
```

Only static application files are published. Personal backup files must stay outside `public/`.

## Copy a Teams standup update

Click the clipboard icon beside **New task**. It fetches the latest saved records for the selected workspace, Current/Backlog list, and search filter, then copies a Teams-ready message and opens a preview. Tickets are top-level bullets; assignees, status, and description points are sub-bullets. Developer names use first names, including multiple assignees. Assigned ML developers are included. Description points stay verbatim (the original imported standup header and redundant blocker labels are removed). Blank descriptions say “Not specified.”

The clipboard includes HTML for formatted Teams paste and a plain-text fallback. If clipboard access is unavailable, use **Copy message** or select the text in the preview. A cloud fetch failure does not copy stale data. This action never posts to Teams or changes saved tasks.

## Features

- Independent workspace tabs, task counts, Current/Backlog lists, and search.
- Task title, status (including In QA), and all seven UI/Backend/ML issue-type combinations.
- Separate developer and ETA fields for UI, backend, and ML.
- JIRA and design links, status notes, blockers, and editable issue lists.
- Previous/next task navigation within the selected list and search results.
- Inline status updates, task deletion with confirmation, and unsaved-edit warnings.
- Browser persistence, remembered workspace/list, JSON export/import, and 20 previous saved snapshots.
- Responsive layout, keyboard-accessible controls, and dark styling.

New tasks belong to the workspace and list selected when you create them. Status does not change list membership.

## Your data and backups

**With cloud sync configured, tasks are saved in Supabase and accessed through your private link.** GitHub contains only application code; no personal task records, standup data, or recovery backups are committed. With cloud configuration empty, the app uses local browser storage and a fresh browser starts empty.

Use **Export backup** regularly and before clearing browser data or moving the app to another address. Use **Import backup** to restore your tasks. Import validates the file, shows a replacement confirmation, and saves a snapshot of the existing records before replacing them. It restores tasks across both workspaces. Never commit personal backup files to this public repository.

The original prototype's `taskline.prototype.v1` storage key and JSON backup format remain compatible. Local records are preserved for migration. In local mode, a different port, browser, or hosted URL is a different storage location; import your exported backup there. In cloud mode, open the same private sync link instead.

Exports include current working records, exact saved records, backup history, and any open unsaved draft. Import restores `workingTasks` (or legacy `rawTasks`); unsaved drafts are retained in the file for manual recovery, not applied automatically. History is included as `rawHistory`; to restore an older snapshot, parse that field and import the desired snapshot's `raw` array as a JSON file.

Invalid stored data is never silently reset. Failed writes keep the form open and leave the last successful tasks intact. A stale tab is prevented from overwriting changes from another tab; export any draft, then refresh. Browser clearing, private browsing, storage quotas, and device loss can still remove local data, so keep an exported copy.

## Project layout

```text
public/index.html   Accessible page and task form
public/styles.css   Dark responsive styling
public/app.js       Task workflows, persistence, and backup handling
scripts/server.mjs  Dependency-free local static server
scripts/build.mjs   Static distribution build
test/               Node test runner checks with synthetic task data
```

Local mode requires no external services. Cloud mode connects only to the configured Supabase project for protected database reads and writes. The vendored Supabase client is version 2.117.2; its MIT license is included in `public/vendor/`.
