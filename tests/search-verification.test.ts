import { test } from "node:test";
import assert from "node:assert/strict";
import { clippingValue, selectionResults } from "../lib/search-verification";
import { applySelection, selectionQuery } from "../lib/selection";
import { normalizeRows, defaultMapping } from "../lib/metrics";
import { type API } from "../lib/streambim";
import { clearLogs, getLogs, errorMessage } from "../lib/diagnostics";

const selected = normalizeRows(Array.from({ length: 24 }, (_, i) => ({
  GUID: `synthetic-${i}`, "@kind": i === 23 ? "Space" : "Spatial zone",
  "Long Name": "2 ROK", "BIP_Läge~Våning": `PLAN ${10 + i % 5}`,
  "BIP_Läge~Trapphus": "TH1",
})), "ROK");
const query = selectionQuery(selected, "b", defaultMapping);
const plane = { x: 0, y: 0, z: 1, d: -10 };
function mock(pages: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  let page = 0, mutations = 0;
  const api = {
    getProjectId: async () => "p",
    getBuildingId: async () => "b",
    getViewportState: async () => ({ clippingPlanes: [plane] }),
    // Regression: the old opaque-error wrapper must never be used.
    getObjectInfoForSearch: async () => { throw { code: "unknown", debug: null }; },
    makeApiRequest: async (args: Record<string, unknown>) => {
      calls.push(structuredClone(args));
      if (args.method === "POST") return JSON.stringify({ searchId: "s" });
      return pages[page++] ?? { data: [] };
    },
    applyObjectSearch: async (q: unknown, replace: boolean) => {
      mutations++;
      assert.deepEqual(q, query);
      assert.equal(replace, true);
      return true;
    },
  } as unknown as API;
  return { api, calls, mutations: () => mutations };
}
test("24-group mixed space/zone query uses direct API, explicit sort and GUID/ID fields; preserves clipping and exact active query", async () => {
  const { api, calls, mutations } = mock([{ data: selected.map(r => ({ GUID: r.guid })), meta: { total: 24 } }]);
  const before = JSON.stringify(query);
  assert.deepEqual(await applySelection(api, "p", "b", query, () => true, selected), { matchedRows: 24 });
  assert.equal(mutations(), 1);
  assert.equal(calls[0].url, "/project-p/api/v1/ifc-searches");
  const body = calls[0].body as typeof query;
  assert.equal(body.rules.length, 24);
  assert.ok(body.rules.every(group => group.at(-1)?.propKey === "Clipping planes" && group.at(-1)?.propValue === "0,0,1,-10"));
  const params = new URL(String(calls[1].url), "https://example.test").searchParams;
  assert.equal(atob(params.get("sortField")!), "ID");
  assert.equal(atob(params.get("fieldNames")!), "GUID|ID");
  assert.equal(params.get("fieldLimit"), "0");
  assert.equal(JSON.stringify(query), before);
});
test("Verification follows server-capped short pages and requests an empty page when no total is provided", async () => {
  const { api, calls } = mock([{ data: [{ GUID: "a", ID: "1" }] }, { data: [{ GUID: "b", ID: "2" }] }, { data: [] }]);
  assert.equal((await selectionResults(api, "p", "b", query, "", 2)).length, 2);
  assert.deepEqual(calls.slice(1).map(r => new URL(String(r.url), "https://example.test").searchParams.get("page[skip]")), ["0", "1", "2"]);
});
test("Verification fails closed on repeated pages, incomplete totals, changing totals and invalid totals", async () => {
  for (const pages of [
    [{ data: [{ GUID: "a" }] }, { data: [{ GUID: "a" }] }],
    [{ data: [{ GUID: "a" }], meta: { total: 2 } }, { data: [] }],
    [{ data: [{ GUID: "a" }], meta: { total: 2 } }, { data: [{ GUID: "b" }], meta: { total: 3 } }],
    [{ data: [], meta: { total: "bad" } }],
  ]) {
    const { api, mutations } = mock(pages);
    await assert.rejects(applySelection(api, "p", "b", query, () => true, selected));
    assert.equal(mutations(), 0);
  }
});
test("Original HTTP failure is shown in status and console; a failed POST never applies the filter", async () => {
  clearLogs();
  const { api, mutations } = mock([]);
  api.makeApiRequest = async () => { throw { status: 400, responseText: JSON.stringify({ errors: [{ code: "invalidRule", detail: "Invalid search predicate" }] }) }; };
  await assert.rejects(applySelection(api, "p", "b", query, () => true, selected), /HTTP 400: Invalid search predicate/);
  assert.equal(mutations(), 0);
  const entry = getLogs().find(r => r.operation.startsWith("POST "));
  assert.equal(entry?.state, "error");
  assert.match(JSON.stringify(entry?.summary), /Invalid search predicate/);
});
test("Export errors never proceed to applyObjectSearch", async () => {
  const { api, mutations } = mock([]);
  api.makeApiRequest = async (req) => {
    if (req.method === "POST") return { searchId: "s" };
    throw { status: 503, detail: "Export unavailable" };
  };
  await assert.rejects(applySelection(api, "p", "b", query, () => true, selected), /HTTP 503: Export unavailable/);
  assert.equal(mutations(), 0);
});
test("Changing clipping between verification and application prevents mutation", async () => {
  const { api, mutations } = mock([{ data: selected.map(r => ({ GUID: r.guid })), meta: { total: 24 } }]);
  let reads = 0;
  api.getViewportState = async () => ({ clippingPlanes: ++reads === 1 ? [plane] : [] });
  await assert.rejects(applySelection(api, "p", "b", query, () => true, selected), /Klippningen ändrades/);
  assert.equal(mutations(), 0);
});
test("Missing or invalid clipping state cannot silently verify an unclipped selection", async () => {
  const { api } = mock([]);
  for (const state of [{}, { clippingPlanes: null }, { clippingPlanes: [null] }, { clippingPlanes: [{ ...plane, x: NaN }] }]) {
    api.getViewportState = async () => state;
    await assert.rejects(clippingValue(api));
  }
  delete api.getViewportState;
  await assert.rejects(clippingValue(api), /saknar kontroll av klippning/);
});
test("Plain RPC errors are readable and do not expose bearer values", () => {
  assert.equal(errorMessage({ code: "unknown", debug: null }), "StreamBIM-fel: unknown");
  assert.match(errorMessage({ status: 401, detail: "Rejected Bearer supersecret" }), /HTTP 401/);
  assert.ok(!errorMessage({ detail: "Bearer supersecret" }).includes("supersecret"));
});
