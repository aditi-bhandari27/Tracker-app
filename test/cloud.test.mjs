import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const context = vm.createContext({});
vm.runInContext(
  readFileSync(new URL("../public/cloud.js", import.meta.url), "utf8"),
  context,
);
const Cloud = context.TasklineCloud;
const TOKEN = "a".repeat(64);
function service() {
  let board = { tasks: [], revision: 0 };
  return {
    async rpc(name, args) {
      if (args.link_token !== TOKEN)
        return { error: { code: "42501", message: "Invalid private link" } };
      if (name === "load_taskline_link")
        return { data: structuredClone(board) };
      if (args.expected_revision !== board.revision)
        return { error: { code: "PT409" } };
      board = {
        tasks: structuredClone(args.new_tasks),
        revision: board.revision + 1,
      };
      return { data: board.revision };
    },
  };
}
test("two computers with the same private link share edits without auth", async () => {
  const db = service(),
    first = new Cloud(db, TOKEN),
    second = new Cloud(db, TOKEN);
  const records = [{ id: "task-1", title: "Shared task", issues: [] }];
  await first.save(records);
  const loaded = await second.load();
  assert.deepEqual(loaded.tasks, records);
  second.revision = loaded.revision;
  await second.save([{ ...records[0], title: "Edited on second computer" }]);
  assert.equal(
    (await first.load()).tasks[0].title,
    "Edited on second computer",
  );
});
test("missing, malformed and incorrect links cannot read or save", async () => {
  const db = service();
  for (const token of [undefined, "", "short", "b".repeat(64)]) {
    const client = new Cloud(db, token);
    await assert.rejects(() => client.load());
    await assert.rejects(() => client.save([]));
  }
});
test("stale saves preserve the newer board", async () => {
  const db = service(),
    first = new Cloud(db, TOKEN),
    stale = new Cloud(db, TOKEN);
  await first.save([{ id: "newer" }]);
  await assert.rejects(() => stale.save([{ id: "stale" }]), /another computer/);
  assert.equal((await first.load()).tasks[0].id, "newer");
  assert.equal(stale.revision, 0);
});
test("network failures do not advance acknowledged revision", async () => {
  const cloud = new Cloud(
    {
      rpc: async () => {
        throw Error("Offline");
      },
    },
    TOKEN,
  );
  cloud.revision = 4;
  await assert.rejects(() => cloud.save([]), /Offline/);
  assert.equal(cloud.revision, 4);
});
