/** Network-free payoff view. Tool data is untrusted: textContent only, never
 * HTML, URLs, storage or follow-up requests. Wording derives from counts. */
export const TRADE_PAYOFF_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    color-scheme: light dark;
    font: 14px/1.5 system-ui, sans-serif;
    --ink: light-dark(#152630, #ecf0ef);
    --muted: light-dark(#536471, #a0ada8);
    --surface: light-dark(#fff, #11161d);
    --line: light-dark(#ced6d2, #66736e);
    --accent: light-dark(#15765b, #4ddbac);
    --loss: light-dark(#b0482a, #f29a7a);
    color: var(--ink); background: var(--surface);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; }
  h2 { font-size: 19px; line-height: 1.4; margin: 0 0 8px; font-weight: 650; }
  h3 { font-size: 15px; margin: 18px 0 8px; }
  p { margin: 8px 0; }
  .muted, small { color: var(--muted); font-size: 12px; }
  .num { font-variant-numeric: tabular-nums; }
  #scope, #question, #rules, #status { overflow-wrap: anywhere; }
  #answer { border-left: 3px solid var(--accent); background: light-dark(#edf7f2, #16281f); padding: 12px 14px; margin: 16px 0; }
  #answer.negative { border-color: var(--loss); background: light-dark(#fbf0ec, #2a1a15); }
  #answerTitle { margin: 0; font-size: 12px; color: var(--muted); font-weight: 500; }
  #headline { font-size: 18px; font-weight: 650; line-height: 1.45; margin: 4px 0 6px; }
  #headlineCounts { margin: 0; }
  #compare { display: grid; grid-template-columns: 9em 1fr 1fr; gap: 8px 12px; align-items: center; font-size: 13px; }
  #compare .head { font-weight: 600; }
  .cell { display: grid; gap: 3px; min-width: 0; }
  .track { height: 12px; background: light-dark(#eef2f0, #1b2229); border-radius: 2px; }
  .fill { display: block; height: 100%; min-width: 2px; background: var(--accent); border-radius: 2px; }
  .fill.loss { background: var(--loss); }
  #excluded { border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; }
  summary { cursor: pointer; font-size: 12px; }
  details { margin-top: 12px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
  [hidden] { display: none !important; }
  @media (max-width: 480px) {
    body { padding: 12px; }
    h2 { font-size: 17px; }
    #compare { grid-template-columns: 1fr 1fr; }
    #compare .label { grid-column: 1 / -1; margin-top: 4px; }
    #compare .corner { display: none; }
  }
</style>
</head>
<body>
<h2 id="title">Trade test result</h2>
<p id="scope" class="muted"></p>
<p id="status" role="status">Waiting for the trade test result.</p>
<div id="app" hidden>
  <p id="question" class="muted"></p>
  <p id="rules" class="muted num"></p>
  <section id="answer" aria-labelledby="answerTitle">
    <h3 id="answerTitle">Did it pay after fees and slippage?</h3>
    <p id="headline" class="num"></p>
    <p id="headlineCounts" class="num"></p>
  </section>
  <h3>Wins against losses</h3>
  <div id="compare" class="num"></div>
  <p id="largest" class="num"></p>
  <p id="exits" class="muted num"></p>
  <p id="coverage" class="muted num"></p>
  <p id="excluded"></p>
  <details><summary>Exact rules, engine notes and receipts</summary><p id="meter" class="muted"></p><pre id="details"></pre></details>
</div>
<script>
(function () {
  "use strict";
  var pending = new Map(), serial = 0;
  var $ = function (id) { return document.getElementById(id); };
  var obj = function (v) { return v && typeof v === "object" && !Array.isArray(v); };
  var count = function (v) { return Number.isSafeInteger(v) && v >= 0; };
  var finite = function (v) { return typeof v === "number" && Number.isFinite(v); };
  var fmt = function (v) { return count(v) ? v.toLocaleString("en-US") : "unknown"; };
  var signed = function (v) { return (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v * 100).toFixed(2) + "%"; };
  var plain = function (v) { return Number((v * 100).toFixed(8)) + "%"; };
  var exits = { time: "at the time limit", stop: "at the stop (initial or trailing)", target: "at the target" };
  function say(id, text) { $(id).textContent = text; }
  function el(tag, text, className) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }
  function resize() {
    window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed",
      params: { height: document.body.scrollHeight } }, "*");
  }
  function rulesLine(r) {
    if (!obj(r)) return "";
    return [r.direction === "short" ? "Short" : r.direction === "long" ? "Long" : "Direction unknown",
      "enter at the next minute's open",
      finite(r.stop_fraction) ? plain(r.stop_fraction) + " stop" : "stop unknown",
      finite(r.target_fraction) && r.target_fraction > 0 ? plain(r.target_fraction) + " target" : "no fixed target",
      finite(r.trail_fraction) && r.trail_fraction > 0 ? plain(r.trail_fraction) + " trailing stop from closes" : "no trailing stop",
      "hold up to " + fmt(r.max_hold_minutes) + " minutes",
      (finite(r.fee_bps_per_side) ? r.fee_bps_per_side : "?") + " bps fee + " + (finite(r.slippage_bps_per_side) ? r.slippage_bps_per_side : "?") + " bps slippage per side",
      r.overlap === "skip_until_exit" ? "one trade per market at a time" : r.overlap === "independent_events" ? "overlapping trades allowed" : "overlap unknown"].join(" · ");
  }
  // Paired bars, one scale per row: wins beside losses, exact values beside bars.
  function compare(s) {
    $("compare").replaceChildren();
    ["", "Wins", "Losses"].forEach(function (text, i) { $("compare").appendChild(el("span", text, i ? "head" : "head corner")); });
    var rows = [["How many", s.wins, s.losses, function (v) { return fmt(v); }]];
    if (finite(s.average_win) && finite(s.average_loss)) {
      rows.push(["Average size", s.average_win, s.average_loss, signed]);
      rows.push(["All added up", s.wins * s.average_win, s.losses * s.average_loss, signed]);
    }
    rows.forEach(function (row) {
      var max = Math.max(Math.abs(row[1]), Math.abs(row[2]));
      $("compare").appendChild(el("span", row[0], "label"));
      [row[1], row[2]].forEach(function (v, i) {
        var cell = el("span", undefined, "cell"), track = el("span", undefined, "track");
        track.setAttribute("aria-hidden", "true");
        if (max > 0 && v !== 0) { var fill = el("span", undefined, "fill" + (i ? " loss" : "")); fill.style.width = (Math.abs(v) / max * 100) + "%"; track.appendChild(fill); }
        cell.appendChild(track); cell.appendChild(el("span", row[3](v))); $("compare").appendChild(cell);
      });
    });
  }
  function show(data) {
    var s = data.summary, e = s.expectancy_after_fees_slippage, r = data.rules || {};
    say("title", "Trade test: " + (r.direction === "short" ? "short" : r.direction === "long" ? "long" : "stated direction") + " after the setup");
    say("scope", data.heading && data.heading.scope || "");
    say("question", data.question ? "Question: " + data.question : "Setup: " + (data.heading && data.heading.title || "unknown"));
    say("rules", rulesLine(data.rules));
    var none = !count(s.completed) || s.completed === 0 || !finite(e);
    $("answer").className = !none && e < 0 ? "negative" : "";
    say("headline", none ? "No completed trades, so the payoff is unknown."
      : (s.completed < 30 ? "Too few completed trades to judge. " : "")
        + (e < 0 ? "It did not pay: " + signed(e) + " per trade on average after fees and slippage."
          : e > 0 ? "It paid on these past trades: " + signed(e) + " per trade on average after fees and slippage, before funding."
          : "It broke even on average after fees and slippage."));
    say("headlineCounts", none ? fmt(s.signals) + " signals." : fmt(s.completed) + " completed trades: " + fmt(s.wins) + " wins, " + fmt(s.losses) + " losses"
      + (count(s.flat) && s.flat > 0 ? ", " + fmt(s.flat) + " flat" : "") + (finite(s.win_rate) ? " (" + (s.win_rate * 100).toFixed(1) + "% won)." : "."));
    compare(s);
    var w = data.largestWin;
    say("largest", obj(w) && finite(w.return) && finite(w.share_of_gross_profit) ? "Largest win: " + signed(w.return) + (typeof w.symbol === "string" ? " on " + w.symbol.toUpperCase() : "")
      + ", " + (w.share_of_gross_profit * 100).toFixed(1) + "% of all winning trades' profit." : "");
    say("exits", obj(data.exits) ? "How trades ended: " + Object.keys(data.exits).sort(function (a, b) { return data.exits[b] - data.exits[a]; })
      .map(function (k) { return fmt(data.exits[k]) + " " + (exits[k] || k); }).join(", ") + "." : "");
    say("coverage", fmt(s.signals) + " signals: " + fmt(s.completed) + " completed, " + fmt(s.missing) + " unavailable (missing prices), "
      + fmt(s.overlap_skipped) + " skipped while the same market had a trade open.");
    say("excluded", "Not included: funding payments. Holds are capped at 1,440 minutes (24h), so moves that ran for days cannot be tested here. "
      + "Each trade is one unit of entry money, not a portfolio or leverage. Past trades, not a forecast.");
    var met = data.metering || {};
    say("meter", "Cache: " + (met.cache || "unknown") + "; charged " + (met.charged === undefined ? "unknown" : met.charged) + " allowance units; remaining " + (met.remaining === undefined ? "unknown" : met.remaining) + ". Viewing makes no request.");
    say("details", JSON.stringify({ rules: data.rules, summary: data.summary, notes: data.notes, key: data.key }, null, 2));
  }
  function receive(result) {
    $("app").hidden = true; $("status").hidden = false;
    say("title", "Trade test result"); say("scope", "");
    var data = result && result._meta && result._meta.edgedepthTrade;
    if (!result && window.openai) data = window.openai.toolResponseMetadata && window.openai.toolResponseMetadata.edgedepthTrade;
    if (obj(data) && data.state === "error") {
      say("title", data.status === 422 ? "The engine rejected these rules" : "The trade test could not complete");
      say("status", (data.status ? "HTTP " + data.status + " · " : "") + ((Array.isArray(data.errors) ? data.errors : []).map(function (e) {
        return obj(e) ? e.code + ": " + e.message : String(e);
      }).join("\n") || "The request failed."));
    } else if (obj(data) && data.state === "not_modified") {
      say("status", "The cached trade test is unchanged (304). Request it without If-None-Match to view the result.");
    } else if (!obj(data) || data.state !== "ready" || !obj(data.summary)) {
      say("status", data ? "The trade test returned no payoff summary. Read the textual result."
        : "This host did not provide payoff evidence. The textual trade result remains available.");
    } else {
      show(data); $("status").hidden = true; $("app").hidden = false;
    }
    resize();
  }
  document.querySelectorAll("details").forEach(function (d) { d.addEventListener("toggle", resize); });
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || !obj(event.data) || event.data.jsonrpc !== "2.0") return;
    var msg = event.data;
    if (msg.method === "ui/notifications/tool-result") receive(msg.params);
    if (msg.id && pending.has(msg.id)) {
      pending.delete(msg.id);
      window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, "*"); resize();
    }
  });
  window.addEventListener("openai:set_globals", function () { receive(null); });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(document.body);
  var id = ++serial; pending.set(id, true);
  window.parent.postMessage({ jsonrpc: "2.0", id: id, method: "ui/initialize", params: {
    appInfo: { name: "edgedepth-payoff", version: "1.0.0" }, appCapabilities: {}, protocolVersion: "2026-01-26"
  } }, "*");
  if (window.openai && window.openai.toolResponseMetadata) receive(null);
})();
</script>
</body>
</html>`
