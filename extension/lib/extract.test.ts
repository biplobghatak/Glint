import { describe, expect, it } from "vitest"
import { extractAvatarUrl, extractFromNode, looksLikePersonName } from "./extract"

function card(html: string): Element {
  const el = document.createElement("li")
  el.innerHTML = html
  return el
}

describe("extractAvatarUrl", () => {
  it("reads the profile image from the card", () => {
    const node = card(
      `<a href="/in/jane"><img src="https://media.licdn.com/dms/image/abc/photo.jpg"></a>`
    )
    expect(extractAvatarUrl(node)).toBe("https://media.licdn.com/dms/image/abc/photo.jpg")
  })

  // LinkedIn serves an inline SVG silhouette for members with no photo. Stored
  // as if it were a real avatar it renders as a grey blob forever, and no code
  // downstream can tell it apart from a genuine picture.
  it("rejects a data: URI ghost placeholder", () => {
    const node = card(`<a href="/in/jane"><img src="data:image/svg+xml;base64,PHN2Zz4="></a>`)
    expect(extractAvatarUrl(node)).toBeNull()
  })

  it("rejects a ghost-person class placeholder", () => {
    const node = card(
      `<a href="/in/jane"><img class="ghost-person" src="https://static.licdn.com/x.png"></a>`
    )
    expect(extractAvatarUrl(node)).toBeNull()
  })

  it("returns null when the card has no image", () => {
    expect(extractAvatarUrl(card(`<a href="/in/jane">Jane</a>`))).toBeNull()
  })

  it("prefers an image inside the profile anchor over an unrelated one", () => {
    const node = card(
      `<img src="https://media.licdn.com/dms/image/logo.png">
       <a href="/in/jane"><img src="https://media.licdn.com/dms/image/face.jpg"></a>`
    )
    expect(extractAvatarUrl(node)).toBe("https://media.licdn.com/dms/image/face.jpg")
  })

  it("never throws on hostile markup", () => {
    expect(() => extractAvatarUrl(card(`<img>`))).not.toThrow()
  })
})

describe("looksLikePersonName", () => {
  it("accepts ordinary names, including long multi-part ones", () => {
    expect(looksLikePersonName("Ritu David")).toBe(true)
    expect(looksLikePersonName("Maria del Carmen van der Berg")).toBe(true)
    expect(looksLikePersonName("Xu")).toBe(true)
  })

  // The exact blob a profile page produced, stored as a lead's name and then
  // rendered into the draft card's title and the draft-opener's prompt.
  it("rejects a profile top-card blob", () => {
    const blob =
      "Ritu David Ritu David Clarity Catalyst for Global Leaders & Brands | " +
      "Founder, The Data DuckMumbai, Maharashtra, India17K followersView my services"
    expect(looksLikePersonName(blob)).toBe(false)
  })

  it("rejects headline furniture that never appears in a name", () => {
    expect(looksLikePersonName("Jane Doe | Founder")).toBe(false)
    expect(looksLikePersonName("Jane Doe • 2nd")).toBe(false)
    expect(looksLikePersonName("Jane Doe 17K followers")).toBe(false)
    expect(looksLikePersonName("Jane Doe" + String.fromCharCode(10) + "CEO")).toBe(false)
  })

  it("rejects the empty string and anything over 60 chars", () => {
    expect(looksLikePersonName("")).toBe(false)
    expect(looksLikePersonName("a".repeat(61))).toBe(false)
  })
})

describe("extractFromNode name guard", () => {
  // Discarding the card is the correct failure: a lead with no name is not
  // stored at all, whereas a lead named after a whole card poisons the row, the
  // opener prompt, and every badge that repeats it.
  it("discards a card whose only profile anchor holds a whole top card", () => {
    const node = card(
      `<a href="/in/ritu">Ritu David Ritu David Clarity Catalyst for Global Leaders ` +
        `&amp; Brands | Founder, The Data DuckMumbai, Maharashtra, India17K followers</a>`
    )
    expect(extractFromNode(node)).toBeNull()
  })

  it("still extracts a normal search-result card", () => {
    const node = card(
      `<a href="/in/jane"><span aria-hidden="true">Jane Doe</span></a>` +
        `<div class="entity-result__primary-subtitle">CEO at Acme</div>`
    )
    expect(extractFromNode(node)?.name).toBe("Jane Doe")
  })
})
