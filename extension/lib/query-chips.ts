// Composition logic for the ICP suggestion chips.
//
// The single source of truth is the query string. A chip is "selected" iff its
// text occurs in the query, and tapping it appends or removes that text. Nothing
// keeps a Set of selected chips alongside the query — that would desynchronise
// the instant the user hand-edits the textarea, and the chips would then lie
// about what will actually be searched.

export type ChipKind = "role" | "company" | "country"

// Chip text is user data (`C++`, `Head of R&D`, `.NET`), never a pattern. Escape
// every regex metacharacter before it goes anywhere near a RegExp, or a `+`
// silently becomes a quantifier and matching lies.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Word-boundary match via lookarounds rather than `\b`: `\b` needs a word
// character on the chip's edge, which fails for chips that begin or end with a
// symbol (`C++`, `.NET`). `(?<!\w) … (?!\w)` treats any non-word neighbour as a
// boundary, so `CTO` is found in `CTO of…` but not inside `CTOs`.
function chipRegExp(chip: string, flags: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRegExp(chip)}(?!\\w)`, flags)
}

// True when the query already contains `word` as a standalone token, so a second
// `at` / `in` is never introduced.
function hasWord(query: string, word: string): boolean {
  return new RegExp(`(?<!\\w)${word}(?!\\w)`, "i").test(query)
}

/** True when the chip's text occurs in the query, case-insensitively, on word boundaries. */
export function isChipSelected(query: string, chip: string): boolean {
  if (chip === "") return false
  return chipRegExp(chip, "i").test(query)
}

// After a removal, tidy the connectors the removed chip may have stranded:
// a trailing `at` / `in` with nothing after it, an orphaned comma, doubled
// commas from removing a middle item, and stray whitespace.
function cleanup(text: string): string {
  let out = text.replace(/\s+/g, " ")
  // A connector left immediately before a comma lost its operand between them:
  // keep the connector, drop the orphan comma. "at , SaaS" -> "at SaaS".
  out = out.replace(/(?<!\w)(at|in)(?!\w)\s*,\s*/gi, "$1 ")
  // Normalise comma spacing, then collapse runs of commas left by removing a
  // middle item ("fintech, , edtech" -> "fintech, edtech").
  out = out.replace(/\s*,\s*/g, ", ")
  out = out.replace(/(?:,\s*)+,/g, ",")
  // Drop leading / trailing commas.
  out = out.replace(/^\s*,\s*/, "").replace(/\s*,\s*$/, "")
  // Drop a connector left dangling at the very end with no operand after it.
  out = out.replace(/(?:^|\s)(?:at|in)\s*$/gi, "")
  return out.replace(/\s+/g, " ").trim()
}

function appendChip(query: string, chip: string, kind: ChipKind): string {
  const base = query.trimEnd()
  if (base.trim() === "") return chip
  if (kind === "role") return `${base} ${chip}`
  // A company type slots in after `at`; a country after `in`. Once that
  // connector exists, further chips of the same kind append after a comma
  // rather than repeating the connector.
  const connector = kind === "company" ? "at" : "in"
  return hasWord(base, connector) ? `${base}, ${chip}` : `${base} ${connector} ${chip}`
}

/** Adds the chip's text to the query, or removes it if already present. */
export function toggleChip(query: string, chip: string, kind: ChipKind): string {
  if (isChipSelected(query, chip)) {
    return cleanup(query.replace(chipRegExp(chip, "gi"), ""))
  }
  return appendChip(query, chip, kind)
}
