import {
  cell,
  categories,
  defaultMapping,
  type Category,
  type Mapping,
  type RawRow,
} from "./metrics";
import { errorMessage, traced } from "./diagnostics";
import type { SelectionQuery } from "./selection";
export type API = {
  getProjectId: () => Promise<string>;
  getBuildingId: () => Promise<string>;
  makeApiRequest: (request: Record<string, unknown>) => Promise<unknown>;
  gotoObject: (guid: string) => Promise<unknown>;
  applyObjectSearch?: (
    query: SelectionQuery,
    replace?: boolean,
  ) => Promise<unknown>;
  zoomToSearchResult?: () => Promise<unknown>;
  getViewportState?: () => Promise<unknown>;
};
declare global {
  interface Window {
    StreamBIM?: {
      API: API;
      connectToParent: (
        window: Window,
        callbacks: Record<string, unknown>,
      ) => Promise<void>;
      _connection?: { destroy: () => void };
    };
  }
}
export type Dataset = {
  projectId: string;
  buildingId: string;
  projectName?: string;
  rok: RawRow[];
  lbta: RawRow[];
  mbta?: RawRow[];
  loft?: RawRow[];
  lokal?: RawRow[];
  source: "live" | "reference";
  capturedAt: string;
};
const FIELDS = [
  "GUID",
  "ID",
  "Name",
  "Long Name",
  "IFC Type",
  "@kind",
  "File Name",
  "Dimensions~Area",
  "BIP_Läge~Våning",
  "BIP_Läge~Trapphus",
  "Identity Data~LÄGENHET",
  "Identity Data~Number",
];
export function searchRules(buildingId: string, keyword: string) {
  return {
    rules: ["Space", "Spatial zone"].map((kind) => [
      { buildingId, propKey: "@kind", propValue: kind },
      {
        buildingId,
        propKey: "Long Name",
        operator: "contains",
        propValue: keyword,
      },
    ]),
  };
}
export async function timed<T>(work: Promise<T>, ms = 45000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("StreamBIM svarade inte i tid. Försök igen.")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
let connection: Promise<API> | undefined;
export function connect(): Promise<API> {
  if (connection) return connection;
  connection = (async () => {
    if (window.self === window.top)
      throw new Error(
        "Öppna widgetens URL inne i StreamBIM. Den använder projektets befintliga inloggning.",
      );
    let origin: URL;
    try {
      origin = new URL(document.referrer);
    } catch {
      throw new Error(
        "StreamBIM-föräldern saknas. Tillåt origin i widgetens referrer-policy.",
      );
    }
    if (
      origin.protocol !== "https:" ||
      !(
        origin.hostname === "streambim.com" ||
        origin.hostname.endsWith(".streambim.com")
      )
    )
      throw new Error(
        "Widgeten kan bara ansluta till en betrodd StreamBIM-domän.",
      );
    if (!window.StreamBIM) {
      await timed(
        new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = new URL(
            "./vendor/streambim-widget-api.min.js",
            document.baseURI,
          ).href;
          s.onload = () => resolve();
          s.onerror = () => {
            s.remove();
            reject(new Error("Kunde inte ladda StreamBIM-kopplingen."));
          };
          document.head.appendChild(s);
        }),
        15000,
      );
    }
    // The SDK implementation expects the remote parent window (not window.self).
    await traced("StreamBIM.connectToParent", { origin: origin.origin }, () =>
      timed(window.StreamBIM!.connectToParent(window.parent, {}), 20000),
    );
    return window.StreamBIM!.API;
  })().catch((e) => {
    window.StreamBIM?._connection?.destroy();
    connection = undefined;
    throw e;
  });
  return connection;
}
function parsed(value: unknown): Record<string, unknown> {
  const v = typeof value === "string" ? JSON.parse(value) : value;
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Oväntat svar från StreamBIM.");
  return v as Record<string, unknown>;
}
export function base64(s: string) {
  return btoa(
    Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(
      "",
    ),
  );
}
export async function requestJson(api: API, url: string, method = "GET", body?: unknown) {
  const args = {
    url, method, ...(body ? { body } : {}),
    accept: "application/json", contentType: "application/json",
  };
  try {
    return await traced(
      `${method} ${url.split("?")[0]}`, args,
      async () => parsed(await timed(api.makeApiRequest(args))),
      (result) => {
        const meta = result.meta as Record<string, unknown> | undefined;
        return {
          searchId: result.searchId,
          rows: Array.isArray(result.data) ? result.data.length : undefined,
          total: meta?.total ?? meta?.totalCount,
        };
      },
    );
  } catch (error) {
    throw new Error(`${method} ${url.split("?")[0]}: ${errorMessage(error)}. Se API-konsolen.`);
  }
}
export async function fetchCategory(
  api: API,
  projectId: string,
  buildingId: string,
  keyword: Category,
  mapping: Mapping,
  onProgress: (text: string) => void,
) {
  const root = `/project-${encodeURIComponent(projectId)}/api/v1/ifc-searches`;
  const request = (url: string, method = "GET", body?: unknown) =>
    requestJson(api, url, method, body);
  const search = await request(root, "POST", searchRules(buildingId, keyword));
  if (!search.searchId) throw new Error(`${keyword}: sökningen saknar sök-ID.`);
  const rows: RawRow[] = [];
  const pages = new Set<string>();
  const pageSize = 1000;
  let expected: number | undefined;
  for (let skip = 0; skip < 100000; ) {
    const q = new URLSearchParams({
      searchId: String(search.searchId),
      fieldUnion: "true",
      fieldLimit: "0",
      fieldNames: base64(
        [
          ...new Set([...FIELDS, mapping.area, mapping.floor, mapping.stair]),
        ].join("|"),
      ),
      "page[limit]": String(pageSize),
      "page[skip]": String(skip),
      sortField: base64("ID"),
      sortDescending: "false",
      queue: "resonaPI",
    });
    const result = await request(`${root}/export/json?${q}`);
    if (!Array.isArray(result.data))
      throw new Error(`${keyword}: svaret saknar objektlista.`);
    const page = result.data as RawRow[];
    if (page.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
      throw new Error(`${keyword}: ogiltigt objekt i svaret.`);
    const meta = result.meta as Record<string, unknown> | undefined;
    const total = meta?.total ?? meta?.totalCount;
    if (total !== undefined && Number.isFinite(Number(total)))
      expected = Number(total);
    if (!page.length) {
      if (expected !== undefined && rows.length !== expected)
        throw new Error(
          `${keyword}: ofullständigt resultat (${rows.length}/${expected}).`,
        );
      return rows;
    }
    const fingerprint = JSON.stringify(page);
    if (pages.has(fingerprint))
      throw new Error(
        `${keyword}: servern upprepar en sida. Inga ofullständiga nyckeltal visas.`,
      );
    pages.add(fingerprint);
    if (page.some((r) => !cell(r, "Long Name").toUpperCase().includes(keyword)))
      throw new Error(
        `${keyword}: exporten saknar Long Name eller innehåller objekt utanför sökningen.`,
      );
    if (
      page.some(
        (r) =>
          categories.filter((c) =>
            cell(r, "Long Name").toUpperCase().includes(c),
          ).length > 1,
      )
    )
      throw new Error(
        `${keyword}: ett Long Name matchar flera areakategorier. Kontrollera namngivningen för att undvika dubbelräkning.`,
      );
    rows.push(...page);
    skip += page.length;
    onProgress(`${keyword}: ${rows.length} objekt hämtade`);
    if (expected !== undefined && rows.length > expected)
      throw new Error(
        `${keyword}: antalet exporterade objekt överstiger sökresultatet.`,
      );
    if (expected !== undefined && rows.length === expected) return rows;
    // Without an explicit total, request the next page even after a short page.
  }
  throw new Error(
    `${keyword}: säkerhetsgränsen 100 000 objekt nåddes. Begränsa urvalet.`,
  );
}
export async function fetchDataset(
  api: API,
  mapping = defaultMapping,
  onProgress = (s: string) => {
    void s;
  },
): Promise<Dataset> {
  const projectId = String(await timed(api.getProjectId()));
  const buildingId = String(await timed(api.getBuildingId()));
  if (
    !projectId ||
    !buildingId ||
    ["undefined", "null"].includes(projectId) ||
    ["undefined", "null"].includes(buildingId)
  )
    throw new Error("StreamBIM saknar projekt- eller byggnads-ID.");
  const rok = await fetchCategory(
    api,
    projectId,
    buildingId,
    "ROK",
    mapping,
    onProgress,
  );
  const lbta = await fetchCategory(
    api,
    projectId,
    buildingId,
    "LBTA",
    mapping,
    onProgress,
  );
  const mbta = await fetchCategory(
    api,
    projectId,
    buildingId,
    "MBTA",
    mapping,
    onProgress,
  );
  const loft = await fetchCategory(
    api,
    projectId,
    buildingId,
    "LOFT",
    mapping,
    onProgress,
  );
  const lokal = await fetchCategory(
    api,
    projectId,
    buildingId,
    "LOKAL",
    mapping,
    onProgress,
  );
  if (
    String(await timed(api.getProjectId())) !== projectId ||
    String(await timed(api.getBuildingId())) !== buildingId
  )
    throw new Error("Projektet byttes under hämtningen. Uppdatera igen.");
  return {
    projectId,
    buildingId,
    rok,
    lbta,
    mbta,
    loft,
    lokal,
    source: "live",
    capturedAt: new Date().toISOString(),
  };
}
