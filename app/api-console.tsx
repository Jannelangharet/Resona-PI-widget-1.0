"use client";
import { useState, useSyncExternalStore } from "react";
import {
  clearLogs,
  getLogs,
  subscribeLogs,
  type ApiLog,
} from "../lib/diagnostics";
const empty: ApiLog[] = [];
export default function ApiConsole() {
  const logs = useSyncExternalStore(subscribeLogs, getLogs, () => empty);
  const [copied, setCopied] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
      setCopied("Kopierat");
    } catch {
      setCopied("Kunde inte kopiera. Markera texten manuellt.");
    }
  }
  return (
    <details className="api-console">
      <summary>
        <span>⌘ API-konsol</span>
        <small>{logs.length} anrop · fäll ut vid behov</small>
      </summary>
      <div className="console-body">
        <div className="console-toolbar">
          <p>
            Exakta sökfrågor och API-anrop. Endast lokalt i denna session, högst
            60 anrop. Känsliga fält maskeras; inga fullständiga objektsvar
            sparas. Frågorna kan innehålla projekt-ID och GUID — dela dem med
            omsorg.
          </p>
          <button onClick={() => void copy()} disabled={!logs.length}>
            Kopiera logg
          </button>
          <button
            onClick={() => {
              clearLogs();
              setCopied("");
            }}
            disabled={!logs.length}
          >
            Rensa
          </button>
        </div>
        <p role="status">{copied}</p>
        {!logs.length ? (
          <p className="console-empty">
            Uppdatera data eller ändra widgetens filter inne i StreamBIM för att
            se anropen här.
          </p>
        ) : (
          <ol className="console-entries">
            {[...logs].reverse().map((log, index) => (
              <li key={log.id}>
                <details open={index === 0 || log.state === "error"}>
                  <summary>
                    <span className={`log-state ${log.state}`}>
                      {log.state === "pending"
                        ? "VÄNTAR"
                        : log.state === "success"
                          ? "OK"
                          : "FEL"}
                    </span>
                    <time>{new Date(log.at).toLocaleTimeString("sv-SE")}</time>
                    <strong>{log.operation}</strong>
                    <small>
                      {log.durationMs !== undefined
                        ? `${log.durationMs} ms`
                        : ""}
                    </small>
                  </summary>
                  <pre>
                    {JSON.stringify(
                      { request: log.request, result: log.summary },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
