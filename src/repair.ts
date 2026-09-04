/**
 * repair - turning a correct refusal into an actionable one (2026-09-04 MCP
 * agent surface audit, finding 4).
 *
 * MEASURED: base_rate called with symbol "BTCUSDT" AND field "feature.rsi" -
 * two defects - answered only `INVALID_VALUE: Invalid identity.symbol:
 * "BTCUSDT"`, with no statement that symbols are lowercase. Repairing the case
 * then answered `UNSUPPORTED_FEATURE: Unknown feature: feature.rsi`, with no
 * nearest match. Two round trips and two agent turns to learn two things the
 * validator knew at once, and the same shape had already cost two units of a
 * free allowance in the 2026-08-30 session log.
 *
 * The engine's error body is a contract and is never touched here. This adds a
 * SEPARATE note block that names what the caller can do next, computed from the
 * registry the caller could have read anyway:
 *
 *  - an unknown feature id gets its nearest real ids, ranked deterministically;
 *  - a rejected identity.symbol gets the lowercase rule stated, with the
 *    lowercased candidate when that is all that was wrong;
 *  - an outcome-in-predicate refusal gets the one legal way to ask that
 *    question.
 *
 * Nothing here guesses a value or retries anything: the repair belongs to the
 * caller, and a wrong hint would be worse than none, so a hint is only emitted
 * when the registry actually supports it.
 */

/** Levenshtein distance, iterative and allocation-light. Deterministic. */
function distance(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = Array.from({ length: cols }, (_, i) => i)
  let curr = new Array<number>(cols).fill(0)
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i
    for (let j = 1; j < cols; j += 1) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, substitution)
    }
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[cols - 1] ?? 0
}

/** Bare name of a namespaced id, e.g. feature.vpin -> vpin. */
function bare(id: string): string {
  const dot = id.indexOf('.')
  return dot === -1 ? id : id.slice(dot + 1)
}

/**
 * The closest real ids to an unknown one. Containment first (rsi_14 -> the
 * family that contains it), then edit distance on the bare name, then
 * alphabetical so the same input always produces the same list.
 */
export function nearestFeatures(unknown: string, known: string[], limit = 3): string[] {
  const needle = bare(unknown).toLowerCase()
  if (!needle) return []
  const scored = known.map((id) => {
    const name = bare(id).toLowerCase()
    const contains = name.includes(needle) || needle.includes(name)
    return { id, contains, distance: distance(needle, name) }
  })
  // A typo tolerance that scales with the name: "rsi" is three characters from
  // "vpin" and must NOT be offered as a near match, while "fundingrate" is one
  // character from "funding_rate" and must be.
  const tolerance = needle.length <= 4 ? 1 : needle.length <= 8 ? 2 : 3
  return scored
    .filter((entry) => entry.contains || entry.distance <= tolerance)
    .sort(
      (a, b) =>
        Number(b.contains) - Number(a.contains) || a.distance - b.distance || a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((entry) => entry.id)
}

interface ContractError {
  code?: unknown
  message?: unknown
}

/**
 * Whether a refusal needs the registry to be repaired. Codes that name an
 * unknown field need the real id list; every other hint is computed from the
 * message alone. Keeping this separate means a refusal the note cannot improve
 * costs the caller no extra round trip at all.
 */
export function needsRegistry(bodyText: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return false
  }
  const errors = (parsed as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return false
  return errors.some((entry) => {
    const code = (entry as ContractError | null)?.code
    return code === 'UNSUPPORTED_FEATURE' || code === 'UNSUPPORTED_FIELD'
  })
}

/** Feature ids from a registry document, or [] when it is unusable. */
export function registryFeatureIds(doc: Record<string, unknown> | null): string[] {
  const features = doc?.features
  if (!features || typeof features !== 'object' || Array.isArray(features)) return []
  return Object.keys(features as Record<string, unknown>)
}

/**
 * A repair note for a 422 contract body, or null when nothing useful can be
 * said. `known` is the registry's feature id list; an empty list still allows
 * the symbol and outcome hints, which need no registry.
 */
export function repairNote(bodyText: string, known: string[]): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const errors = (parsed as { errors?: unknown }).errors
  if (!Array.isArray(errors) || errors.length === 0) return null

  const lines: string[] = []
  for (const entry of errors as ContractError[]) {
    const code = typeof entry.code === 'string' ? entry.code : ''
    const message = typeof entry.message === 'string' ? entry.message : ''

    if (code === 'UNSUPPORTED_FEATURE' || code === 'UNSUPPORTED_FIELD') {
      const named = message.match(/(?:feature|window|identity|times|outcome)\.[A-Za-z0-9_.]+/g) ?? []
      for (const id of named) {
        const nearest = nearestFeatures(id, known)
        lines.push(
          nearest.length > 0
            ? `${id} is not in this feature_version. Nearest real ids: ${nearest.join(', ')}. ` +
              `Confirm one with list_features (search: "${bare(id)}") before re-running.`
            : `${id} is not in this feature_version and nothing in the registry is close to it. ` +
              'The grammar is closed: call list_features and pick a real id rather than ' +
              'rephrasing this one.',
        )
      }
    }

    if (code === 'INVALID_VALUE' && /identity\.symbol/.test(message)) {
      const quoted = message.match(/"([^"]+)"/)?.[1]
      const lowered = quoted?.toLowerCase()
      lines.push(
        'identity.symbol takes exact lowercase Binance USDT-M perpetual symbols only: case ' +
          'folding, aliases, separators and whitespace are all rejected rather than repaired.' +
          (quoted && lowered !== quoted
            ? ` "${quoted}" differs from "${lowered}" only in case - check "${lowered}" with ` +
              'list_instruments and re-run.'
            : ' Check membership with list_instruments before re-running.'),
      )
    }

    if (code === 'OUTCOME_IN_PREDICATE') {
      lines.push(
        'Outcome fields can never be filtered, by design: filtering them would select the ' +
          'winners after the fact. Run the setup unfiltered and read what followed from ' +
          'outcomes_summary, which covers every occurrence, or use run_cohort to set the matched ' +
          'population beside every other eligible bucket.',
      )
    }
  }

  if (lines.length === 0) return null
  const preamble =
    errors.length > 1
      ? `repair (${errors.length} contract errors above):`
      : 'repair:'
  return `${preamble}\n- ${[...new Set(lines)].join('\n- ')}`
}
