"use strict";
const $ = (id) => document.getElementById(id),
  KEY = "taskline.prototype.v1",
  STATUSES = ["To do", "In progress", "In review", "In QA", "Blocked", "Done"],
  ISSUE_STATUSES = ["Open", "In progress", "Resolved"],
  ISSUE_TYPES = [
    "UI",
    "Backend",
    "ML",
    "Backend + UI",
    "Backend + ML",
    "UI + ML",
    "Backend + ML + UI",
  ];
const VIEW_KEY = "taskline.view.v1",
  BACKUP_KEY = "taskline.backups.v1";
const WORKSPACES = ["Agent Architect", "AI+ Studio"];
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);
const seed = [];
const cloudConfig = globalThis.TASKLINE_CONFIG || {};
const cloudEnabled = Boolean(
  cloudConfig.supabaseUrl && cloudConfig.supabasePublishableKey,
);
let cloud = null,
  saving = false,
  loadingCloud = false,
  cloudLoaded = false;
let migrationTasks = [],
  migrationAvailable = false;
function canEdit() {
  return loadSucceeded && !saving && (!cloudEnabled || cloudLoaded);
}
function syncMessage(title, detail) {
  $("syncStatus").textContent = title;
  $("syncDetail").textContent = detail;
}

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const statusClass = (s) => s.toLowerCase().replaceAll(" ", "-");
function withTaskDefaults(task) {
  return {
    ...task,
    workspace: WORKSPACES.includes(task.workspace)
      ? task.workspace
      : "Agent Architect",
    issueType: ISSUE_TYPES.includes(task.issueType) ? task.issueType : "",
    uiEta: typeof task.uiEta === "string" ? task.uiEta : "TBD",
    backendEta: typeof task.backendEta === "string" ? task.backendEta : "TBD",
    mlEta: typeof task.mlEta === "string" ? task.mlEta : "TBD",
  };
}
let lastSavedRaw = null;
let tasks = structuredClone(seed).map(withTaskDefaults),
  loadSucceeded = true,
  hadSavedData = false,
  activeWorkspace = "Agent Architect",
  filter = "Current",
  query = "",
  draft = null,
  initialDraft = "",
  lastFocus = null,
  toastTimer;
try {
  const raw = localStorage.getItem(KEY);
  lastSavedRaw = raw;
  if (raw !== null) {
    hadSavedData = true;
    const saved = JSON.parse(raw);
    if (
      !Array.isArray(saved) ||
      !saved.every(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.title === "string" &&
          STATUSES.includes(t.status) &&
          ["ui", "backend", "ml", "notes"].every(
            (k) => typeof t[k] === "string",
          ) &&
          Number.isInteger(t.number) &&
          Array.isArray(t.issues) &&
          t.issues.every(
            (i) =>
              i &&
              typeof i.id === "string" &&
              typeof i.title === "string" &&
              ISSUE_STATUSES.includes(i.status),
          ),
      )
    )
      throw Error("Invalid data");
    tasks = saved
      .map((t) => ({
        ...t,
        list: ["Current", "Backlog"].includes(t.list)
          ? t.list
          : t.status === "To do"
            ? "Backlog"
            : "Current",
        jira: typeof t.jira === "string" ? t.jira : "",
        designs: typeof t.designs === "string" ? t.designs : "",
      }))
      .map(withTaskDefaults);
  }
} catch (e) {
  loadSucceeded = false;
  tasks = [];
  $("storageError").textContent =
    "Saved data could not be loaded. Saving is disabled to protect it. Export a backup before attempting recovery.";
  $("storageError").classList.add("visible");
}
async function save() {
  if (!canEdit()) return false;
  if (cloudEnabled) {
    saving = true;
    $("taskForm").inert = true;
    render();
    syncMessage("Saving…", "Waiting for the shared database.");
    try {
      await cloud.save(structuredClone(tasks));
      $("storageError").classList.remove("visible");
      $("saveNote").textContent =
        "Saved to cloud · Available on your other computers";
      syncMessage("Synced", cloud.user.email);
      return true;
    } catch (error) {
      $("storageError").textContent = error.message;
      $("storageError").classList.add("visible");
      syncMessage(
        "Not saved",
        "Your last saved cloud data is safe. Keep this page open to retry or export your draft.",
      );
      return false;
    } finally {
      saving = false;
      $("taskForm").inert = false;
      render();
    }
  }
  try {
    const previous = localStorage.getItem(KEY),
      next = JSON.stringify(tasks);
    if (previous !== lastSavedRaw)
      throw Error(
        "Another tab changed these tasks. Export your work and reload before saving.",
      );
    if (previous !== null && previous !== next) {
      let history = [];
      const stored = localStorage.getItem(BACKUP_KEY);
      if (stored !== null) {
        history = JSON.parse(stored);
        if (!Array.isArray(history)) throw Error("Invalid backup history");
      }
      if (history[0]?.raw !== previous)
        history.unshift({ savedAt: new Date().toISOString(), raw: previous });
      localStorage.setItem(BACKUP_KEY, JSON.stringify(history.slice(0, 20)));
    }
    localStorage.setItem(KEY, next);
    lastSavedRaw = next;
    $("storageError").classList.remove("visible");
    $("saveNote").textContent = "Saved just now · In this browser only";
    return true;
  } catch (e) {
    $("storageError").textContent =
      "Changes could not be saved. " +
      e.message +
      " Keep this page open and export a backup of your work.";
    $("storageError").classList.add("visible");
    return false;
  }
}
function rememberView() {
  try {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ workspace: activeWorkspace, list: filter }),
    );
  } catch (e) {}
}
function restoreView() {
  try {
    const view = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
    if (
      view &&
      WORKSPACES.includes(view.workspace) &&
      ["Current", "Backlog"].includes(view.list)
    ) {
      activeWorkspace = view.workspace;
      filter = view.list;
      return;
    }
  } catch (e) {}
  filter = tasks.some(
    (t) => t.workspace === activeWorkspace && t.list === "Backlog",
  )
    ? "Backlog"
    : "Current";
}
function exportBackup() {
  try {
    const rawTasks = localStorage.getItem(KEY),
      rawHistory = localStorage.getItem(BACKUP_KEY);
    const backup = {
      storageMode: cloudEnabled ? "cloud" : "local",
      cloudRevision: cloud?.revision ?? null,
      format: "taskline-backup-v1",
      exportedAt: new Date().toISOString(),
      rawTasks,
      rawHistory,
      workingTasks: tasks,
    };
    if (draft) {
      readDraft();
      backup.unsavedDraft = draft;
      backup.pendingIssue = $("issueTitle").value;
    }
    const backupText = JSON.stringify(backup, null, 2);
    $("backupSnapshot").textContent = backupText;
    const url = URL.createObjectURL(
      new Blob([backupText], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "taskline-backup-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    notify("Backup export failed. Keep this page open.");
  }
}
$("exportBackup").onclick = exportBackup;
restoreView();
function taskCode(t) {
  return t.jiraKey || "TSK-" + String(t.number).padStart(3, "0");
}
function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function options(list, value) {
  return list
    .map(
      (s) =>
        `<option value="${esc(s)}" ${s === value ? "selected" : ""}>${esc(s)}</option>`,
    )
    .join("");
}
function person(name, type) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return name
    ? `<div class="owner ${type}"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span title="${esc(name)}">${esc(name)}</span></div>`
    : '<span class="unassigned">Unassigned</span>';
}
function workspaceTasks() {
  return tasks.filter((t) => t.workspace === activeWorkspace);
}
function visibleTasks() {
  return workspaceTasks().filter(
    (t) =>
      t.list === filter &&
      [
        t.title,
        t.issueType,
        t.ui,
        t.backend,
        t.ml,
        t.notes,
        ...t.issues.map((i) => i.title),
        taskCode(t),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
}
function render() {
  $("productTabs").innerHTML = WORKSPACES.map(
    (name, index) =>
      `<button type="button" class="product-tab" id="product-${index === 0 ? "agent" : "studio"}" role="tab" aria-selected="${name === activeWorkspace}" aria-controls="tasksPanel" tabindex="${name === activeWorkspace ? 0 : -1}" data-workspace="${esc(name)}">${esc(name)}<span class="count">${tasks.filter((t) => t.workspace === name).length}</span></button>`,
  ).join("");
  $("tasksPanel").setAttribute(
    "aria-labelledby",
    activeWorkspace === "Agent Architect" ? "product-agent" : "product-studio",
  );
  $("newTask").setAttribute("aria-label", `New task in ${activeWorkspace}`);
  $("newTask").disabled = !canEdit();
  $("importBackup").disabled = cloudEnabled ? !canEdit() : saving;
  $("migrateTasks").disabled = saving || !cloudLoaded;
  $("signOut").disabled = saving;
  $("refreshCloud").disabled = saving;

  $("tabs").innerHTML = ["Current", "Backlog"]
    .map(
      (s) =>
        `<button class="tab ${filter === s ? "active" : ""}" aria-pressed="${filter === s}" data-filter="${s}">${s}<span class="count">${workspaceTasks().filter((t) => t.list === s).length}</span></button>`,
    )
    .join("");
  const shown = visibleTasks();
  $("rows").innerHTML = shown
    .map((t) => {
      const open = t.issues.filter((i) => i.status !== "Resolved").length;
      return `<tr><td><div class="task-cell"><span class="task-mark ${statusClass(t.status)}" aria-hidden="true"></span><div class="task-copy"><div class="taskmeta">${esc(taskCode(t))}</div><button class="tasktitle" data-open="${esc(t.id)}">${esc(t.title)}</button><div class="tasknote" title="${esc(t.notes)}">${esc(t.notes || "No update yet")}</div></div></div></td><td><select ${canEdit() ? "" : "disabled"} class="status ${statusClass(t.status)}" data-status="${esc(t.id)}" aria-label="Status for ${esc(t.title)}">${options(STATUSES, t.status)}</select></td><td>${t.issueType ? `<span class="issue-type">${esc(t.issueType)}</span>` : '<span class="unassigned">Not set</span>'}</td><td>${person(t.ui, "ui")}</td><td>${person(t.backend, "be")}</td><td>${person(t.ml, "ml")}</td><td><div class="issues ${open ? "alert" : ""}"><span aria-hidden="true">${open ? "⊙" : "✓"}</span>${t.issues.length ? (open ? open + " open" : "All resolved") : "No issues"}</div>${t.issues.length ? `<div class="issue-track" aria-label="${t.issues.length - open} of ${t.issues.length} issues resolved">${t.issues.map((i) => `<span class="${i.status === "Resolved" ? "resolved" : ""}"></span>`).join("")}</div>` : ""}</td></tr>`;
    })
    .join("");
  $("results").textContent =
    `Showing ${shown.length} of ${workspaceTasks().filter((t) => t.list === filter).length} ${filter.toLowerCase()} tasks`;
  $("empty").hidden = shown.length > 0;
  $("empty").innerHTML = query
    ? '<strong>No matching tasks</strong><p>Try a different search in this list.</p><button class="btn" id="clearFilters">Clear search</button>'
    : `<strong>No ${filter.toLowerCase()} tasks in ${esc(activeWorkspace)}</strong><p>Create a task in this workspace to get started.</p><button class="btn primary" id="firstTask">Create a task</button>`;
}
function readDraft() {
  if (!draft) return;
  draft.title = $("taskTitle").value;
  draft.status = $("taskStatus").value;
  draft.issueType = $("taskIssueType").value;
  draft.ui = $("uiDev").value;
  draft.backend = $("beDev").value;
  draft.ml = $("mlDev").value;
  draft.uiEta = $("uiEta").value;
  draft.backendEta = $("backendEta").value;
  draft.mlEta = $("mlEta").value;
  draft.notes = $("taskNotes").value;
  draft.jira = $("jiraLink").value.trim();
  draft.designs = $("designLink").value.trim();
}
function openEditor(id) {
  if (!canEdit()) return;
  if (!$("taskDialog").open) lastFocus = document.activeElement;
  const existing = tasks.find((t) => t.id === id);
  draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        id: uid(),
        number: Math.max(0, ...tasks.map((t) => t.number)) + 1,
        title: "",
        status: "To do",
        issueType: "",
        workspace: activeWorkspace,
        list: filter,
        ui: "",
        backend: "",
        ml: "",
        uiEta: "",
        backendEta: "",
        mlEta: "",
        notes: "",
        jira: "",
        designs: "",
        issues: [],
      };
  initialDraft = JSON.stringify(draft);
  $("taskCode").textContent = existing ? taskCode(draft) : "NEW TASK";
  $("editorTitle").textContent = existing ? "Task details" : "Create a task";
  $("editorWorkspace").textContent = draft.workspace;
  $("taskTitle").value = draft.title;
  $("taskStatus").innerHTML = options(STATUSES, draft.status);
  $("taskIssueType").innerHTML =
    '<option value="">Select issue type</option>' +
    options(ISSUE_TYPES, draft.issueType);
  $("taskIssueType").value = draft.issueType;
  $("uiDev").value = draft.ui;
  $("beDev").value = draft.backend;
  $("mlDev").value = draft.ml;
  $("uiEta").value = draft.uiEta;
  $("backendEta").value = draft.backendEta;
  $("mlEta").value = draft.mlEta;
  $("taskNotes").value = draft.notes;
  $("jiraLink").value = draft.jira;
  $("designLink").value = draft.designs;
  updateTaskLinks();
  $("issueTitle").value = "";
  $("deleteTask").style.visibility = existing ? "visible" : "hidden";
  renderIssues();
  updateTaskNavigation();
  $("taskTitle").setCustomValidity("");
  document.querySelector(".editor-body").scrollTop = 0;
  if (!$("taskDialog").open) $("taskDialog").showModal();
  $("taskTitle").focus();
}
function updateTaskNavigation() {
  const list = visibleTasks();
  const index = list.findIndex((t) => t.id === draft.id);
  $("taskNavigation").hidden = index < 0;
  $("taskPosition").textContent =
    index < 0 ? "" : `${index + 1} of ${list.length}`;
  $("previousTask").disabled = index <= 0;
  $("nextTask").disabled = index < 0 || index >= list.length - 1;
}
function switchTask(direction) {
  if (saving) return;
  if (!draft) return;
  const list = visibleTasks();
  const index = list.findIndex((t) => t.id === draft.id);
  const target = index < 0 ? null : list[index + direction];
  if (!target) return;
  readDraft();
  if (
    (JSON.stringify(draft) !== initialDraft || $("issueTitle").value.trim()) &&
    !confirm(
      "Discard unsaved changes and switch tasks? Select Cancel to keep editing, or save your changes first.",
    )
  )
    return;
  openEditor(target.id);
}
$("previousTask").onclick = () => switchTask(-1);
$("nextTask").onclick = () => switchTask(1);
function updateTaskLinks() {
  for (const [inputId, anchorId] of [
    ["jiraLink", "openJira"],
    ["designLink", "openDesign"],
  ]) {
    const anchor = $(anchorId);
    try {
      const url = new URL($(inputId).value.trim());
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("Unsupported URL");
      anchor.href = url.href;
      anchor.hidden = false;
    } catch (e) {
      anchor.hidden = true;
      anchor.removeAttribute("href");
    }
  }
}
$("jiraLink").addEventListener("input", updateTaskLinks);
$("designLink").addEventListener("input", updateTaskLinks);
function renderIssues() {
  $("issueCount").textContent = `(${draft.issues.length})`;
  $("resolvedCount").textContent =
    `${draft.issues.filter((i) => i.status === "Resolved").length} resolved`;
  $("issueList").innerHTML = draft.issues.length
    ? draft.issues
        .map(
          (i) =>
            `<div class="issue-row ${i.status === "Resolved" ? "resolved" : ""}"><input type="text" data-issue-title="${esc(i.id)}" aria-label="Issue description" required maxlength="300" value="${esc(i.title)}"><select data-issue-status="${esc(i.id)}" aria-label="Status for issue ${esc(i.title)}">${options(ISSUE_STATUSES, i.status)}</select><button class="iconbtn" type="button" data-remove-issue="${esc(i.id)}" aria-label="Remove issue: ${esc(i.title)}">×</button></div>`,
        )
        .join("")
    : '<div class="noissues">No issues yet. Keep track of anything that comes up.</div>';
}
function closeEditor(force = false) {
  if (saving) return;
  readDraft();
  if (
    !force &&
    (JSON.stringify(draft) !== initialDraft || $("issueTitle").value.trim()) &&
    !confirm("Discard your unsaved changes?")
  )
    return;
  $("taskDialog").close();
  draft = null;
  lastFocus?.isConnected ? lastFocus.focus() : $("newTask").focus();
}
function addIssue() {
  const title = $("issueTitle").value.trim();
  if (!title) {
    $("issueTitle").focus();
    return;
  }
  draft.issues.push({ id: uid(), title, status: "Open" });
  $("issueTitle").value = "";
  renderIssues();
  $("issueTitle").focus();
}
function switchWorkspace(name) {
  if (!WORKSPACES.includes(name) || $("taskDialog").open) return;
  activeWorkspace = name;
  query = "";
  $("search").value = "";
  rememberView();
  render();
  $("productTabs").querySelector('[aria-selected="true"]').focus();
}
$("productTabs").onclick = (e) => {
  const button = e.target.closest("[data-workspace]");
  if (button) switchWorkspace(button.dataset.workspace);
};
$("productTabs").onkeydown = (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const index = WORKSPACES.indexOf(activeWorkspace);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? WORKSPACES.length - 1
        : (index + (e.key === "ArrowRight" ? 1 : -1) + WORKSPACES.length) %
          WORKSPACES.length;
  switchWorkspace(WORKSPACES[next]);
};
$("newTask").onclick = () => openEditor();
$("search").oninput = (e) => {
  query = e.target.value;
  render();
};
$("tabs").onclick = (e) => {
  const b = e.target.closest("[data-filter]");
  if (b) {
    filter = b.dataset.filter;
    rememberView();
    render();
    $("tabs").querySelector(`[data-filter="${filter}"]`).focus();
  }
};
$("rows").onclick = (e) => {
  const b = e.target.closest("[data-open]");
  if (b) openEditor(b.dataset.open);
};
$("rows").onchange = async (e) => {
  if (!canEdit()) return;
  if (e.target.dataset.status) {
    const id = e.target.dataset.status;
    const task = tasks.find((t) => t.id === id);
    const previousStatus = task.status;
    task.status = e.target.value;
    const persisted = await save();
    if (!persisted) task.status = previousStatus;
    render();
    notify(
      persisted
        ? "Task status updated"
        : "Status could not be saved; the previous status was kept",
    );
    const next = Array.from($("rows").querySelectorAll("[data-status]")).find(
      (s) => s.dataset.status === id,
    );
    (next || $("newTask")).focus();
  }
};
$("empty").onclick = (e) => {
  if (e.target.id === "clearFilters") {
    query = "";
    $("search").value = "";
    render();
    $("search").focus();
  }
  if (e.target.id === "firstTask") openEditor();
};
$("closeEditor").onclick = () => closeEditor();
$("cancelEditor").onclick = () => closeEditor();
$("taskDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditor();
});
$("addIssue").onclick = addIssue;
$("issueTitle").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addIssue();
  }
};
$("issueList").oninput = (e) => {
  const id = e.target.dataset.issueTitle;
  if (id) {
    draft.issues.find((i) => i.id === id).title = e.target.value;
    e.target.setCustomValidity("");
  }
};
$("issueList").onchange = (e) => {
  const id = e.target.dataset.issueStatus;
  if (id) {
    draft.issues.find((i) => i.id === id).status = e.target.value;
    renderIssues();
    Array.from($("issueList").querySelectorAll("[data-issue-status]"))
      .find((s) => s.dataset.issueStatus === id)
      ?.focus();
  }
};
$("issueList").onclick = (e) => {
  const b = e.target.closest("[data-remove-issue]");
  if (b) {
    draft.issues = draft.issues.filter((i) => i.id !== b.dataset.removeIssue);
    renderIssues();
    $("issueTitle").focus();
  }
};
$("taskTitle").oninput = () => $("taskTitle").setCustomValidity("");
$("taskForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!canEdit()) return;
  readDraft();
  draft.title = draft.title.trim();
  if (!draft.title) {
    $("taskTitle").setCustomValidity("Enter a task title.");
    $("taskTitle").reportValidity();
    return;
  }
  const blank = draft.issues.find((i) => !i.title.trim());
  if (blank) {
    const el = Array.from(
      $("issueList").querySelectorAll("[data-issue-title]"),
    ).find((i) => i.dataset.issueTitle === blank.id);
    el.setCustomValidity("Describe the issue or remove it.");
    el.reportValidity();
    return;
  }
  if ($("issueTitle").value.trim()) addIssue();
  for (const key of [
    "ui",
    "backend",
    "ml",
    "notes",
    "uiEta",
    "backendEta",
    "mlEta",
  ])
    draft[key] = draft[key].trim();
  draft.issues.forEach((i) => (i.title = i.title.trim()));
  const previousTasks = tasks;
  tasks = tasks.slice();
  const index = tasks.findIndex((t) => t.id === draft.id);
  if (index >= 0) tasks[index] = structuredClone(draft);
  else tasks.unshift(structuredClone(draft));
  const persisted = await save();
  if (!persisted) {
    tasks = previousTasks;
    notify("Changes are not saved. Keep this form open or export a backup.");
    return;
  }
  closeEditor(true);
  render();
  notify(index >= 0 ? "Task changes saved" : "New task created");
};
$("deleteTask").onclick = async () => {
  if (!canEdit()) return;
  if (confirm("Delete this task and all its issues? This cannot be undone.")) {
    const previousTasks = tasks;
    tasks = tasks.filter((t) => t.id !== draft.id);
    const persisted = await save();
    if (!persisted) {
      tasks = previousTasks;
      notify("Task could not be deleted.");
      return;
    }
    closeEditor(true);
    render();
    notify(persisted ? "Task deleted" : "Task deleted for this session only");
  }
};
window.addEventListener("beforeunload", (e) => {
  if (saving) {
    e.preventDefault();
    e.returnValue = "";
  }
  if (draft) {
    readDraft();
    if (
      JSON.stringify(draft) !== initialDraft ||
      $("issueTitle").value.trim()
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
});
render();

// Reject malformed files before touching browser storage. Legacy backups remain compatible.
function parseBackup(text) {
  const backup = JSON.parse(text);
  const records = Array.isArray(backup)
    ? backup
    : (backup.workingTasks ??
      (typeof backup.rawTasks === "string"
        ? JSON.parse(backup.rawTasks)
        : null));
  if (!Array.isArray(records)) throw Error("Choose a Taskline JSON backup.");
  const ids = new Set();
  for (const task of records) {
    if (
      !task ||
      typeof task.id !== "string" ||
      !task.id ||
      ids.has(task.id) ||
      typeof task.title !== "string" ||
      !task.title.trim() ||
      !Number.isInteger(task.number) ||
      !STATUSES.includes(task.status) ||
      !["ui", "backend", "ml", "notes"].every(
        (key) => typeof task[key] === "string",
      ) ||
      !Array.isArray(task.issues)
    )
      throw Error("The backup contains invalid or duplicate tasks.");
    ids.add(task.id);
    const issueIds = new Set();
    for (const issue of task.issues) {
      if (
        !issue ||
        typeof issue.id !== "string" ||
        !issue.id ||
        issueIds.has(issue.id) ||
        typeof issue.title !== "string" ||
        !issue.title.trim() ||
        !ISSUE_STATUSES.includes(issue.status)
      )
        throw Error("The backup contains invalid issues.");
      issueIds.add(issue.id);
    }
  }
  return records.map((task) =>
    withTaskDefaults({
      ...task,
      list: ["Current", "Backlog"].includes(task.list)
        ? task.list
        : task.status === "To do"
          ? "Backlog"
          : "Current",
      jira: typeof task.jira === "string" ? task.jira : "",
      designs: typeof task.designs === "string" ? task.designs : "",
    }),
  );
}

async function importBackupText(text) {
  if (cloudEnabled && !canEdit())
    throw Error("Sign in and load cloud tasks before importing.");
  const imported = parseBackup(text);
  if (
    !confirm(
      `Restore ${imported.length} tasks from this backup? This replaces the current tasks in both workspaces. A snapshot of the current saved data will be kept.`,
    )
  )
    return false;
  const previousTasks = tasks,
    previousLoadSucceeded = loadSucceeded;
  tasks = imported;
  loadSucceeded = true;
  if (!(await save())) {
    tasks = previousTasks;
    loadSucceeded = previousLoadSucceeded;
    return false;
  }
  const first = tasks[0];
  activeWorkspace = first?.workspace || "Agent Architect";
  filter = first?.list || "Current";
  query = "";
  $("search").value = "";
  rememberView();
  render();
  notify(`Restored ${tasks.length} tasks from backup`);
  return true;
}

$("importBackup").onclick = () => $("backupFile").click();
$("backupFile").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw Error("Backup exceeds the 10 MB limit.");
    await importBackupText(await file.text());
  } catch (error) {
    notify("Import failed: " + error.message);
  } finally {
    event.target.value = "";
  }
};

// A stale tab must not silently overwrite edits saved by another tab.
window.addEventListener("storage", (event) => {
  if (cloudEnabled) return;
  if (event.key === KEY || event.key === null) {
    $("storageError").textContent =
      "Tasks changed in another tab. Export any unsaved work, then refresh to load the latest tasks.";
    $("storageError").classList.add("visible");
  }
});

async function refreshCloud() {
  if (!cloud?.user || saving || draft || loadingCloud) return;
  loadingCloud = true;
  const account = cloud.user.id;
  try {
    const board = await cloud.load();
    if (
      cloud.user?.id !== account ||
      saving ||
      draft ||
      board.revision < cloud.revision
    )
      return;
    const changed = !cloudLoaded || board.revision !== cloud.revision;
    if (changed) {
      tasks = parseBackup(JSON.stringify(board.tasks));
      cloud.revision = board.revision;
      restoreView();
    }
    cloudLoaded = true;
    loadSucceeded = true;
    $("migrateTasks").hidden = !(board.revision === 0 && migrationAvailable);
    $("saveNote").textContent = "Cloud sync · Same account, every computer";
    $("storageError").classList.remove("visible");
    syncMessage(
      "Synced",
      cloud.user.email +
        " · Changes appear automatically on your other computers.",
    );
    render();
  } catch (error) {
    syncMessage(
      "Could not connect",
      error.message + " Your existing data has not been changed.",
    );
  } finally {
    loadingCloud = false;
  }
}

async function updateCloudAccount() {
  try {
    const previousAccount = cloud.user?.id;
    const user = await cloud.session();
    if (user?.id !== previousAccount || !user) {
      // Session changes must never expose the previous account's records.
      tasks = [];
      cloudLoaded = false;
      loadSucceeded = false;
      cloud.revision = 0;
      if (draft) {
        $("taskDialog").close();
        draft = null;
      }
    }
    $("signInForm").hidden = Boolean(user);
    $("signOut").hidden = !user;
    $("refreshCloud").hidden = !user;
    $("migrateTasks").hidden = true;
    $("accountLabel").textContent = user
      ? "Cloud workspace"
      : "Sign in to sync";
    if (!user) {
      syncMessage(
        "Sign in to sync your tasks",
        "Continue with GitHub on every computer. No verification email is needed.",
      );
      await cloud.unsubscribe();
      render();
      return;
    }
    await refreshCloud();
    await cloud.subscribe(() => refreshCloud());
  } catch (error) {
    syncMessage("Unable to sign in", error.message);
  }
}

async function startCloud() {
  migrationTasks = structuredClone(tasks);
  migrationAvailable = loadSucceeded && tasks.length > 0;
  tasks = [];
  loadSucceeded = false;
  $("syncPanel").hidden = false;
  $("saveNote").textContent = "Cloud sync · Sign in to load your tasks";
  render();
  try {
    if (!globalThis.supabase)
      throw Error("The sign-in client could not load. Please refresh.");
    const client = globalThis.supabase.createClient(
      cloudConfig.supabaseUrl,
      cloudConfig.supabasePublishableKey,
    );
    cloud = new TasklineCloud(client);
    client.auth.onAuthStateChange((event) => {
      if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED")
        setTimeout(() => updateCloudAccount(), 0);
    });
    await updateCloudAccount();
    setInterval(() => {
      if (!document.hidden) refreshCloud();
    }, 10000);
    window.addEventListener("focus", refreshCloud);
    window.addEventListener("online", refreshCloud);
  } catch (error) {
    syncMessage("Sync setup needed", error.message);
  }
}

$("signInForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!cloud) return;
  $("signInForm").inert = true;
  try {
    await cloud.signIn();
    syncMessage(
      "Opening GitHub…",
      "Sign in to GitHub to load your synced tasks.",
    );
  } catch (error) {
    syncMessage("Could not start GitHub sign-in", error.message);
  } finally {
    $("signInForm").inert = false;
  }
};
$("signOut").onclick = async () => {
  if (saving) return;
  if (draft) {
    closeEditor();
    if (draft) return;
  }
  try {
    await cloud.signOut();
    await updateCloudAccount();
  } catch (error) {
    notify(error.message);
  }
};
$("refreshCloud").onclick = () => {
  if (draft) {
    notify("Save or close the open task first.");
    return;
  }
  refreshCloud();
};
$("migrateTasks").onclick = async () => {
  if (!canEdit() || !migrationAvailable || cloud.revision !== 0) return;
  if (
    !confirm(
      `Sync the ${migrationTasks.length} tasks saved in this browser to your signed-in account? They will become available on your other computers.`,
    )
  )
    return;
  const previous = tasks;
  tasks = structuredClone(migrationTasks);
  if (await save()) {
    migrationAvailable = false;
    $("migrateTasks").hidden = true;
    restoreView();
    render();
    notify("Your existing tasks are now synced to your account.");
  } else {
    tasks = previous;
    render();
  }
};
const cloudReady = cloudEnabled ? startCloud() : Promise.resolve();
