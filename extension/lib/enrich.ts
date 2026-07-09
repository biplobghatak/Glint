/**
 * The `/in/<slug>` path of a LinkedIn profile URL, or null if it isn't one.
 *
 * The extractor stores a lead's `linkedin_url` as an absolute URL
 * (`https://www.linkedin.com/in/jane-doe`); enrichment needs just the profile
 * path so it can build the standalone contact-info overlay URL. A URL that
 * isn't a profile (or won't parse) yields null, and the caller simply doesn't
 * queue that lead for enrichment — better than opening a tab to a page that has
 * no contact info to find.
 */
export function profilePathFromUrl(
  linkedinUrl: string | null | undefined
): string | null {
  if (!linkedinUrl) return null
  try {
    const u = new URL(linkedinUrl)
    let path = u.pathname
    if (!/^\/in\/[^/]+/.test(path)) return null
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1)
    return path
  } catch {
    return null
  }
}
