import { countryLabel } from "@/lib/filter"
import { isChipSelected, toggleChip, type ChipKind } from "@/lib/query-chips"

type Chip = { kind: ChipKind; label: string; text: string }

// Roles and company types are stored as prose already. Countries are stored as
// ISO alpha-2 codes, so the label the user sees — and the text toggled into the
// query — is resolved through countryLabel(); parse-search-query reads prose,
// not codes.
function buildChips(
  roles: string[],
  companies: string[],
  countries: string[]
): Chip[] {
  const chips: Chip[] = []
  for (const r of roles) if (r) chips.push({ kind: "role", label: r, text: r })
  for (const c of companies) if (c) chips.push({ kind: "company", label: c, text: c })
  for (const code of countries) {
    if (!code) continue
    const label = countryLabel(code)
    chips.push({ kind: "country", label, text: label })
  }
  return chips
}

// No `disabled` prop: the panel unmounts these while a run is live or paused,
// so there is no state in which a chip is on screen but unusable.
export function IcpChips({
  roles,
  companies,
  countries,
  query,
  onChange,
}: {
  roles: string[]
  companies: string[]
  countries: string[]
  query: string
  onChange: (next: string) => void
}) {
  const chips = buildChips(roles, companies, countries)
  // No roles, no company types, no countries: render nothing rather than an
  // empty heading.
  if (chips.length === 0) return null

  // Selection is derived from the query, the single source of truth. Selected
  // chips render first with a × affordance; unselected ones with a +.
  const decorated = chips.map((chip) => ({
    ...chip,
    selected: isChipSelected(query, chip.text),
  }))
  const ordered = [
    ...decorated.filter((c) => c.selected),
    ...decorated.filter((c) => !c.selected),
  ]

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">From your ICP</span>
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((chip) => (
          <button
            key={`${chip.kind}:${chip.text}`}
            type="button"
            aria-pressed={chip.selected}
            onClick={() => onChange(toggleChip(query, chip.text, chip.kind))}
            className={
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors " +
              (chip.selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-accent")
            }
          >
            <span aria-hidden="true" className="mr-1">
              {chip.selected ? "×" : "+"}
            </span>
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  )
}
