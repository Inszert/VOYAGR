# Destination imagery

Section 5 of the 1.10.1 specification asks for "large destination imagery" and "cinematic
destination presentation". That needs photographs of real places, which we do not have and cannot
invent.

**No imagery provider has been chosen, and none is wired in.** This records the options so the
decision is made once, deliberately, rather than by whoever first needs a picture.

Retrieved 19 September 2026 from each vendor's own documentation. Marked **[vendor]** where an
answer requires contacting them.

---

## Why this is not a small dependency

An imagery API is not like a charting library. It puts a third party in the render path of every
destination the product shows, and it brings obligations that outlive the integration:

- **Attribution is contractual, not optional.** It has to survive redesigns, appear on every
  surface that shows a photo, and be correct per photographer.
- **Hotlinking versus caching is a licence term**, not a performance choice, and the two leading
  free options require opposite things.
- **Every image is a third-party request from the user's browser**, which is a privacy fact as much
  as a performance one, and it collides with a service worker that is meant to work offline.
- **A photo is a claim about a place.** A beach picture attached to the wrong destination is the
  same class of error as a wrong price: the product asserting something it does not know.

---

## Options

### Unsplash API

|                  |                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost             | Free tier; production use needs approval for a rate-limit increase                                                                                                                |
| Attribution      | Required: "your application must attribute Unsplash, the Unsplash photographer, and contain a link back to their Unsplash profile", with `utm_source` and `utm_medium` parameters |
| Caching          | **Hotlinking is mandatory.** "All API uses must use the hotlinked image URLs returned by the API under the `photo.urls` properties" — self-hosting is not permitted               |
| Rate limits      | "Too many requests too quickly will get your access turned off"; no public number                                                                                                 |
| Tracking         | A download endpoint must be called when a user selects an image                                                                                                                   |
| Restrictions     | May not "replicate the core user experience of Unsplash"; may not sell unaltered photos; must be "non-automated, high-quality, and authentic"                                     |
| Commercial terms | **[vendor]**                                                                                                                                                                      |

**The blocker:** mandatory hotlinking means every destination photo is a live request to Unsplash's
CDN from the user's browser. That cannot be cached by our service worker, cannot be served offline,
and sends a request to a third party for every destination a user browses past.

### Pexels API

|                  |                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost             | Free. 200 requests/hour and 20,000/month by default; unlimited free "if you meet our API terms"                                                                        |
| Attribution      | "Always credit our photographers when possible", e.g. "Photo by John Doe on Pexels" linking to the photo page. Showing acceptable attribution is what lifts the limits |
| Caching          | **Encouraged.** "Implement your own cache of responses… 24 hours is a good amount of time"                                                                             |
| Rate limits      | `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` headers; working around the limit terminates access                                                                    |
| Commercial terms | **[vendor]**                                                                                                                                                           |

**The advantage:** caching is permitted and encouraged, so images can be served from our own origin,
cached by the service worker, and shown offline. The rate limit applies to _lookups_, not to
serving, which suits a small, slow-changing destination catalogue.

### A curated, self-hosted set

Licensing a small number of photographs, or commissioning them, and serving them ourselves.

|             |                                                                  |
| ----------- | ---------------------------------------------------------------- |
| Cost        | Real money, per image **[vendor]**                               |
| Attribution | Whatever the licence says; usually none for a bought licence     |
| Caching     | Ours entirely. Works offline, one origin, no third-party request |
| Coverage    | Only the destinations we paid for                                |

**The advantage:** no third party in the render path, no attribution to maintain, and complete
control over what each photo claims. **The cost:** it does not scale past a curated catalogue, which
is fine while the catalogue _is_ curated and wrong the moment "Anywhere mode" arrives.

---

## What is not in doubt

Whichever is chosen:

1. **A photo needs provenance like any other datum.** A stock photograph of "a beach in Turkey" is
   not a photograph of the hotel being sold. The existing `DataProvenance` type covers this, and an
   illustrative image must be labelled as illustrative.
2. **Attribution is a component, not a footnote**, and it ships at the same time as the first image.
3. **Images load lazily, with intrinsic dimensions**, or the editorial layout the imagery exists to
   create will shift under the reader.
4. **Every image needs alternative text that says what the place is**, not "Antalya" repeated forty
   times. Where no meaningful description exists the image is decorative and hidden from assistive
   technology.
5. **The tests must not need the network.** Whatever the source, the suite runs offline.

---

## Recommendation, not yet a decision

**Pexels** is the better fit of the two APIs, for one reason that outweighs the rest: it permits
caching. Unsplash's mandatory hotlinking is incompatible with a product whose service worker is
meant to work offline and whose privacy posture is one origin.

**But the honest answer for now is neither.** The destination catalogue is eight fixture entries.
Wiring an imagery API to illustrate demo destinations adds a third-party dependency, an attribution
obligation and a rate limit in order to decorate data that is itself not real.

Discovery is therefore built **without photographs**: typography, colour and layout carry it. That
is a constraint worth having — a discovery surface that works without imagery will only get better
when imagery arrives, whereas one that needs photographs to be legible was never designed.

Revisit when there is a real destination catalogue, which is Phase 3.
