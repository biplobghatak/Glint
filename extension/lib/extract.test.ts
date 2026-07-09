import { describe, expect, it } from "vitest"
import { extractAvatarUrl } from "./extract"

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
