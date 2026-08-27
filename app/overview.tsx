"use client";
import { grouped, type Category, type Space } from "../lib/metrics";
import { areaOf, kpis, type Focus } from "../lib/kpis";
export const format = (value: number | null, decimals = 0) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("sv-SE", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      }).format(value);
const palette = ["#54665c", "#68827c", "#a4b3ac", "#d1ccc4", "#d4ae49"];
type Slice = {
  label: string;
  value: number | null;
  color: string;
  focus: Focus;
};
function Ring({
  title,
  eyebrow,
  slices,
  center,
  caption,
  ready,
  focus,
  onFocus,
  children,
}: {
  title: string;
  eyebrow: string;
  slices: Slice[];
  center: string;
  caption: string;
  ready: boolean;
  focus: Focus | null;
  onFocus: (f: Focus) => void;
  children?: React.ReactNode;
}) {
  const valid = ready && slices.every((s) => s.value !== null && s.value >= 0),
    total = slices.reduce((a, s) => a + (s.value || 0), 0);
  const stops = slices.map((s, index) => {
    const from = total
      ? (slices
          .slice(0, index)
          .reduce((sum, item) => sum + (item.value || 0), 0) /
          total) *
        360
      : 0;
    const end = from + (total ? ((s.value || 0) / total) * 360 : 0);
    return `${s.color} ${from}deg ${end}deg`;
  });
  return (
    <article className="panel ring-panel">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
      {valid && total > 0 ? (
        <button
          className="donut"
          style={{ background: `conic-gradient(${stops.join(",")})` }}
          aria-label={`${title}. Klicka på en sektor. Tangentbord: välj med knapparna nedan.`}
          onClick={(e) => {
            if (e.detail === 0) {
              const next = slices.find((s) => (s.value || 0) > 0);
              if (next) onFocus(next.focus);
              return;
            }
            const bounds = e.currentTarget.getBoundingClientRect(),
              x = e.clientX - bounds.left - bounds.width / 2,
              y = e.clientY - bounds.top - bounds.height / 2;
            const radius = Math.hypot(x, y);
            if (radius < bounds.width * 0.325 || radius > bounds.width * 0.5)
              return;
            const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
            let end = 0;
            const slice = slices.find((s) => {
              end += ((s.value || 0) / total) * 360;
              return angle < end;
            });
            if (slice) onFocus(slice.focus);
          }}
        >
          <span className="donut-hole">
            <strong>{center}</strong>
            <small>{caption}</small>
          </span>
        </button>
      ) : (
        <div className="donut-empty">
          <strong>—</strong>
          <span>
            {!ready
              ? "Inväntar projektdata"
              : !valid
                ? "Underlag saknas / kan inte jämföras"
                : "Ingen area i urvalet"}
          </span>
        </div>
      )}
      <div className="ring-legend">
        {slices.map((s) => (
          <button
            key={s.label}
            disabled={!valid || !(s.value! > 0)}
            aria-pressed={
              !!focus && JSON.stringify(focus) === JSON.stringify(s.focus)
            }
            onClick={() => onFocus(s.focus)}
          >
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{ready ? format(s.value, 0) : "—"} m²</b>
            <small>
              {valid && total > 0
                ? `${format((s.value! / total) * 100, 1)} %`
                : "—"}
            </small>
          </button>
        ))}
      </div>
    </article>
  );
}
export default function Overview({
  all,
  contextRows,
  selected,
  available,
  ready,
  focus,
  onFocus,
  normalPlan,
  setNormalPlan,
  stair,
  plans,
}: {
  all: Space[];
  contextRows: Space[];
  selected: Space[];
  available: Category[];
  ready: boolean;
  focus: Focus | null;
  onFocus: (f: Focus) => void;
  normalPlan: string;
  setNormalPlan: (s: string) => void;
  stair: string;
  plans: string[];
}) {
  const p = kpis(contextRows, available),
    normalRows = all.filter(
      (r) => r.floor === normalPlan && (!stair || r.stair === stair),
    ),
    n = kpis(normalRows, available);
  const apartmentRows = selected.filter((r) => r.category === "ROK"),
    mix = grouped(apartmentRows, "type"),
    stairGroups = grouped(apartmentRows, "stair");
  const types = [
    ...new Set(
      contextRows.filter((r) => r.category === "ROK").map((r) => r.type),
    ),
  ].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  const floorGroups = grouped(
    selected.filter((r) => r.category === "LBTA" || r.category === "MBTA"),
    "floor",
  );
  const maxCount = Math.max(1, ...stairGroups.map((g) => g.count));
  const maxArea = Math.max(
    1,
    ...floorGroups.flatMap((g) =>
      ["LBTA", "MBTA"].map(
        (c) => areaOf(g.items, [c as Category], available) || 0,
      ),
    ),
  );
  return (
    <>
      <section className="ring-grid" aria-label="Areakvoter">
        <Ring
          title="Ljus och mörk BTA"
          eyebrow="BRUTTOAREA"
          ready={ready}
          focus={focus}
          onFocus={onFocus}
          center={format(p.bta)}
          caption="m² total BTA"
          slices={[
            {
              label: "Ljus BTA",
              value: p.light,
              color: "#68827c",
              focus: { label: "Ljus BTA", categories: ["LBTA"] },
            },
            {
              label: "Mörk BTA",
              value: p.dark,
              color: "#d1ccc4",
              focus: { label: "Mörk BTA", categories: ["MBTA"] },
            },
          ]}
        />
        <Ring
          title="Ytan som används"
          eyebrow="BOA + LOA / LJUS BTA"
          ready={ready}
          focus={focus}
          onFocus={onFocus}
          center={`${format(p.efficiency, 1)} %`}
          caption="BOA + LOA"
          slices={[
            {
              label: "BOA + LOA",
              value: p.usable,
              color: "#54665c",
              focus: {
                label: "BOA + LOA",
                categories: ["ROK", "LOFT", "LOKAL"],
              },
            },
            {
              label: "Övrig ljus BTA",
              value: p.remainder,
              color: "#d1ccc4",
              focus: {
                label: "Övrig ljus BTA · bakomliggande LBTA",
                categories: ["LBTA"],
                derived: true,
              },
            },
          ]}
        />
        <Ring
          title="Ett normalplan i fokus"
          eyebrow="JÄMFÖRELSE · BOA + LOA / LJUS BTA"
          ready={ready && !!normalPlan}
          focus={focus}
          onFocus={onFocus}
          center={`${format(n.efficiency, 1)} %`}
          caption={normalPlan || "Välj normalplan"}
          slices={[
            {
              label: "BOA + LOA",
              value: n.usable,
              color: "#54665c",
              focus: {
                label: `${normalPlan} · BOA + LOA`,
                categories: ["ROK", "LOFT", "LOKAL"],
                floor: normalPlan,
              },
            },
            {
              label: "Övrig ljus BTA",
              value: n.remainder,
              color: "#d1ccc4",
              focus: {
                label: `${normalPlan} · bakomliggande LBTA`,
                categories: ["LBTA"],
                floor: normalPlan,
                derived: true,
              },
            },
          ]}
        >
          <label className="normal-plan">
            Normalplan
            <select
              value={normalPlan}
              onChange={(e) => setNormalPlan(e.target.value)}
            >
              <option value="">Välj jämförelseplan</option>
              {plans.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        </Ring>
      </section>
      <p className="scope-caption">
        Ringarna visar områdets helhet även när en sektor är markerad.
        Normalplan är ett separat jämförelseplan med samma trapphusfilter. Övrig
        ljus BTA = LBTA − (BOA + LOA).
      </p>
      <section className="panels chart-panels">
        <article className="panel">
          <p className="eyebrow">LÄGENHETER · MARKERAT URVAL</p>
          <h2>Lägenhetsmix per trapphus.</h2>
          <div className="chart-legend">
            {types.map((type, i) => (
              <button
                key={type}
                onClick={() =>
                  onFocus({ label: type, categories: ["ROK"], type })
                }
              >
                <i style={{ background: palette[i % palette.length] }} />
                {type}
              </button>
            ))}
          </div>
          {stairGroups.length ? (
            <div className="stack-chart">
              {stairGroups.map((g) => (
                <div className="stack-row" key={g.label}>
                  <button
                    className="axis-label"
                    onClick={() =>
                      onFocus({
                        label: `Trapphus ${g.label}`,
                        categories: ["ROK"],
                        stair: g.label,
                      })
                    }
                  >
                    {g.label}
                  </button>
                  <div className="stack-track">
                    {types.map((type, i) => {
                      const count = g.items.filter(
                        (r) => r.type === type,
                      ).length;
                      return count ? (
                        <button
                          key={type}
                          className="stack-segment"
                          style={{
                            width: `${(count / maxCount) * 100}%`,
                            background: palette[i % palette.length],
                          }}
                          title={`${g.label} · ${type}: ${count} lägenheter`}
                          aria-label={`${g.label}, ${type}, ${count} lägenheter`}
                          onClick={() =>
                            onFocus({
                              label: `${g.label} · ${type}`,
                              categories: ["ROK"],
                              stair: g.label,
                              type,
                            })
                          }
                        >
                          <span>{count}</span>
                        </button>
                      ) : null;
                    })}
                  </div>
                  <b>{g.count}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              {ready
                ? "Inga ROK-objekt i det markerade urvalet."
                : "Staplarna visas med projektets lägenhetsdata."}
            </div>
          )}
          <div className="mix-summary">
            {mix.map((g) => (
              <button
                key={g.label}
                onClick={() =>
                  onFocus({
                    label: g.label,
                    categories: ["ROK"],
                    type: g.label,
                  })
                }
              >
                <strong>{g.count}</strong>
                <span>{g.label}</span>
                <small>
                  {format(
                    (g.count / Math.max(1, apartmentRows.length)) * 100,
                    1,
                  )}{" "}
                  %
                </small>
              </button>
            ))}
          </div>
          <p className="hint">
            Antal objektrader, samma #LGH-definition i kort och staplar. Klicka
            på en stapeldel för modellurval.
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">AREOR · MARKERAT URVAL</p>
          <h2>BTA genom byggnaden.</h2>
          <div className="chart-legend">
            <span>
              <i style={{ background: "#68827c" }} />
              Ljus BTA
            </span>
            <span>
              <i style={{ background: "#d4ae49" }} />
              Mörk BTA
            </span>
          </div>
          {floorGroups.length ? (
            <div className="area-chart">
              {floorGroups.map((g) => (
                <div className="area-group" key={g.label}>
                  <button
                    className="axis-label"
                    onClick={() =>
                      onFocus({
                        label: `${g.label} · BTA`,
                        categories: ["LBTA", "MBTA"],
                        floor: g.label,
                      })
                    }
                  >
                    {g.label}
                  </button>
                  <div>
                    {(["LBTA", "MBTA"] as const).map((c, i) => {
                      const area = areaOf(g.items, [c], available);
                      return (
                        <button
                          className="area-bar"
                          key={c}
                          disabled={area === null || area === 0}
                          onClick={() =>
                            onFocus({
                              label: `${g.label} · ${c}`,
                              categories: [c],
                              floor: g.label,
                            })
                          }
                          aria-label={`${g.label}, ${c}, ${format(area, 1)} kvadratmeter`}
                        >
                          <span className="area-track">
                            <i
                              style={{
                                width: `${((area || 0) / maxArea) * 100}%`,
                                background: i ? "#d4ae49" : "#68827c",
                              }}
                            />
                          </span>
                          <b>
                            {format(area)} <small>m²</small>
                          </b>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              {ready
                ? "Inga LBTA-/MBTA-objekt i det markerade urvalet."
                : "Jämför ljus och mörk BTA per plan här."}
            </div>
          )}
          <p className="hint">
            Båda serierna har samma skala. Klick på en stapel avgränsar plan och
            kategori utan att byta vy.
          </p>
        </article>
      </section>
    </>
  );
}
