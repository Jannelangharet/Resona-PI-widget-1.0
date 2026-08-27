import { test } from "node:test";
import assert from "node:assert/strict";
import { applySelection, latestQueue, selectionQuery } from "../lib/selection";
import { defaultMapping, normalizeRows } from "../lib/metrics";
import { type API } from "../lib/streambim";
import { clearLogs, getLogs } from "../lib/diagnostics";
const rows = normalizeRows(
  Array.from({ length: 308 }, (_, i) => ({
    GUID: `guid-${i}`,
    "IFC Type": "IfcSpace",
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
  assert.equal(q.rules[0].length, 3);
  assert.equal(rows.length, 308);
});
test("Empty selection never clears the viewer's existing filter", () => {
  assert.throws(
    () => selectionQuery([], "b", defaultMapping),
    /Tomt widgeturval/,
  );
});
test("Missing GUID and oversized selection are rejected rather than partially applied", () => {
  assert.throws(
    () => selectionQuery([{ ...rows[0], guid: "" }], "b", defaultMapping),
    /utan GUID/,
  );
  assert.throws(
    () => selectionQuery(Array(5001).fill(rows[0]), "b", defaultMapping),
    /5 000/,
  );
});
test("Mutation checks project/building and stale work; applies exact root query with replace=true", async () => {
  const calls: unknown[] = [];
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    getObjectInfoForSearch: async () => ({ data: [{ GUID: rows[0].guid }] }),
    applyObjectSearch: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as API;
  const q = selectionQuery(rows.slice(0, 1), "b", defaultMapping);
  await assert.rejects(
    applySelection(api, "different-project", "b", q, () => true, [rows[0]]),
    /bytts/,
  );
  await assert.rejects(
    applySelection(api, "p", "different-building", q, () => true, [rows[0]]),
    /bytts/,
  );
  assert.equal(
    await applySelection(api, "p", "b", q, () => false, [rows[0]]),
    false,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(
    await applySelection(api, "p", "b", q, () => true, [rows[0]]),
    { matchedRows: 1 },
  );
  assert.deepEqual(calls, [[q, true]]);
});
test("Failed RPC is surfaced in console and absence of API is not silently ignored", async () => {
  clearLogs();
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    applyObjectSearch: async () => false,
    getObjectInfoForSearch: async () => ({ data: [{ GUID: rows[0].guid }] }),
  } as unknown as API;
  const q = selectionQuery([rows[0]], "b", defaultMapping);
  await assert.rejects(
    applySelection(api, "p", "b", q, () => true, [rows[0]]),
    /accepterade inte/,
  );
  assert.equal(getLogs().at(-1)?.state, "error");
  delete api.applyObjectSearch;
  await assert.rejects(
    applySelection(api, "p", "b", q, () => true, [rows[0]]),
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
test("Space mode is explicit in EVERY group, with zone support and fallback for older exports", () => {
  const known = selectionQuery(rows, "b", defaultMapping);
  assert.ok(
    known.rules.every((g) =>
      g.some((r) => r.propKey === "@kind" && r.propValue === "Space"),
    ),
  );
  const zone = selectionQuery(
    [{ ...rows[0], kind: "Spatial zone" }],
    "b",
    defaultMapping,
  );
  assert.equal(zone.rules.length, 1);
  assert.equal(zone.rules[0].at(-1)?.propValue, "Spatial zone");
  const unknown = selectionQuery(
    [{ ...rows[0], kind: undefined }],
    "b",
    defaultMapping,
  );
  assert.equal(unknown.rules.length, 2);
  assert.deepEqual(
    unknown.rules.map((g) => g.at(-1)?.propValue),
    ["Space", "Spatial zone"],
  );
});
test("No mutation on zero, wrong, clipped, malformed, incomplete or duplicate-mismatched preflight results", async () => {
  let mutations = 0;
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    applyObjectSearch: async () => {
      mutations++;
      return true;
    },
  } as unknown as API;
  const q = selectionQuery([rows[0]], "b", defaultMapping);
  for (const response of [
    { data: [] },
    { data: [{ GUID: "other" }] },
    { data: [{}] },
    { data: [null] },
    { data: "bad" },
    { data: [{ GUID: rows[0].guid }], meta: { total: 2 } },
    { data: [{ GUID: rows[0].guid }, { GUID: rows[0].guid }] },
  ]) {
    api.getObjectInfoForSearch = async () => response;
    await assert.rejects(
      applySelection(api, "p", "b", q, () => true, [rows[0]]),
    );
  }
  assert.equal(mutations, 0);
});
test("Preflight compares GUID multiplicities, protects query from SDK mutation and ignores stale completion", async () => {
  const selected = [rows[0], rows[0], rows[1]],
    q = selectionQuery(selected, "b", defaultMapping),
    before = JSON.stringify(q);
  let current = true,
    mutations = 0;
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    getObjectInfoForSearch: async (req: { filter: { rules: unknown[] } }) => {
      req.filter.rules = [];
      return JSON.stringify({
        data: [
          { GUID: rows[1].guid },
          { GUID: rows[0].guid },
          { GUID: rows[0].guid },
        ],
      });
    },
    applyObjectSearch: async () => {
      mutations++;
      return true;
    },
  } as unknown as API;
  assert.deepEqual(
    await applySelection(api, "p", "b", q, () => current, selected),
    { matchedRows: 3 },
  );
  assert.equal(JSON.stringify(q), before);
  api.getObjectInfoForSearch = async () => {
    current = false;
    return { data: selected.map((r) => ({ GUID: r.guid })) };
  };
  assert.equal(
    await applySelection(api, "p", "b", q, () => current, selected),
    false,
  );
  assert.equal(mutations, 1);
});
test("A project switch during preflight prevents applying the old filter", async () => {
  let project = "p",
    mutations = 0;
  const api = {
    getProjectId: async () => project,
    getBuildingId: async () => "b",
    getObjectInfoForSearch: async () => {
      project = "new";
      return { data: [{ GUID: rows[0].guid }] };
    },
    applyObjectSearch: async () => {
      mutations++;
      return true;
    },
  } as unknown as API;
  await assert.rejects(
    applySelection(
      api,
      "p",
      "b",
      selectionQuery([rows[0]], "b", defaultMapping),
      () => true,
      [rows[0]],
    ),
    /byttes/,
  );
  assert.equal(mutations, 0);
});
