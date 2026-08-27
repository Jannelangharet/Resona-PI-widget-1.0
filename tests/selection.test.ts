import { test } from "node:test";
import assert from "node:assert/strict";
import { applySelection, latestQueue, selectionQuery } from "../lib/selection";
import { defaultMapping, normalizeRows } from "../lib/metrics";
import { type API } from "../lib/streambim";
import { clearLogs, getLogs } from "../lib/diagnostics";
const rows = normalizeRows(
  Array.from({ length: 308 }, (_, i) => ({
    GUID: `guid-${i}`,
    "Long Name": "2 ROK",
    "BIP_Läge~Våning": String(i % 10),
    "BIP_Läge~Trapphus": "A",
  })),
  "ROK",
);
test("Selection includes all 308 rows, not the 40-row visible page; AND properties in OR groups", () => {
  const q = selectionQuery(rows, "current-building", defaultMapping);
  assert.equal(q.rules.length, 308);
  assert.equal(q.rules[307][0].propValue, "guid-307");
  assert.ok(q.rules.flat().every((r) => r.buildingId === "current-building"));
  assert.deepEqual(q.rules[0][2], {
    buildingId: "current-building",
    psetName: "BIP_Läge",
    propKey: "Våning",
    propValue: "0",
  });
  assert.ok(!("filter" in q));
});
test("Filtered selection contains only matching rows and supports custom property mappings", () => {
  const selected = rows.filter((r) => r.floor === "3");
  const q = selectionQuery(selected, "b", {
    ...defaultMapping,
    floor: "Custom~Level",
  });
  assert.equal(q.rules.length, 31);
  assert.ok(
    q.rules.every((g) =>
      g.some(
        (r) =>
          r.psetName === "Custom" &&
          r.propKey === "Level" &&
          r.propValue === "3",
      ),
    ),
  );
});
test("Identical groups are deduplicated without modifying counts or inventing missing properties", () => {
  const r = { ...rows[0], floor: "Saknar plan", stair: "Saknar trapphus" };
  const q = selectionQuery([r, r], "b", defaultMapping);
  assert.equal(q.rules.length, 1);
  assert.equal(q.rules[0].length, 2);
  assert.equal(rows.length, 308);
});
test("Empty results form a contradictory AND group, never an empty/all-object query", () => {
  const q = selectionQuery([], "b", defaultMapping);
  assert.equal(q.rules.length, 1);
  assert.equal(q.rules[0].length, 2);
  assert.ok(q.rules[0].every((r) => r.propKey === "@guid"));
  assert.notEqual(q.rules[0][0].propValue, q.rules[0][1].propValue);
});
test("Missing GUID and oversized selection are rejected rather than partially applied", () => {
  assert.throws(
    () => selectionQuery([{ ...rows[0], guid: "" }], "b", defaultMapping),
    /utan GUID/,
  );
  assert.throws(
    () => selectionQuery(Array(10001).fill(rows[0]), "b", defaultMapping),
    /10 000/,
  );
});
test("Mutation checks project/building and stale work; applies exact root query with replace=true", async () => {
  const calls: unknown[] = [];
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    applyObjectSearch: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as API;
  const q = selectionQuery(rows.slice(0, 1), "b", defaultMapping);
  await assert.rejects(
    applySelection(api, "different-project", "b", q, () => true),
    /bytts/,
  );
  await assert.rejects(
    applySelection(api, "p", "different-building", q, () => true),
    /bytts/,
  );
  assert.equal(await applySelection(api, "p", "b", q, () => false), false);
  assert.equal(calls.length, 0);
  assert.equal(await applySelection(api, "p", "b", q, () => true), true);
  assert.deepEqual(calls, [[q, true]]);
});
test("Failed RPC is surfaced in console and absence of API is not silently ignored", async () => {
  clearLogs();
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    applyObjectSearch: async () => false,
  } as unknown as API;
  const q = selectionQuery([], "b", defaultMapping);
  await assert.rejects(
    applySelection(api, "p", "b", q, () => true),
    /accepterade inte/,
  );
  assert.equal(getLogs().at(-1)?.state, "error");
  delete api.applyObjectSearch;
  await assert.rejects(
    applySelection(api, "p", "b", q, () => true),
    /saknar applyObjectSearch/,
  );
});
test("Rapid A/B/C changes serialize mutations and apply only latest queued filter C", async () => {
  const queue = latestQueue(),
    events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  queue.submit(async (isCurrent) => {
    events.push("A:start");
    await blocked;
    events.push(`A:current=${isCurrent()}`);
  });
  queue.submit(async () => {
    events.push("B");
  });
  queue.submit(async (isCurrent) => {
    events.push(`C:current=${isCurrent()}`);
    finished();
  });
  assert.deepEqual(events, ["A:start"]);
  release();
  await done;
  assert.deepEqual(events, ["A:start", "A:current=false", "C:current=true"]);
});
test("Pausing invalidates pending work and a rejected job does not break the queue", async () => {
  const queue = latestQueue(),
    events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.submit(async (current) => {
    await blocked;
    events.push(String(current()));
    throw new Error("simulated failure");
  });
  queue.submit(async () => {
    events.push("must not run");
  });
  queue.invalidate();
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) =>
    queue.submit(async () => {
      events.push("resumed");
      resolve();
    }),
  );
  assert.deepEqual(events, ["false", "resumed"]);
});
