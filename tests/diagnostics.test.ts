import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearLogs,
  getLogs,
  sanitize,
  subscribeLogs,
  traced,
} from "../lib/diagnostics";
test("Diagnostics redact sensitive headers, nested keys and credentials in URLs/messages", () => {
  const safe = sanitize({
    headers: { Authorization: "Bearer sensitive", Cookie: "secret-cookie" },
    nested: [{ password: "pw", api_key: "key", accessToken: "tok" }],
    url: "/path?token=secret&x=1",
    message: "Bearer abc.def-123",
  });
  const json = JSON.stringify(safe);
  for (const secret of [
    "sensitive",
    "secret-cookie",
    '"pw"',
    '"key"',
    '"tok"',
    "token=secret",
    "abc.def-123",
  ])
    assert.ok(!json.includes(secret));
  assert.ok(json.includes("[redacted]"));
});
test("Console logs lifecycle, duration and summary rather than full response; subscriptions detach", async () => {
  clearLogs();
  let notices = 0;
  const off = subscribeLogs(() => notices++);
  const response = { data: [{ private: "full response" }] };
  await traced(
    "POST /query",
    { body: { rules: [] } },
    async () => {
      assert.equal(getLogs()[0].state, "pending");
      return response;
    },
    (r) => ({ rows: r.data.length }),
  );
  assert.equal(getLogs()[0].state, "success");
  assert.deepEqual(getLogs()[0].summary, { rows: 1 });
  assert.ok(getLogs()[0].durationMs! >= 0);
  assert.equal(notices, 2);
  off();
  clearLogs();
  assert.equal(notices, 2);
});
test("Errors are rethrown and redacted in the console", async () => {
  clearLogs();
  const error = new Error("Rejected Bearer confidential");
  await assert.rejects(
    traced("RPC", {}, async () => {
      throw error;
    }),
    error,
  );
  assert.equal(getLogs()[0].state, "error");
  assert.ok(!JSON.stringify(getLogs()).includes("confidential"));
});
test("Only latest 60 calls are retained and clearing pending logs does not resurrect them", async () => {
  clearLogs();
  for (let i = 0; i < 65; i++) await traced(String(i), {}, async () => true);
  assert.equal(getLogs().length, 60);
  assert.equal(getLogs()[0].operation, "5");
  let resolve!: (value: boolean) => void;
  const pending = traced(
    "pending",
    {},
    () =>
      new Promise<boolean>((r) => {
        resolve = r;
      }),
  );
  clearLogs();
  resolve(true);
  await pending;
  assert.deepEqual(getLogs(), []);
});
