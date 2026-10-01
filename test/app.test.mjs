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

function start(store = {}) {
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
  const state = { failWrites: false, confirm: true };
  const context = vm.createContext({
    structuredClone,
    crypto: webcrypto,
    URL,
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
  });
  vm.runInContext(source, context);
  return {
    run: (text) => vm.runInContext(text, context),
    element,
    state,
    store,
  };
}

function create(app, title, workspace = "Agent Architect", list = "Current") {
  app.run(
    `switchWorkspace(${JSON.stringify(workspace)});filter=${JSON.stringify(list)};openEditor();`,
  );
  app.element("taskTitle").value = title;
  app.element("taskStatus").value = "In QA";
  app.element("taskIssueType").value = "Backend + ML + UI";
  app.element("taskForm").onsubmit({ preventDefault() {} });
}

test("new installs are empty; legacy data and edits survive reload unchanged", () => {
  assert.equal(start().run("tasks.length"), 0);
  const raw = JSON.stringify([fixture()]);
  const app = start({ [KEY]: raw });
  assert.equal(app.run("tasks[0].workspace"), "Agent Architect");
  assert.equal(app.run("tasks[0].uiEta"), "TBD");
  assert.equal(app.run("filter"), "Backlog");
  assert.equal(app.store[KEY], raw);
});

test("workspace and list isolation, search, issue creation, navigation and reload", () => {
  const app = start();
  create(app, "Architect task");
  create(app, "Studio current", "AI+ Studio");
  create(app, "Studio backlog", "AI+ Studio", "Backlog");
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
  app.element("taskForm").onsubmit({ preventDefault() {} });
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

test("invalid stored records cannot be replaced by accidental saves", () => {
  const app = start({ [KEY]: "{broken" });
  assert.equal(app.run("loadSucceeded"), false);
  assert.equal(app.run("save()"), false);
  assert.equal(app.store[KEY], "{broken");
  assert.equal(app.element("newTask").disabled, true);
});

test("failed writes retain the draft and prior saved records", () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  const before = app.store[KEY];
  app.state.failWrites = true;
  create(app, "Unsaved task");
  assert.equal(app.store[KEY], before);
  assert.equal(app.run("tasks.length"), 1);
  assert.equal(app.run("draft.title"), "Unsaved task");
  assert.equal(app.element("taskDialog").open, true);
});

test("stale tabs cannot overwrite newer saved edits", () => {
  const store = { [KEY]: JSON.stringify([fixture()]) };
  const first = start(store),
    stale = start(store);
  create(first, "Newer edit");
  const latest = store[KEY];
  create(stale, "Stale edit");
  assert.equal(store[KEY], latest);
  assert.equal(stale.run("draft.title"), "Stale edit");
});

test("backup import preserves all fields, snapshots prior data, and validates before replacing", () => {
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
  assert.equal(app.run(`importBackupText(${JSON.stringify(backup)})`), true);
  assert.deepEqual(JSON.parse(app.store[KEY]), [restored]);
  assert.equal(JSON.parse(app.store["taskline.backups.v1"]).length, 1);
  const before = app.store[KEY];
  assert.throws(() => app.run("importBackupText('{\"workingTasks\":[{}]}')"));
  assert.equal(app.store[KEY], before);
  app.state.confirm = false;
  assert.equal(app.run('importBackupText("[]")'), false);
  assert.equal(app.store[KEY], before);
});

test("backup history remains bounded to 20 snapshots", () => {
  const app = start({ [KEY]: JSON.stringify([fixture()]) });
  app.run("for(let i=0;i<25;i++){tasks[0].notes=String(i);save();}");
  assert.equal(JSON.parse(app.store["taskline.backups.v1"]).length, 20);
});

test("user text is escaped before being inserted into the table", () => {
  const app = start();
  create(app, "<img src=x onerror=alert(1)>");
  assert.ok(app.element("rows").innerHTML.includes("&lt;img"));
  assert.ok(!app.element("rows").innerHTML.includes("<img"));
});
