import {
  categories,
  normalizeRows,
  stats,
  type Category,
  type Mapping,
  type Space,
} from "./metrics";
import type { Dataset } from "./streambim";
export const datasetKey = (category: Category) =>
  category.toLowerCase() as "rok" | "lbta" | "mbta" | "loft" | "lokal";
export function datasetRows(data: Dataset | null, mapping: Mapping) {
  return data
    ? categories.flatMap((c) =>
        normalizeRows(
          data[datasetKey(c)] || [],
          c,
          mapping,
          data.source === "reference",
        ),
      )
    : [];
}
export type Filters = {
  floor: string;
  stair: string;
  type: string;
  category: Category | "";
  query: string;
};
export const emptyFilters: Filters = {
  floor: "",
  stair: "",
  type: "",
  category: "",
  query: "",
};
export function filterRows(rows: Space[], f: Filters) {
  const text = f.query.trim().toLocaleLowerCase("sv");
  return rows.filter(
    (r) =>
      (!f.floor || r.floor === f.floor) &&
      (!f.stair || r.stair === f.stair) &&
      (!f.type || (r.category === "ROK" && r.type === f.type)) &&
      (!f.category || r.category === f.category) &&
      (!text ||
        `${r.name} ${r.longName} ${r.guid} ${r.floor} ${r.stair}`
          .toLocaleLowerCase("sv")
          .includes(text)),
  );
}
export function availableCategories(data: Dataset | null): Category[] {
  return data
    ? categories.filter((c) => Array.isArray(data[datasetKey(c)]))
    : [];
}
// A known empty category sums to zero. An absent category or invalid area stays unknown.
export function areaOf(
  rows: Space[],
  wanted: readonly Category[],
  available: readonly Category[],
): number | null {
  if (wanted.some((c) => !available.includes(c))) return null;
  const selected = rows.filter((r) => wanted.includes(r.category));
  if (selected.some((r) => r.area === null)) return null;
  return selected.reduce((sum, r) => sum + r.area!, 0);
}
export function kpis(rows: Space[], available: readonly Category[]) {
  const apartments = stats(rows.filter((r) => r.category === "ROK"));
  const light = areaOf(rows, ["LBTA"], available),
    dark = areaOf(rows, ["MBTA"], available);
  const bta = areaOf(rows, ["LBTA", "MBTA"], available),
    boa = areaOf(rows, ["ROK", "LOFT"], available),
    loa = areaOf(rows, ["LOKAL"], available);
  const usable = areaOf(rows, ["ROK", "LOFT", "LOKAL"], available);
  const remainder = light === null || usable === null ? null : light - usable;
  const efficiency =
    light !== null && light > 0 && usable !== null
      ? (100 * usable) / light
      : null;
  return {
    apartments,
    light,
    dark,
    bta,
    boa,
    loa,
    usable,
    remainder,
    efficiency,
  };
}
// Area categories overlap physically; a derived remainder has no individual GUIDs.
// Selecting it therefore targets its LBTA container spaces, explicitly labelled in the UI.
export type Focus = {
  label: string;
  categories: Category[];
  floor?: string;
  type?: string;
  stair?: string;
  derived?: boolean;
};
export function focusRows(rows: Space[], focus: Focus | null) {
  return focus
    ? rows.filter(
        (r) =>
          focus.categories.includes(r.category) &&
          (!focus.floor || r.floor === focus.floor) &&
          (!focus.type || r.type === focus.type) &&
          (!focus.stair || r.stair === focus.stair),
      )
    : rows;
}
