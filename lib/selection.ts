import { cell, type Mapping, type Space } from "./metrics";
import { type API, timed } from "./streambim";
import { traced } from "./diagnostics";
import { clippingValue, selectionResults } from "./search-verification";
export type Rule = {
  buildingId: string;
  propKey: string;
  propValue: string;
  psetName?: string;
  operator?: string;
};
export type SelectionQuery = { rules: Rule[][] };
const propertyRule = (buildingId: string, key: string, value: string): Rule => {
  const split = key.indexOf("~");
  return split < 0
    ? { buildingId, propKey: key, propValue: value }
    : {
        buildingId,
        psetName: key.slice(0, split),
        propKey: key.slice(split + 1),
        propValue: value,
      };
};
export function selectionQuery(
  rows: Space[],
  buildingId: string,
  mapping: Mapping,
): SelectionQuery {
  if (rows.some((r) => !r.guid))
    throw new Error(
      "Urvalet innehåller objekt utan GUID. StreamBIM-filtret ändras inte eftersom hela urvalet inte kan identifieras.",
    );
  if (rows.length > 5000)
    throw new Error(
      "Urvalet är för stort för modellsynk (max 5 000 objektrader). Begränsa med plan eller trapphus.",
    );
  // StreamBIM stops its scene search for zero hits. Do not claim an empty model selection.
  if (!rows.length)
    throw new Error(
      "Tomt widgeturval. StreamBIM behåller föregående modellfilter; välj ett urval med objekt för att synka.",
    );
  const groups = rows.flatMap((row) => {
    const rules: Rule[] = [
      { buildingId, propKey: "@guid", propValue: row.guid },
    ];
    if (row.longName)
      rules.push(propertyRule(buildingId, "Long Name", row.longName));
    if (row.floor !== "Saknar plan")
      rules.push(propertyRule(buildingId, mapping.floor, row.floor));
    if (row.stair !== "Saknar trapphus")
      rules.push(propertyRule(buildingId, mapping.stair, row.stair));
    // Explicit kind is essential: the viewer uses it to keep space meshes visible.
    // Older exports may omit kind, so include BOTH alternatives as separate OR groups.
    return (row.kind ? [row.kind] : ["Space", "Spatial zone"]).map((kind) => [
      ...rules,
      { buildingId, propKey: "@kind", propValue: kind },
    ]);
  });
  const unique = new Map(groups.map((r) => [JSON.stringify(r), r]));
  return { rules: [...unique.values()] };
}
export async function applySelection(
  api: API,
  projectId: string,
  buildingId: string,
  query: SelectionQuery,
  isCurrent: () => boolean,
  expectedRows: Space[],
) {
  const [project, building] = await Promise.all([
    timed(api.getProjectId()),
    timed(api.getBuildingId()),
  ]);
  if (String(project) !== projectId || String(building) !== buildingId)
    throw new Error(
      "Projektet eller byggnaden har bytts. Uppdatera widgetens data först.",
    );
  if (!isCurrent()) return false;
  if (!api.applyObjectSearch)
    throw new Error("StreamBIM-versionen saknar applyObjectSearch.");
  const clipping = await clippingValue(api);
  if (!isCurrent()) return false;
  const preflight = {
    query,
    clippingPlanes: clipping,
    expectedRows: expectedRows.length,
  };
  const matched = await traced(
    "Direkt API-sökning · verifiering av modellurval",
    preflight,
    async () => {
      const actual = await selectionResults(api, projectId, buildingId, query, clipping, expectedRows.length);
      const counts = (guids: string[]) => {
        const map = new Map<string, number>();
        for (const guid of guids) map.set(guid, (map.get(guid) || 0) + 1);
        return [...map].sort(([a], [b]) => a.localeCompare(b));
      };
      const guids = actual.map((r) =>
        cell(r as Record<string, unknown>, "GUID"),
      );
      if (
        guids.some((g) => !g) ||
        JSON.stringify(counts(guids)) !==
          JSON.stringify(counts(expectedRows.map((r) => r.guid)))
      )
        throw new Error(
          `StreamBIM hittar ${actual.length} objektrader, widgeten ${expectedRows.length}, eller andra GUID. Kontrollera klippning, aktuella modeller och uppdatera data. Föregående modellfilter behålls.`,
        );
      return actual.length;
    },
    (count) => ({
      matchedRows: count,
      expectedRows: expectedRows.length,
      guidsMatch: true,
    }),
  );
  if (!isCurrent()) return false;
  if (await clippingValue(api) !== clipping)
    throw new Error("Klippningen ändrades under verifieringen. Försök igen. Modellfiltret lämnas oförändrat.");
  if (
    String(await timed(api.getProjectId())) !== projectId ||
    String(await timed(api.getBuildingId())) !== buildingId
  )
    throw new Error(
      "Projektet byttes under verifieringen. Uppdatera data först.",
    );
  if (!isCurrent()) return false;
  // Do not race this mutation against a timeout: a late completion could overwrite a newer filter.
  // The serial queue waits for the actual RPC settlement before applying the latest filter.
  await traced(
    "StreamBIM.API.applyObjectSearch",
    { query, replace: true },
    async () => {
      const result = await api.applyObjectSearch!(structuredClone(query), true);
      if (result === false)
        throw new Error("StreamBIM accepterade inte filterfrågan.");
      return result;
    },
    (r) => ({
      accepted: true,
      returnedGuids: Array.isArray(r) ? r.length : undefined,
    }),
  );
  return { matchedRows: matched };
}
export function latestQueue() {
  let revision = 0,
    running = false,
    pending:
      | { revision: number; run: (isCurrent: () => boolean) => Promise<void> }
      | undefined;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending;
        pending = undefined;
        try {
          await job.run(() => job.revision === revision);
        } catch {
          /* Each caller reports its own failure. Keep the queue usable. */
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    submit(run: (isCurrent: () => boolean) => Promise<void>) {
      pending = { revision: ++revision, run };
      void drain();
    },
    invalidate() {
      revision++;
      pending = undefined;
    },
  };
}
