import { type Mapping, type Space } from "./metrics";
import { type API, timed } from "./streambim";
import { traced } from "./diagnostics";
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
  if (rows.length > 10000)
    throw new Error(
      "Urvalet är för stort för modellsynk (max 10 000 objektrader). Begränsa med plan eller trapphus.",
    );
  // Two contradictory GUID predicates mean an empty result, never an empty/all query.
  if (!rows.length)
    return {
      rules: [
        ["0000000000000000000000", "1111111111111111111111"].map((guid) => ({
          buildingId,
          propKey: "@guid",
          propValue: guid,
        })),
      ],
    };
  const groups = rows.map((row) => {
    const rules: Rule[] = [
      { buildingId, propKey: "@guid", propValue: row.guid },
    ];
    if (row.longName)
      rules.push(propertyRule(buildingId, "Long Name", row.longName));
    if (row.floor !== "Saknar plan")
      rules.push(propertyRule(buildingId, mapping.floor, row.floor));
    if (row.stair !== "Saknar trapphus")
      rules.push(propertyRule(buildingId, mapping.stair, row.stair));
    return rules;
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
  // Do not race this mutation against a timeout: a late completion could overwrite a newer filter.
  // The serial queue waits for the actual RPC settlement before applying the latest filter.
  await traced(
    "StreamBIM.API.applyObjectSearch",
    { query, replace: true },
    async () => {
      const result = await api.applyObjectSearch!(query, true);
      if (result === false)
        throw new Error("StreamBIM accepterade inte filterfrågan.");
      return result;
    },
    (r) => ({
      accepted: true,
      returnedGuids: Array.isArray(r) ? r.length : undefined,
    }),
  );
  return true;
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
