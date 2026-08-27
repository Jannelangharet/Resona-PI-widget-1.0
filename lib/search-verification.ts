import { base64, requestJson, timed, type API } from "./streambim";
import { traced } from "./diagnostics";
import type { SelectionQuery } from "./selection";
import type { RawRow } from "./metrics";

// Match the viewer's searchForIfcObjects clipping predicate without changing its state.
export async function clippingValue(api: API): Promise<string> {
  if (!api.getViewportState)
    throw new Error("StreamBIM saknar kontroll av klippning. Modellfiltret lämnas oförändrat.");
  return traced("StreamBIM.API.getViewportState · klippkontroll", {}, async () => {
    const raw = await timed(api.getViewportState!());
    const state = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!state || !Array.isArray(state.clippingPlanes))
      throw new Error("Kan inte läsa StreamBIMs klippning. Modellfiltret lämnas oförändrat.");
    return state.clippingPlanes.map((plane: Record<string, unknown>) => {
      if (!plane || [plane.x, plane.y, plane.z, plane.d].some(v => typeof v !== "number" || !Number.isFinite(v)))
        throw new Error("StreamBIM returnerade ogiltiga klippplan.");
      return [plane.x, plane.y, plane.z, plane.d].join(",");
    }).join(",");
  }, (value) => ({ clippingPlanes: value ? value.split(",").length / 4 : 0 }));
}

// Avoid getObjectInfoForSearch: it goes through the viewer task, which can swallow
// the original HTTP error, and serializes an omitted sort as sortField=undefined.
// Use the same search/export route as the working dataset loader, with explicit
// sort, bounded fields and complete pagination. This never changes the active search.
export async function selectionResults(
  api: API, projectId: string, buildingId: string,
  query: SelectionQuery, clipping: string, maxRows: number,
): Promise<RawRow[]> {
  const filter = structuredClone(query);
  if (clipping) for (const group of filter.rules)
    group.push({ buildingId, propKey: "Clipping planes", propValue: clipping });
  const root = `/project-${encodeURIComponent(projectId)}/api/v1/ifc-searches`;
  const search = await requestJson(api, root, "POST", filter);
  if (!search.searchId) throw new Error("Sökverifieringen saknar sök-ID. Modellfiltret lämnas oförändrat.");
  const rows: RawRow[] = [], pages = new Set<string>();
  let expected: number | undefined;
  while (rows.length <= maxRows) {
    const params = new URLSearchParams({
      searchId: String(search.searchId), fieldUnion: "true", fieldLimit: "0",
      fieldNames: base64("GUID|ID"), "page[limit]": "1000",
      "page[skip]": String(rows.length), sortField: base64("ID"),
      sortDescending: "false", queue: "resonaPI",
    });
    const result = await requestJson(api, `${root}/export/json?${params}`);
    if (!Array.isArray(result.data)) throw new Error("Sökverifieringen saknar objektlista.");
    const page = result.data as RawRow[];
    if (page.some(r => !r || typeof r !== "object" || Array.isArray(r)))
      throw new Error("Ogiltigt söksvar från StreamBIM.");
    const meta = result.meta as Record<string, unknown> | undefined;
    const total = meta?.total ?? meta?.totalCount;
    if (total != null) {
      const count = Number(total);
      if (!Number.isSafeInteger(count) || count < 0 || (expected !== undefined && expected !== count))
        throw new Error("Sökverifieringen har ogiltigt eller ändrat totalantal.");
      expected = count;
    }
    if (expected !== undefined && expected > maxRows)
      throw new Error(`StreamBIM hittar ${expected} objektrader, widgeten ${maxRows}. Modellfiltret lämnas oförändrat.`);
    if (!page.length) {
      if (expected !== undefined && rows.length !== expected)
        throw new Error("Sökverifieringen är ofullständig. Modellfiltret lämnas oförändrat.");
      return rows;
    }
    const fingerprint = JSON.stringify(page);
    if (pages.has(fingerprint)) throw new Error("Sökverifieringen upprepar en exportsida.");
    pages.add(fingerprint);
    rows.push(...page);
    if (rows.length > maxRows || (expected !== undefined && rows.length > expected))
      throw new Error("Sökverifieringen innehåller fler objektrader än väntat. Modellfiltret lämnas oförändrat.");
    if (rows.length === expected) return rows;
    // A short page is not proof of completion: fetch until a total or an empty page.
  }
  throw new Error("Sökverifieringen överskrider urvalet.");
}
