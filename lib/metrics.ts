export type RawRow = Record<string, unknown>;
export const categories = ["ROK", "LBTA", "MBTA", "LOFT", "LOKAL"] as const;
export type Category = (typeof categories)[number];
export type Space = {
  key: string;
  guid: string;
  name: string;
  longName: string;
  type: string;
  floor: string;
  stair: string;
  file: string;
  area: number | null;
  category: Category;
  kind?: "Space" | "Spatial zone";
};
export type Mapping = {
  area: string;
  floor: string;
  stair: string;
  unit: "m2" | "mm2";
};
export const defaultMapping: Mapping = {
  area: "Dimensions~Area",
  floor: "BIP_Läge~Våning",
  stair: "BIP_Läge~Trapphus",
  unit: "m2",
};
export function cell(row: RawRow, key: string): string {
  const found = Object.keys(row).find(
    (k) => k.toLocaleLowerCase("sv") === key.toLocaleLowerCase("sv"),
  );
  let v = found ? row[found] : undefined;
  if (Array.isArray(v)) v = v.length === 1 ? v[0] : undefined;
  if (v && typeof v === "object" && "value" in v) v = v.value;
  return v == null ? "" : String(v).trim();
}
export function parseArea(
  value: unknown,
  unit: Mapping["unit"] = "m2",
): number | null {
  if (value == null || value === "") return null;
  let s = String(value)
    .trim()
    .replace(/\s|\u00a0/g, "");
  const explicit = s.match(/(mm²|mm2|m²|m2)$/i)?.[0].toLowerCase();
  s = s.replace(/(mm²|mm2|m²|m2)$/i, "");
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf("."))
      s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else s = s.replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
  const n =
    Number(s) /
    ((explicit ? explicit.startsWith("mm") : unit === "mm2") ? 1e6 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function normalizeRows(
  rows: RawRow[],
  category: Space["category"],
  mapping = defaultMapping,
  reference = false,
): Space[] {
  return rows.map((r, i) => {
    const longName =
      cell(r, "Long Name") ||
      (reference ? cell(r, "BIP_Namn~Beskrivning") : "");
    const match = longName.match(/(\d+(?:[.,]\d+)?)\s*ROK/i);
    return {
      key: `${category}-${i}`,
      category,
      kind: /spatial.?zone/i.test(cell(r, "@kind") || cell(r, "IFC Type"))
        ? "Spatial zone"
        : /space/i.test(cell(r, "@kind") || cell(r, "IFC Type"))
          ? "Space"
          : undefined,
      guid: cell(r, "GUID"),
      name:
        cell(r, "Identity Data~LÄGENHET") ||
        cell(r, "Name") ||
        cell(r, "Identity Data~Number") ||
        "Utan namn",
      longName,
      type: match
        ? `${match[1]} ROK`
        : category === "ROK"
          ? "Övrig ROK"
          : category,
      floor: cell(r, mapping.floor) || "Saknar plan",
      stair: cell(r, mapping.stair) || "Saknar trapphus",
      file: cell(r, "File Name") || "Ej angiven",
      area: parseArea(cell(r, mapping.area), mapping.unit),
    };
  });
}
export function stats(rows: Space[]) {
  const valid = rows.filter((r) => r.area !== null);
  const area = valid.length ? valid.reduce((sum, r) => sum + r.area!, 0) : null;
  const ids = rows.map((r) => r.guid).filter(Boolean);
  return {
    count: rows.length,
    area,
    mean: area === null ? null : area / valid.length,
    valid: valid.length,
    missing: rows.length - valid.length,
    unique: new Set(ids).size,
    duplicateGuids: ids.length - new Set(ids).size,
    missingGuid: rows.length - ids.length,
  };
}
export function grouped(rows: Space[], key: "type" | "floor" | "stair") {
  const groups = new Map<string, Space[]>();
  for (const row of rows) {
    const list = groups.get(row[key]) || [];
    list.push(row);
    groups.set(row[key], list);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, "sv", { numeric: true }))
    .map(([label, items]) => ({ label, items, ...stats(items) }));
}
export function csv(rows: Space[]) {
  const safe = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "Kategori",
        "Namn",
        "Long Name",
        "GUID",
        "Plan",
        "Trapphus",
        "Area (m²)",
        "Fil",
      ],
      ...rows.map((r) => [
        r.category,
        r.name,
        r.longName,
        r.guid,
        r.floor,
        r.stair,
        r.area === null ? "" : r.area.toString().replace(".", ","),
        r.file,
      ]),
    ]
      .map((row) => row.map(safe).join(";"))
      .join("\r\n")
  );
}
