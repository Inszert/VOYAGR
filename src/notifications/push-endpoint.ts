/**
 * Whether a push subscription's endpoint is somewhere we are willing to POST to.
 *
 * The endpoint is chosen by whoever calls the subscribe route, and the server
 * later makes a request to it. A real one is always `https` on a push service's
 * own named host (Google's, Mozilla's, Microsoft's, Apple's), so what is refused
 * is everything that is not a public hostname: an IP literal (including the
 * cloud metadata address), `localhost`, a bare single-label host, an internal
 * suffix, a non-standard port, or credentials in the URL. A vendor allow-list
 * would be tighter but would break the next browser's push service silently.
 */
export function isPublicPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '443') return false;

  const host = url.hostname.toLowerCase().replace(/[.]+$/, '');

  // IPv6 literals are bracketed; IPv4 literals are four dotted numbers (URL
  // already normalises hex and octal forms to dotted decimal).
  if (host.startsWith('[') || /^\d+(\.\d+){0,3}$/.test(host)) return false;

  if (!host.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return false;

  return true;
}
