# Taskline

A dark-mode task tracker for **Agent Architect** and **AI+ Studio**. Each workspace has its own **Current** and **Backlog** lists.

**Public app:** https://aditi-bhandari27.github.io/Tracker-app/

Open this link on any computer. Task data is still local to each browser; use Export/Import backup to transfer it between computers. The public link does not provide automatic synchronization.

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

**This is a local-first application, not a shared database.** Tasks stay in the current browser's local storage. GitHub contains only application code; no personal task records, standup data, or recovery backups are committed. A fresh browser starts empty.

Use **Export backup** regularly and before clearing browser data or moving the app to another address. Use **Import backup** to restore your tasks. Import validates the file, shows a replacement confirmation, and saves a snapshot of the existing records before replacing them. It restores tasks across both workspaces. Never commit personal backup files to this public repository.

The original prototype's `taskline.prototype.v1` storage key and JSON backup format remain compatible. Opening the app at the same protocol, hostname, and port preserves existing saved records. A different port, browser, or hosted URL is a different storage location; import your exported backup there.

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

No external fonts, analytics, APIs, or network requests are required by the app.
