"use client";
import { useEffect, useRef, useState } from "react";
import {
  cell,
  csv,
  defaultMapping,
  grouped,
  normalizeRows,
  stats,
  type Mapping,
  type Space,
} from "../lib/metrics";
import { connect, fetchDataset, timed, type Dataset } from "../lib/streambim";
import ApiConsole from "./api-console";
import ModelSync from "./model-sync";
import { traced } from "../lib/diagnostics";

const number = (v: number | null, d = 0) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("sv-SE", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(v);
const colors = ["#54665c", "#68827c", "#a4b3ac", "#d1ccc4", "#ffe899"];
export default function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [tab, setTab] = useState("Översikt");
  const [mapping, setMapping] = useState<Mapping>(defaultMapping),
    [draft, setDraft] = useState<Mapping>(defaultMapping),
    [floor, setFloor] = useState(""),
    [stair, setStair] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [category, setCategory] = useState<"ROK" | "LBTA">("ROK");
  const [expectedRok, setExpectedRok] = useState(""),
    [expectedLbta, setExpectedLbta] = useState(""),
    [referenceAvailable, setReferenceAvailable] = useState(false),
    [embedded, setEmbedded] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    loading = useRef(false),
    generation = useRef(0);
  async function refresh(nextMapping = mapping) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    setData(null);
    setProgress("Ansluter till aktuellt projekt…");
    const run = ++generation.current;
    try {
      const api = await connect();
      const next = await fetchDataset(api, nextMapping, setProgress);
      if (run === generation.current) {
        setData(next);
        setMapping(nextMapping);
        setFloor("");
        setStair("");
        setPage(0);
      }
    } catch (e) {
      if (run === generation.current)
        setError(
          e instanceof Error ? e.message : "Kunde inte läsa StreamBIM-data.",
        );
    } finally {
      if (run === generation.current) {
        setBusy(false);
        setProgress("");
      }
      loading.current = false;
    }
  }
  useEffect(() => {
    // Synchronizes the SSR view with the external embedding environment after hydration.
    const frame = window.self !== window.top;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmbedded(frame);
    if (frame) void refresh(defaultMapping);
    else if (["localhost", "127.0.0.1"].includes(window.location.hostname))
      fetch("/__local-reference.json", { method: "HEAD" })
        .then((r) =>
          setReferenceAvailable(
            r.ok &&
              r.headers.get("content-type")?.includes("application/json") ===
                true,
          ),
        )
        .catch(() => {});
    // Connections happen once; each explicit refresh reads the current project again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (data?.source !== "live") return;
    let active = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const api = await connect();
          const pid = String(await timed(api.getProjectId(), 10000)),
            bid = String(await timed(api.getBuildingId(), 10000));
          if (active && (pid !== data.projectId || bid !== data.buildingId)) {
            setData(null);
            setError(
              "Projekt eller byggnad har bytts. Uppdatera för att hämta det nya projektet.",
            );
            setExpectedRok("");
            setExpectedLbta("");
          }
        } catch {
          if (!active) return;
          setData(null);
          setError("Anslutningen har brutits. Uppdatera för att ansluta igen.");
        }
      })();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data]);
  const rok = data
    ? normalizeRows(data.rok, "ROK", mapping, data.source === "reference")
    : [];
  const lbta = data
    ? normalizeRows(data.lbta, "LBTA", mapping, data.source === "reference")
    : [];
  const all = [...rok, ...lbta],
    filtered = all.filter(
      (r) => (!floor || r.floor === floor) && (!stair || r.stair === stair),
    );
  const apartments = filtered.filter((r) => r.category === "ROK"),
    areas = filtered.filter((r) => r.category === "LBTA");
  const a = stats(apartments),
    b = stats(areas),
    totalA = stats(rok),
    totalB = stats(lbta);
  const mix = grouped(apartments, "type"),
    floors = grouped(areas, "floor"),
    stairs = grouped(apartments, "stair");
  const tableRows = filtered.filter(
    (r) =>
      r.category === category &&
      `${r.name} ${r.longName} ${r.guid} ${r.floor} ${r.stair}`
        .toLocaleLowerCase("sv")
        .includes(query.toLocaleLowerCase("sv")),
  );
  const pages = Math.ceil(tableRows.length / 40),
    safePage = Math.min(page, Math.max(0, pages - 1));
  const partial = a.missing + b.missing;
  function acceptReference(raw: unknown) {
    const d = raw as Dataset;
    if (
      !d ||
      !Array.isArray(d.rok) ||
      !Array.isArray(d.lbta) ||
      d.source !== "reference" ||
      !d.projectId ||
      !d.capturedAt
    )
      throw new Error(
        "Välj en Resona-referensfil skapad med extract_reference.py.",
      );
    for (const [rows, word] of [
      [d.rok, "ROK"],
      [d.lbta, "LBTA"],
    ] as const)
      if (
        rows.some(
          (r) =>
            !r ||
            typeof r !== "object" ||
            !(cell(r, "Long Name") || cell(r, "BIP_Namn~Beskrivning"))
              .toUpperCase()
              .includes(word),
        )
      )
        throw new Error("Referensfilen innehåller ogiltiga objekt.");
    generation.current++;
    setData(d);
    setMapping(defaultMapping);
    setDraft(defaultMapping);
    setError("");
    setFloor("");
    setStair("");
    setPage(0);
  }
  async function localReference() {
    try {
      acceptReference(await (await fetch("/__local-reference.json")).json());
    } catch {
      setError("Kunde inte läsa den lokala referensfilen.");
    }
  }
  function exportCsv() {
    const blob = new Blob([csv(tableRows)], { type: "text/csv;charset=utf-8" }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `resona-${category.toLowerCase()}-${data?.source === "reference" ? "referens" : "live"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function showObject(row: Space) {
    try {
      if (data?.source !== "live") return;
      const api = await connect();
      if (
        String(await api.getProjectId()) !== data.projectId ||
        String(await api.getBuildingId()) !== data.buildingId
      )
        throw new Error("Projektet har bytts. Uppdatera först.");
      await traced("StreamBIM.API.gotoObject", { guid: row.guid }, () =>
        timed(api.gotoObject(row.guid)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte visa objektet.");
    }
  }
  const check = (actual: number, expected: string) =>
    expected === ""
      ? "Inget kontrollvärde"
      : actual === Number(expected)
        ? "Stämmer"
        : `Avvikelse: ${actual - Number(expected) > 0 ? "+" : ""}${actual - Number(expected)}`;
  return (
    <main className="shell">
      <header>
        <div className="brand">
          {/* Official supplied brand asset, served locally without third-party tracking. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="./brand/resona-logo.svg"
            alt="Resona"
            width="190"
            height="36"
          />
        </div>
        <span className="version">PROJEKTINSIKT / 1.1</span>
      </header>
      <section className="heading">
        <div>
          <p className="eyebrow">PROJEKTINSIKT · STREAMBIM</p>
          <h1>Modellen i siffror.</h1>
          <p>
            {data
              ? `${data.projectName || `Projekt ${data.projectId}`}${data.buildingId === "not-recorded" ? "" : ` · Byggnad ${data.buildingId}`}`
              : "Lägenheter, ytor och fördelning. Direkt från ditt projekt."}
          </p>
        </div>
        <button disabled={busy} onClick={() => void refresh()}>
          {busy ? "Hämtar…" : "↻ Uppdatera från StreamBIM"}
        </button>
      </section>
      <div
        className={`notice ${error ? "warning" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="dot" />
        <div>
          <strong>
            {busy
              ? progress
              : error
                ? "Kunde inte hämta aktuella data"
                : data?.source === "live"
                  ? "Ansluten · Aktuella projektdata"
                  : data
                    ? "Referensdata från din Power BI-fil · inte live"
                    : "Redo för ditt projekt"}
          </strong>
          <p>
            {error ||
              (data
                ? `${data.rok.length} ROK-objekt · ${data.lbta.length} LBTA-objekt · ${data.source === "reference" ? "Extraherad" : "Hämtad"} ${new Date(data.capturedAt).toLocaleString("sv-SE")}`
                : "Öppna widgeten i StreamBIM för riktiga projektdata. Inga påhittade värden visas.")}
          </p>
        </div>
      </div>
      {!embedded && (
        <div className="reference-actions">
          {referenceAvailable && (
            <button disabled={busy} onClick={() => void localReference()}>
              Visa data från din PBIX-fil
            </button>
          )}
          <button disabled={busy} onClick={() => input.current?.click()}>
            Öppna lokal referensfil
          </button>
          <span>Filen läses bara i din webbläsare, utan uppladdning.</span>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 20_000_000)
                  throw new Error("Filen är för stor (max 20 MB).");
                acceptReference(JSON.parse(await file.text()));
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Ogiltig referensfil.",
                );
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
      )}
      <nav aria-label="Statistikvyer">
        {["Översikt", "Lägenheter", "Areor per plan", "Datakontroll"].map(
          (t) => (
            <button
              key={t}
              aria-current={tab === t ? "page" : undefined}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setPage(0);
                if (t === "Lägenheter") setCategory("ROK");
              }}
            >
              {t}
            </button>
          ),
        )}
      </nav>
      <div className="filters">
        <label>
          Våningsplan
          <select
            value={floor}
            onChange={(e) => {
              setFloor(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Alla plan</option>
            {[...new Set(all.map((r) => r.floor))]
              .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }))
              .map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </label>
        <label>
          Trapphus
          <select
            value={stair}
            onChange={(e) => {
              setStair(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Alla trapphus</option>
            {[...new Set(all.map((r) => r.stair))]
              .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }))
              .map((s) => (
                <option key={s}>{s}</option>
              ))}
          </select>
        </label>
        <button
          className="text-button"
          onClick={() => {
            setFloor("");
            setStair("");
            setQuery("");
            setPage(0);
          }}
        >
          Återställ filter
        </button>
        <span className="filter-count">
          {data
            ? `${filtered.length} av ${all.length} objekt`
            : "Inväntar data"}
        </span>
      </div>
      <ModelSync
        data={data}
        rows={
          tab === "Lägenheter"
            ? tableRows
            : tab === "Areor per plan"
              ? areas
              : filtered
        }
        mapping={mapping}
        scope={
          tab === "Lägenheter"
            ? "Objektlistan"
            : tab === "Areor per plan"
              ? "LBTA per plan"
              : "ROK + LBTA"
        }
      />
      <section className="metrics">
        {[
          [
            "Lägenheter",
            data ? number(a.count) : "—",
            "ROK · antal objektrader",
          ],
          [
            "Lägenhetsarea",
            data ? number(a.area, 1) : "—",
            `${a.missing ? "Delsumma · " : ""}m² · ${mapping.area}, endast ROK`,
          ],
          [
            "Medelarea",
            data ? number(a.mean, 1) : "—",
            `m² · ${a.valid} objekt med giltig area`,
          ],
          [
            "Ljus BTA",
            data ? number(b.area, 1) : "—",
            `${b.missing ? "Delsumma · " : ""}m² · ${b.count} LBTA-utrymmen`,
          ],
        ].map(([label, value, sub]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </article>
        ))}
      </section>
      {data && partial > 0 && (
        <p className="warning-line">
          {partial} objekt saknar giltig area. Areor är delsummor; medelarean
          använder bara giltiga värden.
        </p>
      )}
      {stair && (
        <p className="warning-line">
          Trapphusfiltret gäller även LBTA. Utrymmen utan trapphus ingår inte i
          detta urval.
        </p>
      )}
      {tab === "Översikt" && (
        <>
          <section className="panels">
            <article className="panel">
              <p className="eyebrow">BOSTADSMIX</p>
              <h2>Plats för olika liv.</h2>
              {mix.length ? (
                <>
                  <div
                    className="mix-strip"
                    aria-label="Andel lägenheter per typ"
                  >
                    {mix.map((g, i) => (
                      <span
                        key={g.label}
                        style={{
                          width: `${(g.count / a.count) * 100}%`,
                          background: colors[i % colors.length],
                        }}
                        title={`${g.label}: ${g.count}`}
                      />
                    ))}
                  </div>
                  <div className="mix-legend">
                    {mix.map((g, i) => (
                      <div key={g.label}>
                        <i style={{ background: colors[i % colors.length] }} />
                        <span>{g.label}</span>
                        <b>{g.count}</b>
                        <small>{number((g.count / a.count) * 100, 1)} %</small>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty">
                  {data
                    ? "Inga lägenheter i urvalet."
                    : "Lägenhetsfördelningen visas när projektet är anslutet."}
                </div>
              )}
              <p className="hint">
                Antal ROK-objektrader · samma räknemetod som Power BI:s #LGH
              </p>
            </article>
            <article className="panel">
              <p className="eyebrow">AREAÖVERSIKT</p>
              <h2>Varje plan räknas.</h2>
              {floors.length ? (
                <div className="bars">
                  {floors.map((g) => (
                    <button
                      key={g.label}
                      className="bar-row"
                      onClick={() => {
                        setFloor(g.label);
                        setTab("Areor per plan");
                      }}
                    >
                      <span>{g.label}</span>
                      <span className="bar-track">
                        <i
                          style={{
                            width: `${((g.area || 0) / Math.max(...floors.map((f) => f.area || 0), 1)) * 100}%`,
                          }}
                        />
                      </span>
                      <b>
                        {number(g.area, 0)} <small>m²</small>
                      </b>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  {data
                    ? "Inga LBTA-utrymmen i urvalet."
                    : "LBTA-areor per våningsplan visas här."}
                </div>
              )}
              <p className="hint">
                Ljus BTA · klicka på ett plan för att filtrera
              </p>
            </article>
          </section>
          <article className="panel stair-panel">
            <div>
              <p className="eyebrow">TRAPPHUS</p>
              <h2>Lägenheter, hus för hus.</h2>
            </div>
            <div className="stair-list">
              {stairs.length ? (
                stairs.map((g) => (
                  <button
                    key={g.label}
                    onClick={() => {
                      setStair(g.label);
                      setCategory("ROK");
                      setTab("Lägenheter");
                    }}
                  >
                    <span>{g.label}</span>
                    <strong>{g.count}</strong>
                    <small>{number(g.mean, 1)} m² i snitt</small>
                  </button>
                ))
              ) : (
                <p>Trapphusfördelningen visas när data finns.</p>
              )}
            </div>
          </article>
        </>
      )}
      {tab === "Areor per plan" && (
        <section className="panel table-panel">
          <p className="eyebrow">PLANÖVERSIKT</p>
          <h2>Ljus BTA per våningsplan.</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Våningsplan</th>
                  <th>LBTA-objekt</th>
                  <th>Giltig area</th>
                  <th>Ljus BTA, m²</th>
                </tr>
              </thead>
              <tbody>
                {floors.map((g) => (
                  <tr key={g.label}>
                    <td>{g.label}</td>
                    <td>{g.count}</td>
                    <td>
                      {g.valid} av {g.count}
                    </td>
                    <td>
                      {number(g.area, 1)}
                      {g.missing ? " *" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totalt i urvalet</th>
                  <td>{data ? b.count : "—"}</td>
                  <td>{data ? `${b.valid} av ${b.count}` : "—"}</td>
                  <td>{number(b.area, 1)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="hint">
            LBTA är ljus bruttoarea, inte total BTA. MBTA, LOFT, LOA och
            parkering ingår inte i denna första version. * Delsumma vid saknad
            area.
          </p>
        </section>
      )}
      {tab === "Lägenheter" && (
        <section className="panel table-panel">
          <div className="section-top">
            <div>
              <p className="eyebrow">OBJEKTFÖRTECKNING</p>
              <h2>Från nyckeltal till objekt.</h2>
            </div>
            <button onClick={exportCsv} disabled={!tableRows.length}>
              ↓ Exportera CSV
            </button>
          </div>
          <div className="filters">
            <label>
              Visa
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as "ROK" | "LBTA");
                  setPage(0);
                }}
              >
                <option value="ROK">Lägenheter (ROK)</option>
                <option value="LBTA">LBTA-utrymmen</option>
              </select>
            </label>
            <label className="search">
              Sök objekt
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Namn, typ, plan eller GUID"
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Objekt</th>
                  <th>Typ / Long Name</th>
                  <th>Plan</th>
                  <th>Trapphus</th>
                  <th>Area, m²</th>
                  <th>Modell</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(safePage * 40, safePage * 40 + 40).map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.name}</strong>
                      <small className="guid">{r.guid || "GUID saknas"}</small>
                    </td>
                    <td>{r.longName}</td>
                    <td>{r.floor}</td>
                    <td>{r.stair}</td>
                    <td>{number(r.area, 1)}</td>
                    <td>
                      <button
                        disabled={data?.source !== "live" || !r.guid}
                        onClick={() => void showObject(r)}
                      >
                        Visa ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tableRows.length && (
              <div className="empty">
                {data
                  ? "Inga objekt matchar urvalet."
                  : "Anslut till StreamBIM för att visa objekt."}
              </div>
            )}
          </div>
          <div className="pagination">
            <span>
              {tableRows.length} objekt · sida {pages ? safePage + 1 : 0} av{" "}
              {pages}
            </span>
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Föregående
            </button>
            <button
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              Nästa
            </button>
          </div>
        </section>
      )}
      {tab === "Datakontroll" && (
        <section className="panels">
          <article className="panel">
            <p className="eyebrow">SPÅRBARHET</p>
            <h2>Riktiga värden. Tydligt underlag.</h2>
            <dl className="checks">
              <div>
                <dt>Datakälla</dt>
                <dd>
                  {data?.source === "live"
                    ? "StreamBIM · live"
                    : data
                      ? "PBIX · lokal referens"
                      : "Ingen anslutning"}
                </dd>
              </div>
              <div>
                <dt>ROK: objektrader / unika GUID</dt>
                <dd>{data ? `${totalA.count} / ${totalA.unique}` : "—"}</dd>
              </div>
              <div>
                <dt>LBTA: objektrader / unika GUID</dt>
                <dd>{data ? `${totalB.count} / ${totalB.unique}` : "—"}</dd>
              </div>
              <div>
                <dt>Saknad/ogiltig area, hela urvalet</dt>
                <dd>{data ? totalA.missing + totalB.missing : "—"}</dd>
              </div>
              <div>
                <dt>Saknat GUID</dt>
                <dd>{data ? totalA.missingGuid + totalB.missingGuid : "—"}</dd>
              </div>
            </dl>
            {data && totalA.duplicateGuids + totalB.duplicateGuids > 0 && (
              <p className="warning-line">
                Återkommande GUID finns. Objektrader behålls som i Power BI:s
                #LGH; de tas inte bort automatiskt eftersom samma IFC-GUID kan
                förekomma i flera modeller. Kontrollera källmodellerna innan
                dessa värden används som beslutsunderlag.
              </p>
            )}
            <p className="hint">
              Liveurval: Space eller Spatial zone där Long Name innehåller ROK
              respektive LBTA. PBIX-referensen använder BIP_Namn~Beskrivning
              eftersom Long Name inte ingår i den sparade tabellen.
              Lägenhetsarea är inte hela BOA-måttet i Power BI, som även räknar
              LOFT.
            </p>
          </article>
          <article className="panel">
            <p className="eyebrow">KONTROLLVÄRDEN · VALFRITT</p>
            <h2>Stämmer modellen med förväntan?</h2>
            <p>
              Kontroller gäller hela hämtningen, före plan- och trapphusfilter.
              Värdena ändrar aldrig resultatet.
            </p>
            <div className="control-inputs">
              <label>
                Förväntat antal ROK
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={expectedRok}
                  onChange={(e) => setExpectedRok(e.target.value)}
                />
                <small>
                  {data ? check(totalA.count, expectedRok) : "Inväntar data"}
                </small>
              </label>
              <label>
                Förväntat antal LBTA
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={expectedLbta}
                  onChange={(e) => setExpectedLbta(e.target.value)}
                />
                <small>
                  {data ? check(totalB.count, expectedLbta) : "Inväntar data"}
                </small>
              </label>
            </div>
            <p className="hint">
              Projektoberoende: kontrollvärden lämnas tomma som standard och
              sparas inte mellan sessioner.
            </p>
          </article>
          <article className="panel mapping-panel">
            <p className="eyebrow">PROJEKTETS EGENSKAPER</p>
            <h2>Samma widget. Olika modeller.</h2>
            <p>
              Standardfälten följer Power BI-underlaget. Anpassa vid behov och
              hämta om.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (data?.source === "reference") {
                  setMapping(draft);
                } else void refresh(draft);
              }}
            >
              <label>
                Areaegenskap
                <input
                  required
                  value={draft.area}
                  onChange={(e) => setDraft({ ...draft, area: e.target.value })}
                />
              </label>
              <label>
                Planegenskap
                <input
                  required
                  value={draft.floor}
                  onChange={(e) =>
                    setDraft({ ...draft, floor: e.target.value })
                  }
                />
              </label>
              <label>
                Trapphusegenskap
                <input
                  required
                  value={draft.stair}
                  onChange={(e) =>
                    setDraft({ ...draft, stair: e.target.value })
                  }
                />
              </label>
              <label>
                Enhet för numeriska areavärden
                <select
                  value={draft.unit}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      unit: e.target.value as Mapping["unit"],
                    })
                  }
                >
                  <option value="m2">m²</option>
                  <option value="mm2">mm²</option>
                </select>
              </label>
              <button disabled={busy} type="submit">
                Använd egenskaper
              </button>
            </form>
          </article>
        </section>
      )}
      <ApiConsole />
      <footer>
        <span>RESONA AB · Första version</span>
        <span>Din modell. Dina data. Utan Power BI.</span>
      </footer>
    </main>
  );
}
