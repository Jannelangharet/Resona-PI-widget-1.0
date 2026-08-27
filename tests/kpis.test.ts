import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  categories,
  defaultMapping,
  normalizeRows,
  type Category,
} from "../lib/metrics";
import {
  availableCategories,
  datasetRows,
  emptyFilters,
  filterRows,
  focusRows,
  kpis,
  areaOf,
} from "../lib/kpis";
const row = (c: Category, area: number | null, guid = c) =>
  normalizeRows(
    [
      {
        GUID: guid,
        "Long Name": c === "ROK" ? "2 ROK" : c,
        "Dimensions~Area": area,
        "BIP_Läge~Våning": "P2",
        "BIP_Läge~Trapphus": "A",
      },
    ],
    c,
  )[0];
const rows = [
  row("ROK", 60),
  row("ROK", 40),
  row("LOFT", 5),
  row("LOKAL", 15),
  row("LBTA", 150),
  row("MBTA", 50),
];
test("KPI formulas match report definitions without adding physically overlapping areas", () => {
  const k = kpis(rows, categories);
  assert.equal(k.apartments.count, 2);
  assert.equal(k.apartments.mean, 50);
  assert.equal(k.boa, 105);
  assert.equal(k.loa, 15);
  assert.equal(k.bta, 200);
  assert.equal(k.usable, 120);
  assert.equal(k.remainder, 30);
  assert.equal(k.efficiency, 80);
});
test("Known empty category is zero; missing or invalid data is unknown; denominator zero is not 0% efficiency", () => {
  assert.equal(areaOf([], ["MBTA"], categories), 0);
  assert.equal(areaOf([], ["MBTA"], ["ROK", "LBTA"]), null);
  assert.equal(
    kpis([row("ROK", null), row("LBTA", 100)], categories).boa,
    null,
  );
  assert.equal(kpis([row("ROK", 50)], categories).efficiency, null);
  assert.equal(
    kpis([row("ROK", 150), row("LBTA", 100)], categories).remainder,
    -50,
  );
});
test("Shared selection filters persist independently of view/page; derived remainder uses LBTA containers", () => {
  const selected = filterRows(rows, {
    ...emptyFilters,
    floor: "P2",
    stair: "A",
    category: "ROK",
    query: "2 rok",
  });
  assert.equal(selected.length, 2);
  assert.equal(filterRows(rows, { ...emptyFilters, floor: "other" }).length, 0);
  assert.equal(
    focusRows(rows, {
      label: "2 ROK",
      categories: ["ROK"],
      type: "2 ROK",
      stair: "A",
    }).length,
    2,
  );
  assert.deepEqual(
    focusRows(rows, {
      label: "Övrigt",
      categories: ["LBTA"],
      derived: true,
    }).map((r) => r.category),
    ["LBTA"],
  );
});
test("Legacy reference remains usable but cannot invent new KPI totals", () => {
  const data = {
    rok: [],
    lbta: [],
    source: "reference" as const,
    projectId: "p",
    buildingId: "b",
    capturedAt: "now",
  };
  const available = availableCategories(data);
  assert.deepEqual(available, ["ROK", "LBTA"]);
  assert.equal(kpis(datasetRows(data, defaultMapping), available).bta, null);
});
test(
  "Extended private PBIX reference reconciles new KPI totals",
  { skip: !existsSync("work/reference.json") },
  () => {
    const data = JSON.parse(readFileSync("work/reference.json", "utf8"));
    if (!data.mbta || !data.loft || !data.lokal) return;
    const all = datasetRows(data, defaultMapping),
      k = kpis(all, availableCategories(data));
    assert.equal(k.apartments.count, 308);
    assert.equal(data.mbta.length, 14);
    assert.equal(data.loft.length, 2);
    assert.equal(data.lokal.length, 6);
    assert.ok(Math.abs(k.boa! - 17071.97265313761) < 0.02);
    assert.ok(Math.abs(k.loa! - 334.39) < 0.01);
    assert.ok(Math.abs(k.bta! - 28459.41) < 0.02);
    assert.ok(k.efficiency! > 79 && k.efficiency! < 80);
  },
);
