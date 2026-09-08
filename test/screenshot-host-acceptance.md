# Screenshot investigation: native host acceptance

Status: not run. The automated tests are deterministic contracts with extracted
observations and canned sources. They do not exercise an image model, attachment
access, native tool discovery, visual extraction accuracy or user clarification.
The cross-repository test exercises the built MCP server and actual web handlers
with in-memory MCP transport; authentication and record data are fixtures.

## Setup and observations to record

Run the supporting web API and built MCP server before connecting the intended
vision-capable host. Web must support the new investigation and evidence routes
and the editable `rq` workbench arrival (b68c744 or later). Start a fresh native
conversation so tool/resource discovery is current. Attach the images to the host,
not to the MCP server. Use known recorded event closes and keep a separate answer
key with exact venue, contract, date, zone and intended boundaries.

For every case record the host/model/version, actual image files, user words,
extracted document, clarification transcript, tool calls and responses, record
revision/fingerprint, exact setup, workbench arrival and whether anything ran.
Do not mark a case passed from an expected transcript or a prewritten extraction.
Use only authorized free reads. A paid comparison is a separate acceptance action
requiring the exact proposal and explicit human approval.

## Cases and pass criteria

| Case | Image variation | Required behavior |
| --- | --- | --- |
| Clear | Legible Binance futures pair, chart interval, date/UTC and two marked closes | Preserve visible provenance; resolve the exact endpoint candles; show one concise event identification and next action. No auto-selected nearby move. |
| Cropped / undated | Remove the calendar axis and zone label | Retain unknown facts as missing; ask one concise clarification; no date defaults and no investigation call before an answer. |
| Ambiguous boundary | An arrow between two bars, or a wick endpoint | Keep the proposed boundary inferred; ask which completed close to use. Never claim an exact tick match. |
| Ambiguous zone | Show CST or an unspecified local clock | Ask for an offset or IANA zone before converting to UTC. |
| Conflict | Same-event views with different markets/dates/marked closes, or a visible price inconsistent with the record | Name the conflict, retain both sources and ask which coordinates define the event. No quiet best-match choice. |
| Repeated views | One event at two timeframes, including distinct host event labels | Count one event after exact coordinate deduplication; no commonality call on duplicates alone. |
| Independent examples | Two distinct dated events plus a repeated view of one | Count two unique events; compare only the returned pre-start moments; retain the success-selection caveat. |
| Overlapping examples | Different labels on overlapping intervals of one market | Clarify whether these are the same event before comparison. |
| Unsupported | Another venue/spot pair, arbitrary drawing, hidden liquidation/order-book or unshown indicator | No venue substitution or invented feature reading; explain the unsupported fragment. |
| Missing record | Exact endpoints outside coverage or missing minute bars | State unavailable coordinates; do not interpolate, use zeros or search a nearby move. |

## Study and workbench acceptance

After grounding, invoke `investigate_move` for one returned event. Optional supported
detector geometry must retain tape gaps, parity and unavailable-family diagnostics.
Historical snapshots must retain the existing tier boundary. Missing or failed
offsets must remain distinct from observed zero values. Exact sources are available
with `full_sources`; a re-read may see a newer revision and must not claim old bytes.

Propose a study with a deliberately non-default target, for example finished down
5% after 24h, with an explicit roster and dates. Check that the returned exact setup,
sort/page and separate target survive the editable workbench link and sign-in. No
study executes on navigation. Editing any assumption invalidates prior approval.

If a paid study is separately authorized, read denominators, absent outcomes, both
directions and the same-scope reference from the complete returned population. Page
examples are never the denominator. The target must never become a setup predicate.
Winning screenshots are a selected sample. Testing their condition on the same
period remains exploratory; freeze the definition and check another period before
making any validation claim. Replay entitlement/tape coverage is checked at the
replay surface and is separate from recorded feature coverage. Candle, trade-tape
and order-book availability also differ within an entitled replay.

Cache regression for release 0.8.0: repeat an existing study with an exhausted
allowance and confirm it returns without debit. A new document must refuse without
starting computation. The supporting engine exposes dedicated cache-read routes
(commit 0a9352c); web e68113f uses them and preserves an explicit free-read choice.
Check the actual deployed revisions before acceptance. Never bypass a refusal
through service credentials. Screenshot grounding has no scan-allowance gate.

Only after these native interactions are observed may their individual cases be
called vision-host acceptance. A passed transport suite is not that evidence.
