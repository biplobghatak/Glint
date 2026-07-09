"use client"

import { useState, type FormEvent } from "react"
import { FolderIcon, InboxIcon, LayersIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type Folder = { id: string; name: string }

/**
 * `null` = all leads, `""` = unfiled, `"<uuid>"` = that folder.
 *
 * Three states, not two. `null` and `""` are different queries, and collapsing
 * them makes "All leads" show only unfiled leads — quietly.
 */
export type FolderId = string | null

export function FolderRail({
  folders,
  selected,
  onSelect,
  counts,
  allCount,
  unfiledCount,
  onCreate,
  onRename,
  onDelete,
  error,
  onDismissError,
}: {
  folders: Folder[]
  selected: FolderId
  onSelect: (id: FolderId) => void
  /** folder id -> number of leads currently filed there. */
  counts: Record<string, number>
  allCount: number
  unfiledCount: number
  /** Resolves true when the folder was created. */
  onCreate: (name: string) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  /** Duplicate-name message, or any other write failure. */
  error: string | null
  onDismissError: () => void
}) {
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    // Cleared only on success: a duplicate-name rejection must leave the text
    // in place for the user to edit.
    if (await onCreate(name)) setNewName("")
    setCreating(false)
  }

  async function commitRename(id: string) {
    const name = editingName.trim()
    const original = folders.find((f) => f.id === id)?.name
    if (!name || name === original) {
      setEditingId(null)
      return
    }
    if (await onRename(id, name)) setEditingId(null)
  }

  function itemClass(active: boolean) {
    return cn(
      "flex w-full items-center gap-2 border border-transparent px-3 py-2 text-left text-sm transition-colors",
      active
        ? "border-border bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={itemClass(selected === null)}
        >
          <LayersIcon className="size-4 shrink-0" />
          <span className="flex-1">All leads</span>
          <span className="text-muted-foreground text-xs tabular-nums">{allCount}</span>
        </button>

        {/* Unfiled is always present. Every lead that predates the folders
            migration has folder_id = null; if this weren't reachable the
            migration would look like it ate the entire inbox. */}
        <button
          type="button"
          onClick={() => onSelect("")}
          className={itemClass(selected === "")}
        >
          <InboxIcon className="size-4 shrink-0" />
          <span className="flex-1">Unfiled</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {unfiledCount}
          </span>
        </button>

        {folders.map((folder) => {
          const active = selected === folder.id
          if (editingId === folder.id) {
            return (
              <form
                key={folder.id}
                onSubmit={(e) => {
                  e.preventDefault()
                  void commitRename(folder.id)
                }}
                className="px-1 py-1"
              >
                <Input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => void commitRename(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingId(null)
                  }}
                  maxLength={60}
                  aria-label={`Rename ${folder.name}`}
                  className="h-8 text-sm"
                />
              </form>
            )
          }
          return (
            <div key={folder.id} className="group/folder flex items-center">
              <button
                type="button"
                onClick={() => onSelect(folder.id)}
                className={cn(itemClass(active), "min-w-0 flex-1")}
              >
                <FolderIcon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{folder.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {counts[folder.id] ?? 0}
                </span>
              </button>
              <div className="flex shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Rename ${folder.name}`}
                  onClick={() => {
                    onDismissError()
                    setEditingName(folder.name)
                    setEditingId(folder.id)
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Delete ${folder.name}`}
                  onClick={() => setPendingDelete(folder)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          )
        })}
      </nav>

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New folder"
          aria-label="New folder name"
          maxLength={60}
          className="h-8 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={newName.trim().length === 0 || creating}
        >
          Add
        </Button>
      </form>

      {error && (
        <p className="text-destructive text-xs">
          {error}{" "}
          <button type="button" onClick={onDismissError} className="underline">
            Dismiss
          </button>
        </p>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
            {/* leads.folder_id is `on delete set null`. The user cannot see the
                schema, and a user who deletes "Q3 prospects" believing it takes
                200 scored leads with it has lost real money. Say it plainly. */}
            <DialogDescription>
              Leads in this folder will be moved to Unfiled, not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const folder = pendingDelete
                setPendingDelete(null)
                if (folder) void onDelete(folder.id)
              }}
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
