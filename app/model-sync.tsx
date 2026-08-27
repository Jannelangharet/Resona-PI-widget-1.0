"use client";
import { useEffect, useState } from "react";
import { type Mapping, type Space, stats } from "../lib/metrics";
import { connect, timed, type Dataset } from "../lib/streambim";
import {
  applySelection,
  latestQueue,
  selectionQuery,
  type SelectionQuery,
} from "../lib/selection";
import { errorMessage, traced } from "../lib/diagnostics";
export default function ModelSync({
  data,
  rows,
  mapping,
  scope,
}: {
  data: Dataset | null;
  rows: Space[];
  mapping: Mapping;
  scope: string;
}) {
  const [enabled, setEnabled] = useState(true),
    [retry, setRetry] = useState(0),
    [status, setStatus] = useState({ key: "", state: "idle", text: "" });
  const [zooming, setZooming] = useState(false),
    [zoomError, setZoomError] = useState("");
  const [queue] = useState(latestQueue);
  const projectId = data?.projectId || "",
    buildingId = data?.buildingId || "",
    source = data?.source;
  let queryString = "",
    queryError = "";
  try {
    if (source === "live")
      queryString = JSON.stringify(selectionQuery(rows, buildingId, mapping));
  } catch (e) {
    queryError =
      e instanceof Error ? e.message : "Urvalet kan inte synkroniseras.";
  }
  const expectedString = JSON.stringify(rows.map((r) => ({ guid: r.guid })));
  const syncKey = JSON.stringify([
    projectId,
    buildingId,
    data?.capturedAt,
    queryString,
    retry,
    enabled,
    expectedString,
  ]);
  useEffect(() => {
    const currentQueue = queue;
    currentQueue.invalidate();
    if (source !== "live" || !enabled || queryError) return;
    let active = true;
    const timer = setTimeout(
      () =>
        currentQueue.submit(async (isCurrent) => {
          if (!active || !isCurrent()) return;
          setStatus({
            key: syncKey,
            state: "pending",
            text: "Synkroniserar urvalet…",
          });
          const slow = setTimeout(() => {
            if (active && isCurrent())
              setStatus({
                key: syncKey,
                state: "pending",
                text: "StreamBIM svarar långsamt. Nästa filter väntar tills anropet är klart.",
              });
          }, 15000);
          try {
            const api = await connect();
            const applied = await applySelection(
              api,
              projectId,
              buildingId,
              JSON.parse(queryString) as SelectionQuery,
              () => active && isCurrent(),
              JSON.parse(expectedString) as Space[],
            );
            if (active && isCurrent() && applied)
              setStatus({
                key: syncKey,
                state: "success",
                text: `Utrymmessökning skickad · ${applied.matchedRows} objektrader verifierade före applicering`,
              });
          } catch (e) {
            if (active && isCurrent())
              setStatus({
                key: syncKey,
                state: "error",
                text: `${errorMessage(e)} Modellfiltret kunde inte bekräftas. Se API-konsolen.`,
              });
          } finally {
            clearTimeout(slow);
          }
        }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
      currentQueue.invalidate();
    };
  }, [
    source,
    enabled,
    projectId,
    buildingId,
    queryString,
    queryError,
    syncKey,
    queue,
    expectedString,
  ]);
  const live = source === "live",
    current = status.key === syncKey;
  const state =
    !live || !enabled
      ? "idle"
      : queryError
        ? "error"
        : current
          ? status.state
          : "pending";
  const message = !live
    ? "Aktiveras när widgeten är ansluten till StreamBIM."
    : !enabled
      ? "Pausad. StreamBIM behåller sitt senaste urval; ett redan skickat anrop kan slutföras."
      : queryError ||
        (current ? status.text : "Väntar på senaste filtervalet…");
  async function zoom() {
    setZooming(true);
    setZoomError("");
    try {
      const api = await connect();
      if (
        String(await timed(api.getProjectId())) !== projectId ||
        String(await timed(api.getBuildingId())) !== buildingId
      )
        throw new Error("Projektet har bytts. Uppdatera data först.");
      if (!api.zoomToSearchResult)
        throw new Error("Zoomning stöds inte av denna StreamBIM-version.");
      await traced("StreamBIM.API.zoomToSearchResult", {}, () =>
        timed(api.zoomToSearchResult!()),
      );
    } catch (e) {
      setZoomError(
        e instanceof Error ? e.message : "Kunde inte zooma till urvalet.",
      );
    } finally {
      setZooming(false);
    }
  }
  return (
    <section
      className={`model-sync ${state}`}
      aria-label="Filterkoppling till StreamBIM"
    >
      <div className="sync-top">
        <label className="sync-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setRetry((v) => v + 1);
            }}
          />
          Synka filter med StreamBIM
        </label>
        <span>
          {live
            ? `${rows.length} objektrader · ${stats(rows).unique} unika GUID · ${scope}`
            : "Ingen modell ändras i referensläge"}
        </span>
        <button
          disabled={
            !live || !enabled || state !== "success" || zooming || !rows.length
          }
          onClick={() => void zoom()}
        >
          Visa hela urvalet ↗
        </button>
        {state === "error" && !queryError && (
          <button onClick={() => setRetry((v) => v + 1)}>Försök igen</button>
        )}
      </div>
      <p role="status">{message}</p>
      {zoomError && <p role="alert">{zoomError}</p>}
      <p className="sync-note">
        Hela det markerade urvalet synkas, oberoende av sidindelning och vald
        flik. Filtreringen ersätter StreamBIMs aktiva sökning, utan att flytta
        kameran. Klippning kan begränsa modellens sökresultat. Återställ filter
        visar hela widgeturvalet igen. Återanvända GUID i olika modeller kan
        inte alltid särskiljas; jämför även objektrader och egenskaper.
      </p>
    </section>
  );
}
