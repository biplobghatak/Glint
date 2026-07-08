export function isLinkedIn(url: string | undefined): boolean {
  return !!url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//.test(url)
}
