/**
 * Where the browser asks for a place's photograph.
 *
 * Its own file with no imports, for the reason `imagery/url.ts` is: a component
 * needs this and nothing else, and must not drag the logger or the provider
 * into its bundle. Always our own origin; the proxy route does the fetching.
 */
export function placeImageUrl(file: string, width: 320 | 640 | 1280 | 1600): string {
  return `/api/places/image?${new URLSearchParams({ file, w: String(width) }).toString()}`;
}
