import { useState, type FormEvent } from "react"
import type { FolderRow } from "@/lib/folders"

// A run has to write somewhere, so "All folders" is not offered — that is a
// filter value, not a destination. `null` here means Unfiled, and is a
// deliberate choice the user makes, not a default they fall into.
export function FolderPicker({
  folders,
  selected,
  onSelect,
  onContinue,
  onCreateFolder,
  creating,
  createError,
}: {
  folders: FolderRow[]
  selected: string | null
  onSelect: (folderId: string | null) => void
  onContinue: () => void
  onCreateFolder: (name: string) => Promise<boolean>
  creating: boolean
  createError: string | null
}) {
  const [newName, setNewName] = useState("")
  const [adding, setAdding] = useState(false)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (await onCreateFolder(name)) {
      setNewName("")
      setAdding(false)
    }
  }

  const rowClass = (isSelected: boolean) =>
    "flex w-full items-center justify-between rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition-colors " +
    (isSelected
      ? "border-primary bg-accent"
      : "border-border bg-card hover:bg-accent")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Save leads to…</p>
        <p className="text-muted-foreground text-xs">
          Every lead this run scores and keeps is filed here.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {folders.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              className={rowClass(selected === f.id)}
              aria-pressed={selected === f.id}
            >
              <span className="truncate">{f.name}</span>
              <span className="text-muted-foreground tabular-nums text-xs">
                {f.lead_count}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={rowClass(selected === null)}
            aria-pressed={selected === null}
          >
            <span>Unfiled</span>
          </button>
        </li>
      </ul>

      {adding ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Folder name"
            disabled={creating}
            className="border-border bg-card focus-visible:ring-ring rounded-[var(--radius)] border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
          />
          {createError && <p className="text-destructive text-xs">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || newName.trim().length === 0}
              className="bg-primary text-primary-foreground flex-1 rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-primary self-start text-xs underline"
        >
          + New folder
        </button>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="bg-primary text-primary-foreground mt-1 rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Continue
      </button>
    </div>
  )
}
