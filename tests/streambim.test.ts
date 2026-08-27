import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchCategory,
  fetchDataset,
  searchRules,
  timed,
  type API,
} from "../lib/streambim";
import { defaultMapping } from "../lib/metrics";
const row = (id: number) => ({
  GUID: `g${id}`,
  "Long Name": "2 ROK",
  "Dimensions~Area": 50,
});
test("Searches scope both spatial kinds to CURRENT building and Long Name", () => {
  const q = searchRules("dynamic-building", "ROK");
  assert.equal(q.rules.length, 2);
  assert.equal(q.rules[0][1].operator, "contains");
  assert.equal(q.rules[1][0].propValue, "Spatial zone");
  assert.ok(q.rules.flat().every((r) => r.buildingId === "dynamic-building"));
});
test("Pagination follows actual response length, including a short server-capped page", async () => {
  const calls: Record<string, unknown>[] = [];
  const api = {
    makeApiRequest: async (req: Record<string, unknown>) => {
      calls.push(req);
      if (req.method === "POST") return { searchId: "S" };
      const skip = Number(
        new URL(String(req.url), "https://x").searchParams.get("page[skip]"),
      );
      return JSON.stringify({
        data: skip === 0 ? [row(1), row(2)] : skip === 2 ? [row(3)] : [],
      });
    },
  } as unknown as API;
  const result = await fetchCategory(
    api,
    "current-project",
    "b",
    "ROK",
    defaultMapping,
    () => {},
  );
  assert.equal(result.length, 3);
  assert.equal(calls.length, 4);
  assert.ok(String(calls[0].url).includes("current-project"));
});
test("Repeating page and malformed responses fail closed", async () => {
  const api = {
    makeApiRequest: async (req: Record<string, unknown>) =>
      req.method === "POST" ? { searchId: "S" } : { data: [row(1)] },
  } as unknown as API;
  await assert.rejects(
    fetchCategory(api, "p", "b", "ROK", defaultMapping, () => {}),
    /upprepar/,
  );
  api.makeApiRequest = async (req) =>
    req.method === "POST" ? { searchId: "S" } : { data: "bad" };
  await assert.rejects(
    fetchCategory(api, "p", "b", "ROK", defaultMapping, () => {}),
    /objektlista/,
  );
});
test("Incomplete reported total cannot become a final KPI", async () => {
  let i = 0;
  const api = {
    makeApiRequest: async (req: Record<string, unknown>) =>
      req.method === "POST"
        ? { searchId: "S" }
        : { meta: { total: 10 }, data: i++ === 0 ? [row(1)] : [] },
  } as unknown as API;
  await assert.rejects(
    fetchCategory(api, "p", "b", "ROK", defaultMapping, () => {}),
    /ofullständigt/,
  );
});
test("Unrelated rows are rejected instead of counted", async () => {
  const api = {
    makeApiRequest: async (req: Record<string, unknown>) =>
      req.method === "POST"
        ? { searchId: "S" }
        : { data: [{ GUID: "x", "Long Name": "BADRUM" }] },
  } as unknown as API;
  await assert.rejects(
    fetchCategory(api, "p", "b", "ROK", defaultMapping, () => {}),
    /utanför/,
  );
});
test("A project switch during the fetch invalidates the result", async () => {
  let n = 0;
  const api = {
    getProjectId: async () => (++n === 1 ? "p1" : "p2"),
    getBuildingId: async () => "b",
    makeApiRequest: async (req: Record<string, unknown>) =>
      req.method === "POST" ? { searchId: "S" } : { data: [] },
  } as unknown as API;
  await assert.rejects(fetchDataset(api), /byttes/);
});
test("Timeout is bounded", async () => {
  await assert.rejects(timed(new Promise(() => {}), 5), /tid/);
});
test("Fetch retrieves all five categories from the current project without truncating the original ones", async () => {
  const words: string[] = [];
  const api = {
    getProjectId: async () => "current",
    getBuildingId: async () => "building",
    makeApiRequest: async (req: Record<string, unknown>) => {
      assert.ok(String(req.url).includes("/project-current/"));
      if (req.method === "POST") {
        const body = req.body as ReturnType<typeof searchRules>;
        const word = body.rules[0][1].propValue;
        words.push(word);
        return { searchId: word };
      }
      const url = new URL(String(req.url), "https://example.test"),
        word = url.searchParams.get("searchId")!;
      return { data: [{ GUID: word, "Long Name": word }], meta: { total: 1 } };
    },
  } as unknown as API;
  const data = await fetchDataset(api);
  assert.deepEqual(words, ["ROK", "LBTA", "MBTA", "LOFT", "LOKAL"]);
  assert.equal(data.mbta?.length, 1);
  assert.equal(data.loft?.length, 1);
  assert.equal(data.lokal?.length, 1);
});
test("Ambiguous category names cannot silently double-count areas", async () => {
  const api = {
    makeApiRequest: async (req: Record<string, unknown>) =>
      req.method === "POST"
        ? { searchId: "S" }
        : { data: [{ GUID: "x", "Long Name": "2 ROK LOFT" }] },
  } as unknown as API;
  await assert.rejects(
    fetchCategory(api, "p", "b", "ROK", defaultMapping, () => {}),
    /flera areakategorier/,
  );
});
