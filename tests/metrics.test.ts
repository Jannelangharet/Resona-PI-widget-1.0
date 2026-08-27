import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  parseArea,
  normalizeRows,
  stats,
  grouped,
  csv,
  defaultMapping,
} from "../lib/metrics";
test("Swedish decimals, units and invalid areas", () => {
  assert.equal(parseArea("1 234,5 m²"), 1234.5);
  assert.equal(parseArea("1.234,50"), 1234.5);
  assert.equal(parseArea("1,234.50"), 1234.5);
  assert.equal(parseArea("55000000 mm²"), 55);
  assert.equal(parseArea(55000000, "mm2"), 55);
  for (const value of [
    null,
    undefined,
    "",
    " ",
    0,
    -1,
    "foo",
    "12 square feet",
    "NaN",
    "Infinity",
    "1,2,3",
  ])
    assert.equal(parseArea(value), null);
});
test("No area fabrication; row counts and duplicate GUIDs stay explicit", () => {
  const rows = normalizeRows(
    [
      { GUID: "A", "Long Name": "2 ROK", "Dimensions~Area": "50,5" },
      { GUID: "A", "Long Name": "2 ROK", "Dimensions~Area": null },
      { GUID: "B", "Long Name": "1 ROK", "Dimensions~Area": 30 },
    ],
    "ROK",
  );
  assert.deepEqual(stats(rows), {
    count: 3,
    area: 80.5,
    mean: 40.25,
    valid: 2,
    missing: 1,
    unique: 2,
    duplicateGuids: 1,
    missingGuid: 0,
  });
  assert.equal(grouped(rows, "type")[1].count, 2);
  assert.equal(stats([]).area, null);
  assert.equal(stats([]).mean, null);
});
test("BIP fallback is reference only; custom field mapping is honored", () => {
  const raw = [
    {
      "BIP_Namn~Beskrivning": "3 ROK",
      customArea: 60,
      level: "P2",
      stair: "B",
    },
  ];
  assert.equal(normalizeRows(raw, "ROK")[0].longName, "");
  const row = normalizeRows(
    raw,
    "ROK",
    { area: "customArea", floor: "level", stair: "stair", unit: "m2" },
    true,
  )[0];
  assert.equal(row.type, "3 ROK");
  assert.equal(row.area, 60);
  assert.equal(row.floor, "P2");
  assert.equal(row.stair, "B");
});
test("CSV neutralizes formulas and quotes", () => {
  const rows = normalizeRows(
    [{ Name: "=1+1", "Long Name": "1 ROK", GUID: "test" }],
    "ROK",
  );
  assert.match(csv(rows), /"'=1\+1"/);
});
test(
  "Private PBIX extraction reconciles to original measures",
  { skip: !existsSync("work/reference.json") },
  () => {
    const d = JSON.parse(readFileSync("work/reference.json", "utf8"));
    const a = stats(normalizeRows(d.rok, "ROK", defaultMapping, true)),
      b = stats(normalizeRows(d.lbta, "LBTA", defaultMapping, true));
    assert.equal(a.count, 308);
    assert.equal(a.unique, 303);
    assert.equal(b.count, 59);
    assert.equal(b.unique, 56);
    assert.ok(Math.abs(a.area! - 17024.155533137608) < 1e-7);
    assert.ok(Math.abs(b.area! - 21934.748652045593) < 1e-7);
  },
);
