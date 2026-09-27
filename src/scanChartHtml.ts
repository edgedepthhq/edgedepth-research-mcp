/** Network-free display. Tool data is untrusted: textContent only, never HTML,
 * URLs, executable inputs, storage, or follow-up research requests. */
export const SCAN_CHART_HTML = String.raw`<!doctype html>
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
    --reference: light-dark(#566974, #9daaa5);
    color: var(--ink); background: var(--surface);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; }
  h2 { font-size: 19px; line-height: 1.4; margin: 0 0 8px; font-weight: 650; }
  h3 { font-size: 15px; margin: 20px 0 8px; }
  p { margin: 8px 0; }
  .muted, small { color: var(--muted); font-size: 12px; }
  .num, table, #binReading { font-variant-numeric: tabular-nums; }
  #stats { font-weight: 650; }
  #scope, #status, #title { overflow-wrap: anywhere; }
  .controls { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0 8px; }
  label { display: flex; align-items: center; gap: 6px; }
  select, button { font: inherit; color: inherit; background: var(--surface); }
  select, #resetOutcome { border: 1px solid var(--line); padding: 5px; border-radius: 4px; max-width: 100%; }
  #resetOutcome { cursor: pointer; }
  #resetOutcome:hover { border-color: var(--accent); }
  #glance { border-left: 3px solid var(--accent); background: light-dark(#edf7f2, #16281f); padding: 12px 14px; margin: 16px 0; }
  #glanceTitle { margin: 0; font-size: 12px; color: var(--muted); font-weight: 500; }
  #glanceAnswer { font-size: 17px; font-weight: 600; line-height: 1.5; }
  #glanceComparison { font-size: 13px; }
  #glanceCaveat { margin-bottom: 0; }
  option { color: var(--ink); background: var(--surface); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #outcomes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 14px 0; }
  .outcome { border-top: 2px solid var(--line); padding-top: 8px; min-width: 0; }
  .outcome.chosen { border-color: var(--accent); }
  .outcome strong { display: block; font-size: 18px; margin: 4px 0; }
  .outcome small { display: block; }
  #referenceNote { border-left: 2px solid var(--line); padding-left: 10px; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; }
  .swatch { display: inline-block; width: 11px; height: 11px; background: var(--accent); margin-right: 5px; }
  .swatch.ref { background: transparent; border: 2px solid var(--reference); }
  #histogram { display: grid; height: 155px; gap: 2px; border-bottom: 1px solid var(--line); margin-top: 12px; }
  .bin { position: relative; border: 0; padding: 0; cursor: pointer; min-width: 0; background: transparent; }
  .bin[aria-pressed="true"] { background: light-dark(#eaf4f0, #203c31); box-shadow: inset 0 -2px var(--accent); }
  .bin:focus-visible { outline-offset: -2px; }
  .bin[aria-pressed="true"] .bar:not(.ref) { background: light-dark(#095a43, #96f0d1); }
  .bin[aria-pressed="true"] .bar.ref { border-color: var(--ink); }
  .bin.zero { border-left: 1px dashed var(--line); }
  .bar { position: absolute; bottom: 0; left: 18%; width: 64%; background: var(--accent); pointer-events: none; }
  .bar.ref { left: 0; width: 100%; background: transparent; border: 1px solid var(--reference); }
  .axis { position: relative; height: 20px; color: var(--muted); font-size: 12px; }
  .axis span { position: absolute; transform: translateX(-50%); }
  #binReading { min-height: 4.5em; font-size: 12px; padding: 8px 10px; border-left: 2px solid var(--accent); background: light-dark(#eaf4f0, #16281f); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 7px 5px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; }
  tr.selected { background: light-dark(#edf7f2, #1b3028); }
  summary { cursor: pointer; font-size: 12px; }
  details { margin-top: 12px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
  [hidden] { display: none !important; }
  @media (max-width: 480px) {
    body { padding: 12px; }
    h2 { font-size: 17px; }
    #outcomes { grid-template-columns: 1fr; gap: 10px; }
    #histogram { gap: 1px; }
    th, td { padding: 6px 3px; }
  }
</style>
</head>
<body>
<h2 id="title">Study result</h2>
<p id="scope" class="muted"></p>
<p id="stats" class="num"></p>
<p id="status" role="status">Waiting for the study result.</p>
<div id="app" hidden>
  <p id="question" class="muted"></p>
  <section id="glance" aria-labelledby="glanceTitle">
    <h3 id="glanceTitle">Result at a glance</h3>
    <p id="glanceAnswer" class="num" aria-live="polite" aria-atomic="true"></p>
    <p id="glanceComparison" class="num"></p>
    <p id="glanceCaveat" class="muted"></p>
  </section>
  <div class="controls">
    <label id="groupLabel" hidden>Group <select id="group"></select></label>
    <label>Horizon <select id="horizon" aria-label="Outcome horizon"></select></label>
    <label>Move <select id="threshold" aria-label="Move size"></select></label>
    <button id="resetOutcome" type="button" hidden>Return to stated outcome</button>
  </div>
  <p id="defaultNote" class="muted"></p>
  <details id="outcomeDetails">
    <summary>Both directions and reference counts</summary>
    <div id="outcomes" class="num"></div>
    <p id="referenceNote" class="muted"></p>
  </details>
  <h3 id="distributionTitle">Closing-return distribution</h3>
  <p id="counts" class="muted num"></p>
  <div class="legend">
    <span><i class="swatch"></i><span id="matchedLegend">Matching occurrences</span></span>
    <span id="referenceLegend"><i class="swatch ref"></i><span id="referenceLabel"></span></span>
  </div>
  <div id="histogram" role="group" aria-label="Recorded return buckets"></div>
  <div class="axis" id="axis" aria-label="Closing return band boundaries"></div>
  <p id="binReading" aria-live="polite" aria-atomic="true"></p>
  <p id="chartNote" class="muted"></p>
  <details><summary>Every return bucket, with exact counts</summary><table id="buckets"></table></details>
  <h3 id="ladderTitle">How far it ran / how far it fell</h3>
  <table id="ladder"></table>
  <p id="pathCounts" class="muted num"></p>
  <p id="limitations" class="muted"></p>
  <details><summary>Study definition, coverage and evidence</summary>
    <p id="coverage" class="muted num"></p><p id="meter" class="muted"></p><pre id="details"></pre>
  </details>
</div>
<script>
(function () {
  "use strict";
  var evidence = null, pending = new Map(), serial = 0;
  var $ = function (id) { return document.getElementById(id); };
  var obj = function (v) { return v && typeof v === "object" && !Array.isArray(v); };
  var count = function (v) { return Number.isSafeInteger(v) && v >= 0; };
  var fmt = function (v) { return count(v) ? v.toLocaleString("en-US") : "unknown"; };
  var pct = function (v) { return Number((v * 100).toFixed(8)) + "%"; };
  var valid = function (m) { return obj(m) && count(m.present) && count(m.absent); };
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
  function percent(n, d) {
    return n > 0 && n / d < 0.001 ? "<0.1%" : (n / d * 100).toFixed(1) + "%";
  }
  function rate(n, d) {
    if (!count(n) || !count(d) || n > d) return "Exact count unavailable";
    return fmt(n) + " / " + fmt(d) + (d ? " = " + percent(n, d) : " (no rate)");
  }
  function rung(m, op, t) {
    return valid(m) && Array.isArray(m.thresholds) ? m.thresholds.find(function (r) {
      return obj(r) && r.op === op && r.threshold === t && count(r.count) && r.count <= m.present;
    }) : null;
  }
  function bins(m) {
    if (!valid(m) || !Array.isArray(m.buckets) || !m.buckets.length) return null;
    var total = 0;
    for (var b of m.buckets) {
      if (!obj(b) || !count(b.count) || !(b.lo === null || Number.isFinite(b.lo)) ||
          !(b.hi === null || Number.isFinite(b.hi)) || (b.lo !== null && b.hi !== null && b.lo >= b.hi)) return null;
      total += b.count;
    }
    return total === m.present ? m.buckets : null;
  }
  function band(b) {
    var negative = b.hi !== null && b.hi <= 0;
    return (negative ? "(" : "[") + (b.lo === null ? "-∞" : pct(b.lo)) + ", " +
      (b.hi === null ? "+∞" : pct(b.hi)) + (negative ? "]" : ")");
  }
  function options(id, entries, value) {
    $(id).replaceChildren();
    entries.forEach(function (entry) {
      var option = el("option", entry[1]); option.value = entry[0]; $(id).appendChild(option);
    });
    $(id).value = value;
  }
  function group() { return evidence.groups.find(function (g) { return g.id === $("group").value; }) || evidence.groups[0]; }
  function thresholds(reset) {
    var m = group().metrics["fwd_ret_" + $("horizon").value], choice = evidence.measure;
    var values = new Set();
    ["fwd_ret_", "mfe_", "mae_"].forEach(function (prefix) {
      var metric = group().metrics[prefix + $("horizon").value];
      if (valid(metric) && Array.isArray(metric.thresholds)) metric.thresholds.forEach(function (r) {
        if (obj(r) && Number.isFinite(r.threshold) && r.threshold !== 0) values.add(Math.abs(r.threshold));
      });
    });
    if (choice) values.add(choice.magnitude);
    var supported = valid(m) && Array.isArray(m.thresholds) ? m.thresholds.filter(function (r) {
      return obj(r) && count(r.count) && r.count >= 30 && r.count <= m.present &&
        ((r.op === "gte" && r.threshold > 0.01) || (r.op === "lte" && r.threshold < -0.01));
    }).map(function (r) { return Math.abs(r.threshold); }) : [];
    var target = !reset && $("threshold").value ? $("threshold").value : choice ? String(choice.magnitude)
      : supported.length ? String(Math.max(...supported)) : "";
    var entries = Array.from(values).sort(function (a, b) { return a - b; }).map(function (t) { return [String(t), pct(t)]; });
    if (!target) entries.unshift(["", "Choose a move"]);
    options("threshold", entries, target);
    say("defaultNote", choice ? "Display controls use completed results."
      : supported.length ? "Opens on the largest closing move above 1% with at least 30 occurrences in either direction. Display only."
      : "No closing move above 1% has 30 occurrences at this horizon. Choose a move to inspect its counts.");
  }
  function tableRow(table, values, header, selected) {
    var tr = el("tr"); if (selected) tr.className = "selected";
    values.forEach(function (value) { tr.appendChild(el(header ? "th" : "td", value)); });
    table.appendChild(tr);
  }
  function outcomeReading(g, h, t, direction, touch) {
    var name = (touch ? direction === "up" ? "mfe_" : "mae_" : "fwd_ret_") + h;
    var m = g.metrics[name], b = evidence.referenceMetrics[name], op = direction === "up" ? "gte" : "lte";
    var threshold = direction === "up" ? t : -t;
    return { m: m, b: b, r: rung(m, op, threshold), ref: rung(b, op, threshold) };
  }
  function atGlance(g, h, t) {
    var choice = evidence.measure, touch = choice && choice.kind === "touch";
    var changed = choice && (h !== choice.horizon || t !== choice.magnitude);
    $("resetOutcome").hidden = !changed;
    say("glanceTitle", "Result at a glance · " + (choice ? changed ? "Exploring another outcome" : "Stated outcome" : "Exploring closing returns")
      + (evidence.groups.length > 1 ? " · " + g.label : ""));
    say("glanceAnswer", "Choose a move to read its outcome counts. The full distribution is below.");
    say("glanceComparison", ""); say("glanceCaveat", "No outcome was specified; this view is exploratory.");
    if (!Number.isFinite(t)) return;
    var directions = choice ? [choice.direction] : ["up", "down"];
    var readings = directions.map(function (direction) { return outcomeReading(g, h, t, direction, touch); });
    say("glanceAnswer", readings.map(function (v, i) {
      var action = touch ? "reached a " + (directions[i] === "up" ? "rise" : "fall") + " of at least " + pct(t) + " within " + h
        : "closed at least " + pct(t) + " " + (directions[i] === "up" ? "higher" : "lower") + " after " + h;
      if (!v.r) return "Cannot measure whether outcomes " + action + ": exact outcome unavailable.";
      if (!v.m.present) return "No recorded outcomes are available to measure this outcome (0 present).";
      return fmt(v.r.count) + " of " + fmt(v.m.present) + " recorded outcomes (" + percent(v.r.count, v.m.present) + ") " + action + ".";
    }).join(" "));
    var v = readings[0];
    if (evidence.referenceReason) {
      say("glanceComparison", evidence.referenceKind === "none" ? "Groups are shown separately; no reference comparison is supplied."
        : (evidence.referenceTimedOut ? "The reference timed out (" + evidence.referenceReason.split(":")[0] + ")."
          : "Reference unavailable: " + evidence.referenceReason)
          + " We cannot tell whether this occurred more often than "
          + (evidence.referenceKind === "predicate_false" ? "when the condition was false." : "across all eligible minutes."));
    } else if (!choice) {
      say("glanceComparison", "No outcome was specified. Compare each closing direction with its reference in the breakdown below.");
    } else {
      var reference = evidence.referenceKind === "predicate_false" ? "Other eligible minutes where the condition was false"
        : "All eligible minutes in the same scope, including matches";
      var comparison = reference + ": " + (v.ref ? rate(v.ref.count, v.b.present) + "; " + fmt(v.b.absent) + " missing." : "exact outcome unavailable.");
      if (v.r && v.ref && v.m.present > 0 && v.b.present > 0) {
        var difference = (v.r.count / v.m.present - v.ref.count / v.b.present) * 100;
        comparison += difference === 0 ? " The recorded rates are equal."
          : " The study rate is " + (Math.abs(difference) < 0.1 ? "less than 0.1" : Math.abs(difference).toFixed(1))
            + " percentage points " + (difference > 0 ? "higher." : "lower.");
      } else comparison += " No rate comparison is available.";
      say("glanceComparison", comparison);
    }
    say("glanceCaveat", (valid(v.m) ? fmt(v.m.absent) + " outcomes missing. "
      + (v.m.present > 0 && v.m.present < 30 ? "Fewer than 30 measured outcomes. " : "") : "The selected metric is unavailable; no substitute was used. ")
      + (touch ? "The same occurrence can touch both directions; these counts do not show which came first."
        : "Overlapping observations are not independent trials."));
  }
  function outcomes(g, h, t) {
    $("outcomes").replaceChildren();
    if (!Number.isFinite(t)) return;
    var choice = evidence.measure, touch = choice && choice.kind === "touch";
    var directions = choice && choice.direction === "down" ? ["down", "up"] : ["up", "down"];
    directions.forEach(function (direction, i) {
      var v = outcomeReading(g, h, t, direction, touch), m = v.m, b = v.b, r = v.r, ref = v.ref;
      var card = el("div", undefined, "outcome" + (choice && i === 0 ? " chosen" : ""));
      card.appendChild(el("div", (touch ? "Touched " : "Closed ") + direction + " " + pct(t) + "+ " + (touch ? "within " : "after ") + h));
      card.appendChild(el("strong", r ? rate(r.count, m.present) : "Exact outcome unavailable"));
      card.appendChild(el("small", valid(m) ? fmt(m.absent) + " missing" : "Metric unavailable; no substitute used."));
      if (Object.keys(evidence.referenceMetrics).length) {
        card.appendChild(el("small", "Reference: " + (ref ? rate(ref.count, b.present) : "exact rung unavailable") +
          (valid(b) ? "; " + fmt(b.absent) + " missing" : "")));
        var lift = r && ref && m.present > 0 && b.present > 0 && ref.count > 0
          ? (r.count / m.present) / (ref.count / b.present) : null;
        card.appendChild(el("small", lift !== null ? "Lift: " + lift.toFixed(2) + "× the reference rate"
          : "Lift unavailable" + (ref && ref.count === 0 ? ": reference has no hits." : ": exact rates required.")));
      }
      $("outcomes").appendChild(card);
    });
  }
  function distribution(g, h) {
    var m = g.metrics["fwd_ret_" + h], b = evidence.referenceMetrics["fwd_ret_" + h];
    var a = bins(m), base = bins(b);
    var aligned = a && base && a.length === base.length && a.every(function (x, i) { return x.lo === base[i].lo && x.hi === base[i].hi; });
    $("histogram").replaceChildren(); $("buckets").replaceChildren(); $("axis").replaceChildren();
    $("referenceLegend").hidden = !aligned; $("axis").hidden = !a;
    say("distributionTitle", "Closing-return distribution · " + h);
    say("counts", valid(m) ? fmt(m.present) + " closing outcomes; " + fmt(m.absent) + " missing."
      + (aligned ? " Reference: " + fmt(b.present) + " present; " + fmt(b.absent) + " missing." : "")
      : "Closing outcomes unavailable at this horizon.");
    say("binReading", ""); $("binReading").hidden = !a;
    if (!a) { say("chartNote", "Complete recorded distribution unavailable. No buckets have been estimated."); return; }
    var max = Math.max(0.01, ...a.map(function (x) { return m.present ? x.count / m.present : 0; }),
      ...(aligned ? base.map(function (x) { return b.present ? x.count / b.present : 0; }) : []));
    $("histogram").style.gridTemplateColumns = "repeat(" + a.length + ", minmax(0, 1fr))";
    tableRow($("buckets"), ["Return band", g.label].concat(aligned ? [evidence.referenceLabel] : []), true);
    var largest = a.reduce(function (best, x, i) { return x.count > a[best].count ? i : best; }, 0);
    function selectBin(index) {
      Array.from($("histogram").children).forEach(function (bin, i) {
        bin.setAttribute("aria-pressed", String(i === index));
        bin.tabIndex = i === index ? 0 : -1;
      });
      say("binReading", $("histogram").children[index].getAttribute("aria-label"));
    }
    a.forEach(function (x, i) {
      if ([-0.5, -0.05, 0, 0.05, 0.5].includes(x.lo)) {
        var tick = el("span", pct(x.lo)); tick.style.left = (i / a.length * 100) + "%"; $("axis").appendChild(tick);
      }
      var text = band(x) + ": " + g.label + " " + rate(x.count, m.present) + (aligned ? "; reference " + rate(base[i].count, b.present) : "");
      var bin = el("button", undefined, "bin" + (x.lo === 0 ? " zero" : ""));
      bin.type = "button"; bin.setAttribute("aria-label", text);
      if (aligned && base[i].count > 0) {
        var ref = el("span", undefined, "bar ref"); ref.style.height = (base[i].count / b.present / max * 100) + "%"; bin.appendChild(ref);
      }
      if (x.count > 0) {
        var bar = el("span", undefined, "bar"); bar.style.height = (x.count / m.present / max * 100) + "%"; bin.appendChild(bar);
      }
      bin.onfocus = bin.onmouseenter = bin.onclick = function () { selectBin(i); };
      bin.onkeydown = function (event) {
        var index = event.key === "ArrowLeft" ? Math.max(0, i - 1)
          : event.key === "ArrowRight" ? Math.min(a.length - 1, i + 1)
          : event.key === "Home" ? 0 : event.key === "End" ? a.length - 1 : null;
        if (index === null) return;
        event.preventDefault(); $("histogram").children[index].focus();
      };
      $("histogram").appendChild(bin);
      tableRow($("buckets"), [band(x), rate(x.count, m.present)].concat(aligned ? [rate(base[i].count, b.present)] : []));
    });
    selectBin(largest);
    say("chartNote", "All " + a.length + " buckets, including empty bands and open tails. Height = share of outcomes; widths are not to scale. Hover or tap for counts; use arrow keys when focused."
      + (base && !aligned ? " Reference bucket edges differ; overlay unavailable." : !base && Object.keys(evidence.referenceMetrics).length ? " Reference distribution unavailable at this horizon." : ""));
  }
  function ladder(g, h, t) {
    var up = g.metrics["mfe_" + h], down = g.metrics["mae_" + h];
    var values = new Set();
    [up, down].forEach(function (m) {
      if (valid(m) && Array.isArray(m.thresholds)) m.thresholds.forEach(function (r) {
        if (obj(r) && Number.isFinite(r.threshold) && r.threshold !== 0) values.add(Math.abs(r.threshold));
      });
    });
    var rungs = Array.from(values).sort(function (a, b) { return a - b; });
    var pivot = rungs.findIndex(function (x) { return x >= (Number.isFinite(t) ? t : 0.1); });
    var start = Math.max(0, Math.min((pivot < 0 ? rungs.length : pivot) - 2, rungs.length - 5));
    $("ladder").replaceChildren();
    tableRow($("ladder"), ["Move", "Ran up (MFE)", "Fell down (MAE)"], true);
    rungs.slice(start, start + 5).forEach(function (size) {
      var u = rung(up, "gte", size), d = rung(down, "lte", -size);
      tableRow($("ladder"), [pct(size), u ? rate(u.count, up.present) : "Unavailable",
        d ? rate(d.count, down.present) : "Unavailable"], false, size === t);
    });
    say("ladderTitle", "How far it ran / how far it fell · within " + h);
    say("pathCounts", "Up: " + (valid(up) ? fmt(up.present) + " present, " + fmt(up.absent) + " missing" : "unavailable") +
      ". Down: " + (valid(down) ? fmt(down.present) + " present, " + fmt(down.absent) + " missing" : "unavailable") +
      ". Recorded extremes, not trade returns. Both can be reached; internal gaps can hide touches.");
  }
  function render() {
    if (!evidence) return;
    var g = group(), h = $("horizon").value, t = $("threshold").value === "" ? NaN : Number($("threshold").value);
    say("matchedLegend", g.label); say("referenceLabel", evidence.referenceLabel);
    atGlance(g, h, t); outcomes(g, h, t); distribution(g, h); ladder(g, h, t);
    say("referenceNote", evidence.referenceReason ? (evidence.referenceTimedOut ? "Reference timed out (" + evidence.referenceReason.split(":")[0] + "). The study is still valid; retry it later for a reference. No lift is shown."
        : "Reference: " + evidence.referenceReason + " No lift is shown.")
      : evidence.referenceKind === "predicate_false" ? "Reference: other eligible minutes where the condition was false. It excludes matching minutes."
      : "Reference: all eligible minutes in the same scope, including matches. It is not a matched control.");
    say("limitations", (count(g.count) && g.count < 30 ? "Fewer than 30 occurrences; rates are sensitive to individual observations. " : "") +
      "Minute observations and forward windows can overlap. Historical comparisons do not establish a trading advantage.");
    say("details", JSON.stringify(evidence, null, 2)); resize();
  }
  function receive(result) {
    $("app").hidden = true; $("status").hidden = false;
    say("title", "Study result"); say("scope", ""); say("stats", "");
    var data = result && result._meta && result._meta.edgedepthEvidence;
    if (!result && window.openai) data = window.openai.toolResponseMetadata && window.openai.toolResponseMetadata.edgedepthEvidence;
    // Error envelopes may arrive even when the host drops UI metadata.
    var error = data && data.state === "error" ? data : null;
    if (!error && result) {
      var payloads = [result.structuredContent].concat(Array.isArray(result.content) ? result.content.map(function (block) {
        try { return JSON.parse(block.text); } catch (_) { return null; }
      }) : []);
      var payload = payloads.find(function (p) { return obj(p) && (Array.isArray(p.errors) || (p.code && p.error)); });
      if (payload) error = { status: Array.isArray(payload.errors) ? 422 : null, errors: payload.errors || [{ code: payload.code, message: payload.error }] };
      else if (result.isError) error = { errors: [{ code: "TOOL_ERROR", message: (result.content || []).map(function (b) { return b.text || ""; }).join("\n") }] };
    }
    if (error) {
      say("title", error.status === 422 ? "The engine rejected this document" : "The study could not complete");
      say("status", (error.status ? "HTTP " + error.status + " · " : "") + ((error.errors || []).map(function (e) { return e.code + ": " + e.message; }).join("\n") || "The request failed."));
    } else if (data && data.state === "not_modified") {
      say("status", "The cached study is unchanged (304). Request its cached bytes without If-None-Match to view the chart.");
    } else if (!obj(data) || data.state !== "ready" || !Array.isArray(data.groups) || !data.groups.length) {
      say("status", data ? "The study returned no chart evidence. Read the textual result."
        : "This host did not provide chart evidence. The textual study result remains available.");
    } else {
      evidence = data;
      say("title", data.heading.title); say("scope", data.heading.scope); say("question", "Outcome: " + data.heading.outcome);
      var c = data.counts || {};
      say("stats", fmt(c.total_matching === undefined ? c.population_anchors : c.total_matching) + " occurrences · " + fmt(c.symbols_scanned) + " symbols scanned");
      options("group", data.groups.map(function (g) { return [g.id, g.label + " (" + fmt(g.count) + ")"]; }), data.groups[0].id);
      $("groupLabel").hidden = data.groups.length === 1;
      var horizons = ["30m", "1h", "4h", "24h", "72h", "7d"].filter(function (h) {
        return data.measure && data.measure.horizon === h || data.groups.some(function (g) {
          return ["fwd_ret_", "mfe_", "mae_"].some(function (prefix) { return prefix + h in g.metrics; });
        });
      });
      var horizon = data.measure ? data.measure.horizon : horizons.includes("24h") ? "24h" : horizons[0];
      options("horizon", horizons.map(function (h) { return [h, h]; }), horizon);
      say("coverage", fmt(c.eligible_symbol_buckets) + " eligible minutes; " + fmt(c.excluded_symbol_buckets) + " excluded buckets; " + fmt(c.excluded_symbol_days) + " excluded symbol-days.");
      var met = data.metering || {};
      say("meter", "Cache: " + (met.cache || "unknown") + "; charged " + (met.charged === undefined ? "unknown" : met.charged) + " allowance units; remaining " + (met.remaining === undefined ? "unknown" : met.remaining) + ". Viewing charts makes no request.");
      $("status").hidden = true; $("app").hidden = false;
      thresholds(true); render();
    }
    resize();
  }
  $("group").onchange = function () { thresholds(true); render(); };
  $("horizon").onchange = function () { thresholds(!evidence.measure); render(); };
  $("threshold").onchange = render;
  $("resetOutcome").onclick = function () {
    if (!evidence || !evidence.measure) return;
    $("horizon").value = evidence.measure.horizon; thresholds(true); render(); $("horizon").focus();
  };
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
    appInfo: { name: "edgedepth-evidence", version: "2.0.0" }, appCapabilities: {}, protocolVersion: "2026-01-26"
  } }, "*");
  if (window.openai && window.openai.toolResponseMetadata) receive(null);
})();
</script>
</body>
</html>`
