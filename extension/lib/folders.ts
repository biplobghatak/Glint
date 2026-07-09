import { getDeviceToken } from "@/lib/pairing"

const env = import.meta.env as unknown as Record<string, string>

export type FolderRow = {
  id: string
  name: string
  lead_count: number
}

/**
 * Thrown for anything the panel should surface. `status` is carried because the
 * create path has to tell a duplicate-name 409 (show the server's message
 * inline, next to the input) apart from every other failure.
 */
export class FoldersError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new FoldersError("unpaired", 401)

  const res = await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ device_token, ...(body as object) }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new FoldersError(detail?.error ?? `${name}_failed_${res.status}`, res.status)
  }
  return (await res.json()) as T
}

export async function listFolders(): Promise<FolderRow[]> {
  const data = await callFunction<{ folders: FolderRow[] }>("manage-folders", {
    action: "list",
  })
  return data.folders
}

/** Returns the full post-mutation list, so the caller never merges by hand. */
export async function createFolder(name: string): Promise<FolderRow[]> {
  const data = await callFunction<{ folders: FolderRow[] }>("manage-folders", {
    action: "create",
    name,
  })
  return data.folders
}

/**
 * `folderId: null` unfiles the lead. It is sent explicitly, not omitted: the
 * server distinguishes an absent `folder_id` key ("leave it alone") from a
 * present null one ("clear it").
 */
export async function assignFolder(
  leadId: string,
  folderId: string | null
): Promise<void> {
  await callFunction<{ ok: true }>("update-lead", {
    lead_id: leadId,
    patch: { folder_id: folderId },
  })
}
