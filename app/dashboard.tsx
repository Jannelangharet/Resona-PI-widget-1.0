"use client";
import { useEffect, useRef, useState } from "react";
import {
  categories,
  cell,
  csv,
  defaultMapping,
  stats,
  type Category,
  type Mapping,
  type Space,
} from "../lib/metrics";
import {
  availableCategories,
  datasetKey,
  datasetRows,
  emptyFilters,
  filterRows,
  focusRows,
  kpis,
  type Filters,
  type Focus,
} from "../lib/kpis";
import { connect, fetchDataset, timed, type Dataset } from "../lib/streambim";
import { traced } from "../lib/diagnostics";
import ApiConsole from "./api-console";
import ModelSync from "./model-sync";
import Overview, { format } from "./overview";

export default function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [tab, setTab] = useState("KPI-översikt"),
    [mapping, setMapping] = useState<Mapping>(defaultMapping),
    [draft, setDraft] = useState<Mapping>(defaultMapping);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [focus, setFocus] = useState<Focus | null>(null),
    [normalPlan, setNormalPlan] = useState(""),
    [page, setPage] = useState(0);
  const [expectedRok, setExpectedRok] = useState(""),
    [expectedLbta, setExpectedLbta] = useState(""),
    [referenceAvailable, setReferenceAvailable] = useState(false),
    [embedded, setEmbedded] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    loading = useRef(false),
    generation = useRef(0);
  const all = datasetRows(data, mapping),
    available = availableCategories(data);
  const contextRows = filterRows(all, {
    ...emptyFilters,
    floor: filters.floor,
    stair: filters.stair,
  });
  const selected = filterRows(focusRows(contextRows, focus), filters);
  const summary = kpis(contextRows, available),
    selectionStats = stats(selected);
  const hasSelection = !!(
    focus ||
    filters.category ||
    filters.type ||
    filters.query.trim()
  );
  const pages = Math.ceil(selected.length / 40),
    safePage = Math.min(page, Math.max(0, pages - 1));
  const plans = [...new Set(all.map((r) => r.floor))].sort((a, b) =>
    a.localeCompare(b, "sv", { numeric: true }),
  );
  const stairs = [...new Set(all.map((r) => r.stair))].sort((a, b) =>
    a.localeCompare(b, "sv", { numeric: true }),
  );
  const types = [
    ...new Set(all.filter((r) => r.category === "ROK").map((r) => r.type)),
  ].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  function changeFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }
  function clearSelection() {
    setFocus(null);
    changeFilters({ category: "", type: "", query: "" });
  }
  function chooseFocus(next: Focus) {
    setFocus((current) =>
      JSON.stringify(current) === JSON.stringify(next) ? null : next,
    );
    changeFilters({
      category: "",
      type: "",
      query: "",
      ...(next.floor ? { floor: next.floor } : {}),
      ...(next.stair ? { stair: next.stair } : {}),
    });
  }
  function reset() {
    setFilters(emptyFilters);
    setFocus(null);
    setPage(0);
  }
  async function refresh(nextMapping = mapping) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    setData(null);
    setProgress("Ansluter till aktuellt projekt…");
    const run = ++generation.current;
    try {
      const next = await fetchDataset(
        await connect(),
        nextMapping,
        setProgress,
      );
      if (run === generation.current) {
        setData(next);
        setMapping(nextMapping);
        reset();
        setNormalPlan("");
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
    // Explicit refresh owns subsequent connections and mapping changes.
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
              "Projekt eller byggnad har bytts. Uppdatera för att hämta aktuella data.",
            );
            setExpectedRok("");
            setExpectedLbta("");
          }
        } catch {
          if (active) {
            setData(null);
            setError(
              "Anslutningen har brutits. Uppdatera för att ansluta igen.",
            );
          }
        }
      })();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data]);
  function acceptReference(raw: unknown) {
    const d = raw as Dataset;
    if (
      !d ||
      d.source !== "reference" ||
      !d.projectId ||
      !d.capturedAt ||
      !Array.isArray(d.rok) ||
      !Array.isArray(d.lbta)
    )
      throw new Error(
        "Välj en Resona-referensfil skapad med extract_reference.py.",
      );
    for (const c of categories) {
      const rows = d[datasetKey(c)];
      if (rows === undefined) continue;
      if (
        !Array.isArray(rows) ||
        rows.some(
          (r) =>
            !r ||
            typeof r !== "object" ||
            Array.isArray(r) ||
            !(cell(r, "Long Name") || cell(r, "BIP_Namn~Beskrivning"))
              .toUpperCase()
              .includes(c),
        )
      )
        throw new Error(`Ogiltiga ${c}-objekt i referensfilen.`);
    }
    generation.current++;
    setData(d);
    setMapping(defaultMapping);
    setDraft(defaultMapping);
    setError("");
    reset();
    setNormalPlan("");
  }
  async function localReference() {
    try {
      acceptReference(await (await fetch("/__local-reference.json")).json());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Kunde inte läsa lokal referens.",
      );
    }
  }
  async function showObject(row: Space) {
    try {
      if (data?.source !== "live") return;
      const api = await connect();
      if (
        String(await timed(api.getProjectId())) !== data.projectId ||
        String(await timed(api.getBuildingId())) !== data.buildingId
      )
        throw new Error("Projektet har bytts. Uppdatera först.");
      await traced("StreamBIM.API.gotoObject", { guid: row.guid }, () =>
        timed(api.gotoObject(row.guid)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte visa objektet.");
    }
  }
  function exportCsv() {
    const url = URL.createObjectURL(
        new Blob([csv(selected)], { type: "text/csv;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `resona-urval-${data?.source || "data"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const check = (actual: number, expected: string) =>
    expected === ""
      ? "Inget kontrollvärde"
      : actual === Number(expected)
        ? "Stämmer"
        : `Avvikelse: ${actual - Number(expected)}`;
  const cards = [
    [
      "Lägenheter",
      data ? format(summary.apartments.count) : "—",
      "ROK · antal objektrader",
    ],
    [
      "Medelstorlek",
      data ? format(summary.apartments.mean, 1) : "—",
      `m² · ${summary.apartments.valid} giltiga ROK-areor`,
    ],
    ["BOA", data ? format(summary.boa, 1) : "—", "m² · ROK + LOFT"],
    ["LOA", data ? format(summary.loa, 1) : "—", "m² · LOKAL"],
    ["Total BTA", data ? format(summary.bta, 1) : "—", "m² · LBTA + MBTA"],
    ["Ljus BTA", data ? format(summary.light, 1) : "—", "m² · LBTA"],
    [
      "BOA + LOA",
      data ? format(summary.usable, 1) : "—",
      "m² · bostäder och lokaler",
    ],
    [
      "Yteffektivitet",
      data ? format(summary.efficiency, 1) : "—",
      "% · (BOA + LOA) / ljus BTA",
    ],
  ];
  return (
    <main className="shell">
      <header>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="./brand/resona-logo.svg"
            alt="Resona"
            width="190"
            height="36"
          />
        </div>
        <span className="version">PROJEKTINSIKT / 1.2.1</span>
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
      <div className={`notice ${error ? "warning" : ""}`} role="status">
        <span className="dot" />
        <div>
          <strong>
            {busy
              ? progress
              : error
                ? "Kontrollera anslutningen"
                : data?.source === "live"
                  ? "Ansluten · Aktuella projektdata"
                  : data
                    ? "Referensdata från Power BI · inte live"
                    : "Redo för ditt projekt"}
          </strong>
          <p>
            {error ||
              (data
                ? `${categories.map((c) => `${data[datasetKey(c)]?.length ?? "—"} ${c}`).join(" · ")} · ${new Date(data.capturedAt).toLocaleString("sv-SE")}`
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
          <span>Filen läses lokalt, utan uppladdning.</span>
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
        {["KPI-översikt", "Objektdetaljer", "Datakontroll"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setPage(0);
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="filters">
        <label>
          Våningsplan
          <select
            value={filters.floor}
            onChange={(e) => {
              changeFilters({ floor: e.target.value });
              setFocus(null);
            }}
          >
            <option value="">Alla plan</option>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Trapphus
          <select
            value={filters.stair}
            onChange={(e) => {
              changeFilters({ stair: e.target.value });
              setFocus(null);
            }}
          >
            <option value="">Alla trapphus</option>
            {stairs.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={reset}>
          Återställ alla filter
        </button>
        <span className="filter-count">
          {data
            ? `${contextRows.length} av ${all.length} objektrader i området`
            : "Inväntar data"}
        </span>
      </div>
      <p className="scope-caption">
        Nyckeltalen och ringdiagrammen gäller valt plan/trapphus. Klick i
        diagram avgränsar modellurvalet, staplarna och objektdetaljerna;
        jämförelsevärdena i ringarna ligger kvar.
      </p>
      <section
        className="metrics kpi-metrics"
        aria-label="Projektets nyckeltal"
      >
        {cards.map(([label, value, sub]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </article>
        ))}
      </section>
      {data && stats(contextRows).missing > 0 && (
        <p className="warning-line">
          {stats(contextRows).missing} objektrader saknar giltig area. Berörda
          summor och kvoter visas som —; medelstorleken använder enbart giltiga
          ROK-areor.
        </p>
      )}
      {data && available.length < categories.length && (
        <p className="warning-line">
          Referensen saknar{" "}
          {categories.filter((c) => !available.includes(c)).join(", ")}. Dessa
          KPI:er visas som —, inte som noll. Importera en ny referens eller
          hämta från StreamBIM.
        </p>
      )}
      {summary.efficiency !== null && summary.efficiency > 100 && (
        <p className="warning-line">
          BOA + LOA överstiger ljus BTA. Kontrollera areaklassning och
          modellurval; ingen negativ tårtbit ritas.
        </p>
      )}
      {filters.stair && (
        <p className="scope-caption">
          Trapphusfiltret gäller alla kategorier. Areautrymmen utan detta
          trapphus ingår inte.
        </p>
      )}
      <section className="selection-banner" aria-label="Markerat urval">
        <div>
          <span className="eyebrow">MARKERAT URVAL</span>
          <strong>
            {focus?.label ||
              filters.category ||
              filters.type ||
              (filters.query ? "Sökresultat" : "Alla kategorier i området")}
          </strong>
          <p>
            {data
              ? `${selected.length} objektrader · ${selectionStats.unique} unika GUID`
              : "Anslut för att se urvalet"}
            {filters.query ? ` · söktext: ${filters.query}` : ""}
          </p>
          {focus?.derived && (
            <p>
              Beräknad restarea har inga egna objekt. Modellen och detaljlistan
              visar dess bakomliggande LBTA-utrymmen.
            </p>
          )}
        </div>
        <div>
          {hasSelection && (
            <button onClick={clearSelection}>Rensa diagramval / sökning</button>
          )}
          <button
            onClick={() =>
              setTab(
                tab === "Objektdetaljer" ? "KPI-översikt" : "Objektdetaljer",
              )
            }
          >
            {tab === "Objektdetaljer"
              ? "Till översikten"
              : "Visa objektdetaljer →"}
          </button>
        </div>
      </section>
      {tab === "KPI-översikt" && (
        <Overview
          all={all}
          contextRows={contextRows}
          selected={selected}
          available={available}
          ready={!!data}
          focus={focus}
          onFocus={chooseFocus}
          normalPlan={normalPlan}
          setNormalPlan={setNormalPlan}
          stair={filters.stair}
          plans={plans}
        />
      )}
      <ModelSync
        data={data}
        rows={selected}
        mapping={mapping}
        scope={focus?.label || "Markerat urval"}
      />
      {tab === "Objektdetaljer" && (
        <section className="panel table-panel">
          <div className="section-top">
            <div>
              <p className="eyebrow">SPÅRBARHET</p>
              <h2>Objekten bakom siffrorna.</h2>
            </div>
            <button disabled={!selected.length} onClick={exportCsv}>
              ↓ Exportera CSV
            </button>
          </div>
          <div className="filters">
            <label>
              Kategori
              <select
                value={filters.category}
                onChange={(e) => {
                  setFocus(null);
                  changeFilters({
                    category: e.target.value as Category | "",
                    type: "",
                  });
                }}
              >
                <option value="">Alla kategorier</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Lägenhetstyp
              <select
                value={filters.type}
                onChange={(e) => {
                  setFocus(null);
                  changeFilters({
                    type: e.target.value,
                    category: e.target.value ? "ROK" : "",
                  });
                }}
              >
                <option value="">Alla typer</option>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="search">
              Sök i urvalet
              <input
                value={filters.query}
                onChange={(e) => changeFilters({ query: e.target.value })}
                placeholder="Namn, Long Name, plan eller GUID"
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Objekt / GUID</th>
                  <th>Kategori / Long Name</th>
                  <th>Plan</th>
                  <th>Trapphus</th>
                  <th>Area, m²</th>
                  <th>Modell</th>
                </tr>
              </thead>
              <tbody>
                {selected.slice(safePage * 40, safePage * 40 + 40).map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.name}</strong>
                      <small className="guid">{r.guid || "GUID saknas"}</small>
                    </td>
                    <td>
                      {r.category}
                      <br />
                      {r.longName}
                    </td>
                    <td>{r.floor}</td>
                    <td>{r.stair}</td>
                    <td>{format(r.area, 1)}</td>
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
            {!selected.length && (
              <div className="empty">Inga objekt i urvalet.</div>
            )}
          </div>
          <div className="pagination">
            <span>
              {selected.length} objekt · sida {pages ? safePage + 1 : 0} av{" "}
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
            <p className="eyebrow">DATATÄCKNING · HELA HÄMTNINGEN</p>
            <h2>Riktiga värden. Tydligt underlag.</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th>Rader</th>
                    <th>Unika GUID</th>
                    <th>Saknad area</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => {
                    const s = stats(all.filter((r) => r.category === c));
                    return (
                      <tr key={c}>
                        <th>{c}</th>
                        <td>{available.includes(c) ? s.count : "—"}</td>
                        <td>{available.includes(c) ? s.unique : "—"}</td>
                        <td>{available.includes(c) ? s.missing : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {stats(all).duplicateGuids > 0 && (
              <p className="warning-line">
                Återkommande GUID finns. Objektrader behålls enligt Power BI:s
                #LGH; samma räkneregel används i alla lägenhetsdiagram.
              </p>
            )}
            <p className="hint">
              BOA = ROK + LOFT. LOA = LOKAL. BTA = LBTA + MBTA. Areor följer
              modellens klassning, inte en separat areamätning. Kategorierna
              överlappar fysiskt och ska inte summeras alla tillsammans.
              Parkering ingår inte.
            </p>
          </article>
          <article className="panel">
            <p className="eyebrow">KONTROLLVÄRDEN · VALFRITT</p>
            <h2>Stämmer antalen?</h2>
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
                  {data ? check(data.rok.length, expectedRok) : "Inväntar data"}
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
                  {data
                    ? check(data.lbta.length, expectedLbta)
                    : "Inväntar data"}
                </small>
              </label>
            </div>
            <p className="hint">
              Kontrollvärden ändrar aldrig resultatet och sparas inte mellan
              sessioner.
            </p>
          </article>
          <article className="panel mapping-panel">
            <p className="eyebrow">PROJEKTETS EGENSKAPER</p>
            <h2>Samma widget. Olika modeller.</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                clearSelection();
                if (data?.source === "reference") setMapping(draft);
                else void refresh(draft);
              }}
            >
              {(["area", "floor", "stair"] as const).map((key, i) => (
                <label key={key}>
                  {["Areaegenskap", "Planegenskap", "Trapphusegenskap"][i]}
                  <input
                    required
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Enhet
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
            <p className="hint">
              Live: Space / Spatial zone med Long Name innehållande ROK, LBTA,
              MBTA, LOFT eller LOKAL. Referens: BIP_Namn~Beskrivning när Long
              Name saknas.
            </p>
          </article>
        </section>
      )}
      <ApiConsole />
      <footer>
        <span>RESONA AB · Projektinsikt</span>
        <span>Din modell. Dina data. Utan Power BI.</span>
      </footer>
    </main>
  );
}
