import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Dashboard from "../app/dashboard";
import Overview from "../app/overview";
import { categories, normalizeRows } from "../lib/metrics";
test("Dashboard initially presents KPI overview, not object table, with console and model status", () => {
  const html = renderToStaticMarkup(createElement(Dashboard));
  assert.equal((html.match(/class="metric"/g) || []).length, 8);
  assert.ok(html.includes("KPI-översikt"));
  assert.ok(html.includes("API-konsol"));
  assert.ok(html.includes("Synka filter med StreamBIM"));
  assert.ok(!html.includes("<table"));
});
test("Complete data renders three ring charts, stacked bars, normal-plan selector and accessible segment buttons", () => {
  const all = categories.flatMap((c) =>
    normalizeRows(
      [
        {
          GUID: c,
          "Long Name": c === "ROK" ? "2 ROK" : c,
          "Dimensions~Area": c === "LBTA" ? 200 : c === "MBTA" ? 50 : 25,
          "BIP_Läge~Våning": "P9",
          "BIP_Läge~Trapphus": "A",
        },
      ],
      c,
    ),
  );
  const html = renderToStaticMarkup(
    createElement(Overview, {
      all,
      contextRows: all,
      selected: all,
      available: [...categories],
      ready: true,
      focus: null,
      onFocus: () => {},
      normalPlan: "P9",
      setNormalPlan: () => {},
      stair: "",
      plans: ["P9"],
    }),
  );
  assert.equal((html.match(/class="donut"/g) || []).length, 3);
  assert.ok(html.includes("conic-gradient"));
  assert.ok(html.includes("stack-segment"));
  assert.ok(html.includes('aria-label="A, 2 ROK, 1 lägenheter"'));
  assert.ok(html.includes("area-bar"));
  assert.ok(html.includes("P9"));
});
test("Missing new reference categories never render an invented BTA pie", () => {
  const all = normalizeRows(
    [{ "Long Name": "2 ROK", GUID: "a", "Dimensions~Area": 50 }],
    "ROK",
  );
  const html = renderToStaticMarkup(
    createElement(Overview, {
      all,
      contextRows: all,
      selected: all,
      available: ["ROK", "LBTA"],
      ready: true,
      focus: null,
      onFocus: () => {},
      normalPlan: "",
      setNormalPlan: () => {},
      stair: "",
      plans: [],
    }),
  );
  assert.ok(!html.includes("conic-gradient"));
  assert.ok(html.includes("Underlag saknas"));
});
