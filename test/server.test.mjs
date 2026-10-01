import { test } from "node:test";
import assert from "node:assert/strict";
import { server } from "../scripts/server.mjs";

test("server serves app files and excludes private files", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Taskline/);
    assert.equal((await fetch(url + "/app.js")).status, 200);
    assert.equal((await fetch(url + "/task-tracker.html")).status, 200);
    assert.equal((await fetch(url + "/.git/config")).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
