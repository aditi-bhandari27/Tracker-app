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

// In-memory service mirrors the database's owner-scoped read and atomic revision contract.
function service() {
  const rows = new Map();
  return {
    client(owner) {
      return {
        auth: {
          getUser: async () => ({
            data: { user: owner ? { id: owner } : null },
          }),
        },
        from() {
          return {
            select() {
              return {
                eq(key, value) {
                  return {
                    maybeSingle: async () => ({
                      data:
                        value === owner
                          ? structuredClone(rows.get(owner) || null)
                          : null,
                    }),
                  };
                },
              };
            },
          };
        },
        async rpc(name, args) {
          if (!owner) return { error: { code: "42501" } };
          const previous = rows.get(owner) || { tasks: [], revision: 0 };
          if (previous.revision !== args.expected_revision)
            return { error: { code: "40001" } };
          const revision = previous.revision + 1;
          rows.set(owner, { tasks: structuredClone(args.new_tasks), revision });
          return { data: revision };
        },
      };
    },
  };
}

test("two computers using the same account load identical saved tasks", async () => {
  const db = service(),
    first = new Cloud(db.client("owner")),
    second = new Cloud(db.client("owner"));
  await first.session();
  await second.session();
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

test("stale saves are rejected without overwriting newer changes", async () => {
  const db = service(),
    first = new Cloud(db.client("owner")),
    stale = new Cloud(db.client("owner"));
  await first.session();
  await stale.session();
  await first.save([{ id: "newer" }]);
  await assert.rejects(() => stale.save([{ id: "stale" }]), /another computer/);
  assert.equal((await first.load()).tasks[0].id, "newer");
  assert.equal(stale.revision, 0);
});

test("different accounts do not share records and signed-out saves fail", async () => {
  const db = service(),
    first = new Cloud(db.client("owner")),
    other = new Cloud(db.client("other"));
  await first.session();
  await other.session();
  await first.save([{ id: "private" }]);
  assert.equal((await other.load()).tasks.length, 0);
  const signedOut = new Cloud(db.client(null));
  await assert.rejects(() => signedOut.save([]), /Sign in/);
});

test("network failures do not advance the acknowledged revision", async () => {
  const cloud = new Cloud({
    rpc: async () => {
      throw Error("Offline");
    },
  });
  cloud.user = { id: "owner" };
  cloud.revision = 4;
  await assert.rejects(() => cloud.save([]), /Offline/);
  assert.equal(cloud.revision, 4);
});
