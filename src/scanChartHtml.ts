/** Self-contained, network-free display. Tool payloads are untrusted data:
 * textContent only; no HTML interpolation, external URLs or executable inputs. */
export const SCAN_CHART_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root {
        color-scheme: light dark;
        font:
          14px/1.5 system-ui,
          sans-serif;
        color: light-dark(#152630, #e6edf3);
        background: light-dark(#fff, #15202a);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 20px;
      }
      h2 {
        font-size: 21px;
        margin: 0 0 6px;
      }
      p {
        margin: 8px 0;
      }
      .muted {
        color: light-dark(#536471, #b3c1cb);
        font-size: 12px;
      }
      .controls {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 18px 0;
      }
      label {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      select,
      button {
        font: inherit;
        padding: 7px;
        border: 1px solid #82919a;
        border-radius: 6px;
        background: transparent;
        color: inherit;
      }
      button {
        cursor: pointer;
      }
      button[aria-pressed="true"] {
        background: #176f86;
        color: white;
      }
      .chart {
        margin: 16px 0;
      }
      .row {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 12px;
        margin: 12px 0;
      }
      .bars {
        min-width: 0;
      }
      .barline {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 25px;
      }
      .bar {
        height: 14px;
        background: #16829a;
        min-width: 1px;
        flex-shrink: 0;
      }
      .ref {
        background: #8696a3;
      }
      .barline span {
        font-size: 12px;
        white-space: nowrap;
      }
      .legend {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        font-size: 12px;
      }
      .swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        background: #16829a;
        margin-right: 5px;
      }
      .swatch.ref {
        background: #8696a3;
      }
      .distribution {
        max-height: 340px;
        overflow: auto;
        border-block: 1px solid #82919a66;
      }
      .distribution .row {
        grid-template-columns: 145px 1fr;
      }
      .note {
        border-left: 3px solid #82919a;
        padding-left: 10px;
      }
      summary {
        cursor: pointer;
        font-weight: 600;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 11px;
      }
      details {
        margin-top: 16px;
      }
      #status {
        padding: 12px 0;
      }
      @media (max-width: 480px) {
        body {
          padding: 12px;
        }
        .row,
        .distribution .row {
          grid-template-columns: 1fr;
          gap: 3px;
        }
        .barline span {
          font-size: 11px;
        }
      }
    </style>
  </head>
  <body>
    <h2>What followed these recorded minutes?</h2>
    <p id="scope" class="muted">Historical evidence from the completed study.</p>
    <p id="status" role="status">
      Waiting for the study result. No computation is started by this display.
    </p>
    <div id="app" hidden>
      <div class="controls">
        <label
          >View horizon
          <select id="horizon" aria-label="Outcome horizon"></select></label
        ><label
          >Move size
          <select id="threshold" aria-label="Closing return threshold">
            <option value="0.01">1%</option>
            <option value="0.02">2%</option>
          </select></label
        >
      </div>
      <p class="muted">
        Display controls use already-computed outcomes. They do not change or rerun your study.
      </p>
      <p id="counts"></p>
      <p id="finding"></p>
      <div class="legend">
        <span><i class="swatch"></i>Matching minutes</span
        ><span><i class="swatch ref"></i>Unconditional same-scope reference</span>
      </div>
      <div class="controls">
        <button id="compare" aria-pressed="true">Compare outcomes</button
        ><button id="distribute" aria-pressed="false">Distribution</button>
      </div>
      <div id="chart" class="chart"></div>
      <p id="chartNote" class="muted"></p>
      <p class="note">
        Adjacent minutes and their forward windows overlap. The reference is unmatched and includes
        the matching minutes. These historical comparisons do not establish a reliable trading
        advantage.
      </p>
      <p id="meter" class="muted"></p>
      <details>
        <summary>Inspect exact study and evidence</summary>
        <pre id="details"></pre>
      </details>
    </div>
    <script>
      (function () {
        "use strict";
        var evidence = null,
          view = "compare",
          pending = new Map(),
          serial = 0;
        var $ = function (id) {
          return document.getElementById(id);
        };
        var obj = function (v) {
          return v && typeof v === "object" && !Array.isArray(v);
        };
        var count = function (v) {
          return Number.isSafeInteger(v) && v >= 0;
        };
        var pct = function (v) {
          return (v * 100).toFixed(1) + "%";
        };
        var fmt = function (v) {
          return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
        };
        function valid(m) {
          return obj(m) && count(m.present) && count(m.absent);
        }
        function say(id, value) {
          $(id).textContent = value;
        }
        function resize() {
          window.parent.postMessage(
            {
              jsonrpc: "2.0",
              method: "ui/notifications/size-changed",
              params: { height: document.documentElement.scrollHeight },
            },
            "*",
          );
        }
        function line(parent, n, d, ref, max) {
          var el = document.createElement("div");
          el.className = "barline";
          if (count(n) && count(d) && n <= d && d > 0) {
            var bar = document.createElement("div");
            bar.className = "bar" + (ref ? " ref" : "");
            bar.style.width = (n / d / max) * 55 + "%";
            el.appendChild(bar);
          }
          var text = document.createElement("span");
          text.textContent =
            count(n) && count(d) && n <= d
              ? fmt(n) + " / " + fmt(d) + (d ? " = " + pct(n / d) : " (rate unavailable)")
              : "Unavailable";
          el.appendChild(text);
          parent.appendChild(el);
        }
        function row(label, a, b, am, bm, max) {
          var row = document.createElement("div");
          row.className = "row";
          var title = document.createElement("div");
          title.textContent = label;
          var bars = document.createElement("div");
          bars.className = "bars";
          line(bars, a, am, false, max);
          line(bars, b, bm, true, max);
          row.append(title, bars);
          $("chart").appendChild(row);
        }
        function rung(m, op, t) {
          return valid(m) && Array.isArray(m.thresholds)
            ? m.thresholds.find(function (r) {
                return (
                  obj(r) &&
                  r.op === op &&
                  r.threshold === t &&
                  count(r.count) &&
                  r.count <= m.present
                );
              })
            : null;
        }
        function bins(m) {
          if (!valid(m) || !Array.isArray(m.buckets) || !m.buckets.length) return null;
          var total = 0;
          for (var b of m.buckets) {
            if (
              !obj(b) ||
              !count(b.count) ||
              !(b.lo === null || Number.isFinite(b.lo)) ||
              !(b.hi === null || Number.isFinite(b.hi)) ||
              (b.lo !== null && b.hi !== null && b.lo >= b.hi)
            )
              return null;
            total += b.count;
          }
          return total === m.present ? m.buckets : null;
        }
        function render() {
          if (!evidence) return;
          var name = $("horizon").value,
            m = evidence.metrics[name],
            b = evidence.referenceMetrics && evidence.referenceMetrics[name],
            t = Number($("threshold").value);
          $("chart").replaceChildren();
          $("chart").className = view === "distribution" ? "chart distribution" : "chart";
          if (!valid(m)) {
            say("finding", "Outcome summary unavailable for this horizon.");
            return;
          }
          var c = evidence.counts || {};
          say(
            "counts",
            fmt(c.total_matching === undefined ? "Unknown" : c.total_matching) +
              " matching minutes / " +
              fmt(c.eligible_symbol_buckets === undefined ? "unknown" : c.eligible_symbol_buckets) +
              " eligible. " +
              fmt(m.present) +
              " outcomes present; " +
              fmt(m.absent) +
              " missing.",
          );
          var excluded = count(c.excluded_symbol_buckets)
            ? fmt(c.excluded_symbol_buckets) + " excluded buckets"
            : "Bucket exclusions unavailable";
          var scope = evidence.referenceScope;
          var scopeText =
            obj(scope) && Array.isArray(scope.symbols)
              ? scope.symbols.join(", ").toUpperCase() +
                " | " +
                String(scope.from) +
                " through " +
                String(scope.to) +
                " | "
              : "";
          say(
            "scope",
            scopeText +
              excluded +
              (count(c.excluded_symbol_days)
                ? "; " + fmt(c.excluded_symbol_days) + " excluded symbol-days."
                : "."),
          );
          var up = rung(m, "gte", t),
            down = rung(m, "lte", -t),
            bu = rung(b, "gte", t),
            bd = rung(b, "lte", -t);
          say(
            "finding",
            m.present === 0
              ? "No available outcomes: a rate cannot be estimated."
              : m.present === 1
                ? "One observation. This cannot establish a pattern."
                : m.present < 30
                  ? "Small sample: one or two observations can materially change these rates."
                  : "Compare both directions below; these are overlapping minute observations, not independent events.",
          );
          if (view === "compare") {
            var vals = [up, down].filter(Boolean).map(function (r) {
              return r.count / m.present;
            });
            if (valid(b) && b.present)
              vals = vals.concat(
                [bu, bd].filter(Boolean).map(function (r) {
                  return r.count / b.present;
                }),
              );
            var max = Math.max(0.01, ...vals.filter(Number.isFinite));
            row(
              "Closed up at least " + pct(t),
              up && up.count,
              bu && bu.count,
              m.present,
              valid(b) ? b.present : null,
              max,
            );
            row(
              "Closed down at least " + pct(t),
              down && down.count,
              bd && bd.count,
              m.present,
              valid(b) ? b.present : null,
              max,
            );
            say(
              "chartNote",
              "Both rows share a zero-based scale. Rates use all present outcomes, not the displayed occurrence page.",
            );
          } else {
            var a = bins(m),
              base = bins(b);
            if (!a) {
              say(
                "chartNote",
                "Complete recorded distribution unavailable. No curve or bins have been estimated.",
              );
            } else {
              var aligned =
                base &&
                base.length === a.length &&
                a.every(function (x, i) {
                  return x.lo === base[i].lo && x.hi === base[i].hi;
                });
              var max = Math.max(
                0.01,
                ...a.map(function (x) {
                  return m.present ? x.count / m.present : 0;
                }),
                ...(aligned
                  ? base.map(function (x) {
                      return b.present ? x.count / b.present : 0;
                    })
                  : []),
              );
              a.forEach(function (x, i) {
                var negative = x.hi !== null && x.hi <= 0;
                var label =
                  (negative ? "(" : "[") +
                  (x.lo === null ? "-∞" : pct(x.lo)) +
                  ", " +
                  (x.hi === null ? "+∞" : pct(x.hi)) +
                  (negative ? "]" : ")");
                row(
                  label,
                  x.count,
                  aligned ? base[i].count : null,
                  m.present,
                  aligned ? b.present : null,
                  max,
                );
              });
              say(
                "chartNote",
                "Recorded return bands, including empty bins and open tails. Bar length is share of outcomes, not probability density; bin widths can differ. " +
                  (aligned
                    ? "Same bin edges for both groups."
                    : "Reference distribution unavailable or bin edges differ."),
              );
            }
          }
          var met = evidence.metering || {};
          say(
            "meter",
            "This result: " +
              (met.cache || "cache status unavailable") +
              "; charged " +
              (met.charged === undefined ? "unknown" : met.charged) +
              " allowance units; remaining " +
              (met.remaining === undefined ? "unknown" : met.remaining) +
              ". Viewing charts makes no request.",
          );
          say(
            "details",
            JSON.stringify(
              {
                definition: evidence.query,
                key: evidence.key,
                counts: evidence.counts,
                coverage: evidence.coverage,
                referenceScope: evidence.referenceScope,
                referenceCounts: evidence.referenceCounts,
                referenceNotes: evidence.referenceNotes,
                metric: name,
                matched: m,
                reference: b,
              },
              null,
              2,
            ),
          );
          resize();
        }
        function receive(result) {
          var data = result && result._meta && result._meta.edgedepthEvidence;
          if (!data && window.openai)
            data =
              window.openai.toolResponseMetadata &&
              window.openai.toolResponseMetadata.edgedepthEvidence;
          if (!obj(data) || !obj(data.metrics)) {
            say(
              "status",
              "Chart data is unavailable in this host. The textual study result remains available.",
            );
            return;
          }
          evidence = data;
          var names = [
            "fwd_ret_30m",
            "fwd_ret_1h",
            "fwd_ret_4h",
            "fwd_ret_24h",
            "fwd_ret_72h",
            "fwd_ret_7d",
          ].filter(function (n) {
            return n in data.metrics;
          });
          $("horizon").replaceChildren();
          names.forEach(function (n) {
            var o = document.createElement("option");
            o.value = n;
            o.textContent = n.replace("fwd_ret_", "");
            $("horizon").appendChild(o);
          });
          if (names.includes("fwd_ret_1h")) $("horizon").value = "fwd_ret_1h";
          $("status").hidden = true;
          $("app").hidden = false;
          render();
        }
        $("horizon").onchange = render;
        $("threshold").onchange = render;
        ["compare", "distribute"].forEach(function (id) {
          $(id).onclick = function () {
            view = id === "compare" ? "compare" : "distribution";
            $("compare").setAttribute("aria-pressed", String(view === "compare"));
            $("distribute").setAttribute("aria-pressed", String(view === "distribution"));
            render();
          };
        });
        document.querySelector("details").addEventListener("toggle", resize);
        window.addEventListener("message", function (event) {
          if (event.source !== window.parent || !obj(event.data) || event.data.jsonrpc !== "2.0")
            return;
          var msg = event.data;
          if (msg.method === "ui/notifications/tool-result") receive(msg.params);
          if (msg.id && pending.has(msg.id)) {
            pending.delete(msg.id);
            window.parent.postMessage(
              { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
              "*",
            );
            resize();
          }
        });
        window.addEventListener("openai:set_globals", function () {
          receive(null);
        });
        var id = ++serial;
        pending.set(id, true);
        window.parent.postMessage(
          {
            jsonrpc: "2.0",
            id: id,
            method: "ui/initialize",
            params: {
              appInfo: { name: "edgedepth-evidence", version: "1.0.0" },
              appCapabilities: {},
              protocolVersion: "2026-01-26",
            },
          },
          "*",
        );
        if (window.openai && window.openai.toolResponseMetadata) receive(null);
      })();
    </script>
  </body>
</html>
`
