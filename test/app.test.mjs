import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const source = readFileSync(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);
const KEY = "taskline.prototype.v1";
const fixture = (id = "sample-1") => ({
  id,
  number: 1,
  title: "Example task",
  status: "In QA",
  ui: "UI owner",
  backend: "Backend owner",
  ml: "ML owner",
  notes: "Ready for review",
  list: "Backlog",
  issues: [],
});

function start(store = {}, cloudClient = null) {
  const elements = {};
  const element = (id) =>
    (elements[id] ??= {
      value: "",
      innerHTML: "",
      textContent: "",
      open: false,
      isConnected: true,
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {},
      removeAttribute() {},
      setCustomValidity() {},
      reportValidity() {
        return true;
      },
      addEventListener() {},
      focus() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      querySelector() {
        return { focus() {} };
      },
      querySelectorAll() {
        return [];
      },
    });
  const state = {
    failWrites: false,
    confirm: true,
    clipboard: null,
    clipboardFails: false,
  };
  const context = vm.createContext({
    Blob,
    ClipboardItem: class {
      constructor(data) {
        this.data = data;
      }
    },
    navigator: {
      clipboard: {
        async write(items) {
          if (state.clipboardFails) throw Error("Clipboard denied");
          const data = items[0].data;
          state.clipboard = {
            html: await (await data["text/html"]).text(),
            text: await (await data["text/plain"]).text(),
          };
        },
      },
    },
    structuredClone,
    crypto: webcrypto,
    URL,
    URLSearchParams,
    location: {
      origin: "https://example.com",
      pathname: "/",
      hash: cloudClient?.testToken ? "#board=" + cloudClient.testToken : "",
    },
    document: {
      getElementById: element,
      querySelector: element,
      activeElement: element("active"),
    },
    window: { addEventListener() {} },
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        if (state.failWrites) throw Error("Storage quota exceeded");
        store[key] = String(value);
      },
    },
    confirm: () => state.confirm,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval() {},
    TASKLINE_CONFIG: cloudClient
      ? {
          supabaseUrl: "https://example.supabase.co",
          supabasePublishableKey: "public-test-key",
        }
      : {},
    supabase: { createClient: () => cloudClient },
  });
  vm.runInContext(
    readFileSync(new URL("../public/cloud.js", import.meta.url), "utf8"),
    context,
  );
  vm.runInContext(source, context);
  return {
    run: (text) => vm.runInContext(text, context),
    element,
    state,
    store,
  };
}

async function create(
  app,
  title,
  workspace = "Agent Architect",
  list = "Current",
) {
  app.run(
    `switchWorkspace(${JSON.stringify(workspace)});filter=${JSON.stringify(list)};openEditor();`,
  );
  app.element("taskTitle").value = title;
  app.element("taskStatus").value = "In QA";
  app.element("taskIssueType").value = "Backend + ML + UI";
  await app.element("taskForm").onsubmit({ preventDefault() {} });
}

test("new installs are empty; legacy data and edits survive reload unchanged", async () => {
  assert.equal(start().run("tasks.length"), 0);
  const raw = JSON.stringify([fixture()]);
  const app = start({ [KEY]: raw });
  assert.equal(app.run("tasks[0].workspace"), "Agent Architect");
  assert.equal(app.run("tasks[0].uiEta"), "TBD");
  assert.equal(app.run("filter"), "Backlog");
  assert.equal(app.store[KEY], raw);
});

test("workspace and list isolation, search, issue creation, navigation and reload", async () => {
  const app = start();
  await create(app, "Architect task");
  await create(app, "Studio current", "AI+ Studio");
  await create(app, "Studio backlog", "AI+ Studio", "Backlog");
  assert.equal(app.run("visibleTasks().length"), 1);
  assert.equal(app.run("visibleTasks()[0].title"), "Studio backlog");
  app.run('query="Architect"');
  assert.equal(app.run("visibleTasks().length"), 0);
  app.run('query="";openEditor(visibleTasks()[0].id)');
  assert.equal(app.element("previousTask").disabled, true);
  assert.equal(app.element("nextTask").disabled, true);
  app.element("issueTitle").value = "Investigate failure";
  app.run("addIssue()");
  app.element("taskStatus").value = "In QA";
  await app.element("taskForm").onsubmit({ preventDefault() {} });
  app.run("rememberView()");
  const reload = start(app.store);
  assert.equal(reload.run("activeWorkspace"), "AI+ Studio");
  assert.equal(reload.run("filter"), "Backlog");
  assert.equal(
    reload.run("visibleTasks()[0].issues[0].title"),
    "Investigate failure",
  );
  assert.equal(reload.run("tasks.length"), 3);
});

test("invalid stored records cannot be replaced by accidental saves", async () => {
  const app = start({ [KEY]: "{broken" });
  assert.equal(app.run("loadSucceeded"), false);
  assert.equal(await app.run("save()"), false);
  assert.equal(app.store[KEY], "{broken");
  assert.equal(app.element("newTask").disabled, true);
});

test("failed writes retain the draft and prior saved records", async () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  const before = app.store[KEY];
  app.state.failWrites = true;
  await create(app, "Unsaved task");
  assert.equal(app.store[KEY], before);
  assert.equal(app.run("tasks.length"), 1);
  assert.equal(app.run("draft.title"), "Unsaved task");
  assert.equal(app.element("taskDialog").open, true);
});

test("stale tabs cannot overwrite newer saved edits", async () => {
  const store = { [KEY]: JSON.stringify([fixture()]) };
  const first = start(store),
    stale = start(store);
  await create(first, "Newer edit");
  const latest = store[KEY];
  await create(stale, "Stale edit");
  assert.equal(store[KEY], latest);
  assert.equal(stale.run("draft.title"), "Stale edit");
});

test("backup import preserves all fields, snapshots prior data, and validates before replacing", async () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  const restored = {
    ...fixture("restored"),
    workspace: "AI+ Studio",
    uiEta: "Friday",
    backendEta: "Monday",
    mlEta: "TBD",
    issueType: "Backend + ML",
    jira: "https://example.com/T-1",
    designs: "https://example.com/design",
    issues: [{ id: "issue-1", title: "Check response", status: "Open" }],
  };
  const backup = JSON.stringify({
    format: "taskline-backup-v1",
    workingTasks: [restored],
  });
  assert.equal(
    await app.run(`importBackupText(${JSON.stringify(backup)})`),
    true,
  );
  assert.deepEqual(JSON.parse(app.store[KEY]), [restored]);
  assert.equal(JSON.parse(app.store["taskline.backups.v1"]).length, 1);
  const before = app.store[KEY];
  await assert.rejects(() =>
    app.run("importBackupText('{\"workingTasks\":[{}]}')"),
  );
  assert.equal(app.store[KEY], before);
  app.state.confirm = false;
  assert.equal(await app.run('importBackupText("[]")'), false);
  assert.equal(app.store[KEY], before);
});

test("backup history remains bounded to 20 snapshots", async () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  await app.run(
    "(async()=>{for(let i=0;i<25;i++){tasks[0].notes=String(i);await save();}})()",
  );
  assert.equal(JSON.parse(app.store["taskline.backups.v1"]).length, 20);
});

test("user text is escaped before being inserted into the table", async () => {
  const app = start();
  await create(app, "<img src=x onerror=alert(1)>");
  assert.ok(app.element("rows").innerHTML.includes("&lt;img"));
  assert.ok(!app.element("rows").innerHTML.includes("<img"));
});

function fakeCloudDatabase() {
  const rows = new Map();
  let online = true;
  return {
    offline() {
      online = false;
    },
    client(owner) {
      return {
        testToken: owner ? (owner === "owner" ? "a" : "b").repeat(64) : null,
        async rpc(name, args) {
          if (!online) throw Error("Offline");
          if (
            !owner ||
            args.link_token !== (owner === "owner" ? "a" : "b").repeat(64)
          )
            return {
              error: { code: "42501", message: "Invalid private link" },
            };
          const previous = rows.get(owner) || { tasks: [], revision: 0 };
          if (name === "load_taskline_link")
            return { data: structuredClone(previous) };
          if (previous.revision !== args.expected_revision)
            return { error: { code: "PT409" } };
          const revision = previous.revision + 1;
          rows.set(owner, { tasks: structuredClone(args.new_tasks), revision });
          return { data: revision };
        },
      };
    },
  };
}

test("cloud migration preserves the browser copy and syncs to a second session", async () => {
  const db = fakeCloudDatabase();
  const raw = JSON.stringify([fixture()]);
  const first = start({ [KEY]: raw }, db.client("owner"));
  await first.run("cloudReady");
  assert.equal(first.element("migrateTasks").hidden, false);
  await first.element("migrateTasks").onclick();
  assert.equal(first.store[KEY], raw);
  const second = start({}, db.client("owner"));
  await second.run("cloudReady");
  assert.equal(second.run("tasks[0].title"), "Example task");
  await create(second, "Created on second computer");
  await first.run("refreshCloud()");
  assert.equal(first.run("tasks[0].title"), "Created on second computer");
  const third = start({}, db.client("another-account"));
  await third.run("cloudReady");
  assert.equal(third.run("tasks.length"), 0);
});

test("incoming cloud changes do not replace an open draft; stale save preserves it", async () => {
  const db = fakeCloudDatabase();
  const first = start({}, db.client("owner"));
  await first.run("cloudReady");
  await create(first, "Initial task");
  const second = start({}, db.client("owner"));
  await second.run("cloudReady");
  first.run("openEditor(tasks[0].id)");
  first.element("taskTitle").value = "Unsaved draft";
  await create(second, "Concurrent task");
  await first.run("refreshCloud()");
  assert.equal(first.run("tasks.length"), 1);
  await first.element("taskForm").onsubmit({ preventDefault() {} });
  assert.equal(first.element("taskDialog").open, true);
  assert.equal(first.run("draft.title"), "Unsaved draft");
  assert.equal(first.run("tasks.length"), 1);
  first.run("closeEditor(true)");
  await first.run("refreshCloud()");
  assert.equal(first.run("tasks.length"), 2);
});

test("a private link is required and offline writes are not presented as synced", async () => {
  const db = fakeCloudDatabase();
  const signedOut = start({}, db.client(null));
  await signedOut.run("cloudReady");
  assert.equal(signedOut.element("newTask").disabled, true);
  assert.equal(signedOut.element("importBackup").disabled, true);
  const app = start({}, db.client("owner"));
  await app.run("cloudReady");
  db.offline();
  await create(app, "Offline draft");
  assert.equal(app.run("tasks.length"), 0);
  assert.equal(app.run("draft.title"), "Offline draft");
  assert.equal(app.element("syncStatus").textContent, "Not saved");
});

test("Teams format uses first names, nested bullets, actual statuses and every description point", () => {
  const app = start();
  const record = {
    ...fixture(),
    jiraKey: "CARE-122795",
    title: "Analysis <script>",
    ui: "Rahul Aggarwal",
    backend: "Vyom Modi + Gaurav Jain",
    ml: "Prashant Kumar",
    notes:
      "Agent Architect - Dev Standup\nETA: TBD\nBlocker: ML discussion needed\n• UI can start exploration",
  };
  const message = app.run(
    `buildStandupMessage(${JSON.stringify([record])}, "Agent Architect")`,
  );
  assert.match(message.text, /• CARE-122795 \| Analysis <script>/);
  assert.match(
    message.text,
    /    ◦ Assignees: UI — Rahul \| Backend — Vyom \+ Gaurav \| ML — Prashant/,
  );
  assert.match(message.text, /    ◦ Status: In QA/);
  assert.match(
    message.text,
    /ETA: TBD; ML discussion needed; UI can start exploration/,
  );
  assert.doesNotMatch(message.text, /Aggarwal|Kumar|Jain/);
  assert.match(
    message.html,
    /<li><strong>CARE-122795.*<ul><li><strong>Assignees:/,
  );
  assert.match(message.html, /&lt;script&gt;/);
  assert.doesNotMatch(message.html, /<script>/);
  assert.equal(
    app.run('standupFirstNames("Mostly not needed")'),
    "Mostly not needed",
  );
  assert.equal(app.run('standupFirstNames("—")'), "Unassigned");
  assert.equal(app.run('standupNotes("")'), "Not specified");
});

test("Teams generation fetches fresh data and respects workspace, list and search", async () => {
  const db = fakeCloudDatabase();
  const first = start({}, db.client("owner"));
  await first.run("cloudReady");
  await create(first, "Previous title");
  const second = start({}, db.client("owner"));
  await second.run("cloudReady");
  second.run("openEditor(tasks[0].id)");
  second.element("taskTitle").value = "Latest title";
  second.element("taskStatus").value = "In QA";
  await second.element("taskForm").onsubmit({ preventDefault() {} });
  await create(second, "Other workspace", "AI+ Studio");
  await create(second, "Backlog task", "Agent Architect", "Backlog");
  first.run(
    'activeWorkspace="Agent Architect"; filter="Current"; query="Latest"',
  );
  assert.equal(first.run("tasks[0].title"), "Previous title");
  await first.element("generateStandup").onclick();
  assert.match(first.state.clipboard.text, /Latest title/);
  assert.doesNotMatch(
    first.state.clipboard.text,
    /Other workspace|Backlog task|Previous title/,
  );
  assert.equal(first.element("standupDialog").open, true);
  assert.equal(
    first.element("standupCopyStatus").textContent,
    "Copied — paste into Teams.",
  );
  assert.equal(
    first.run("tasks[0].title"),
    "Previous title",
    "Generation does not mutate records",
  );
  db.offline();
  first.state.clipboard = null;
  await first.element("generateStandup").onclick();
  assert.equal(first.state.clipboard, null);
  assert.match(
    first.element("toast").textContent,
    /Update not generated: Offline/,
  );
});

test("Teams clipboard denial keeps a copyable preview; empty lists are not copied", async () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  app.state.clipboardFails = true;
  await app.element("generateStandup").onclick();
  assert.equal(app.element("standupDialog").open, true);
  assert.match(app.element("standupText").value, /Example task/);
  assert.match(app.element("standupCopyStatus").textContent, /Ready to copy/);
  app.run('filter="Current"');
  await app.element("generateStandup").onclick();
  assert.match(app.element("toast").textContent, /No tasks/);
  assert.equal(app.state.clipboard, null);
});
