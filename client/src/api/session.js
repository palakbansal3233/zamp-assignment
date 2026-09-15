// Your documents belong to this browser tab, and they leave with it.
//
// Sift is one public link. Without a per-visitor session, sending someone
// that link would hand them your tenancy agreement and your prescription —
// which, for a product built around documents you'd think twice about
// forwarding, is the worst possible default.
//
// `sessionStorage`, not `localStorage`, is the whole design in one choice:
//   - it is per-tab, so two people (or two tabs) never share a workspace;
//   - it survives a reload, so refreshing mid-upload doesn't lose your work;
//   - the browser drops it when the tab closes, so "gone when you leave" is
//     enforced by the browser itself rather than only by our goodbye.
const KEY = 'sift.session';

function readStored() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    // Private mode, or storage blocked entirely. Falling back to a
    // per-page-load id is the safe direction: the visit is more ephemeral
    // than intended, never less.
    return null;
  }
}

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached = null;

export function getSessionId() {
  if (cached) return cached;
  cached = readStored() || randomId();
  try {
    sessionStorage.setItem(KEY, cached);
  } catch {
    /* see readStored — we still use the id for this page's lifetime */
  }
  return cached;
}

export function forgetSession() {
  cached = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Asks the server to delete everything for this session, from inside page
 * teardown.
 *
 * `sendBeacon` rather than `fetch`, because a normal request started during
 * `pagehide` is cancelled when the page goes away — the browser is under no
 * obligation to finish it. A beacon is explicitly designed to outlive the
 * page. It can only send POST, which is why the server exposes
 * `POST /session/end` alongside the DELETE.
 */
export function endSessionOnUnload() {
  const payload = new Blob([JSON.stringify({ sessionId: getSessionId() })], { type: 'application/json' });
  // The header can't ride along on a beacon, so the session travels in the
  // query string here. It isn't a secret being leaked to anyone new — it's
  // this visitor's own id, going to the same origin that issued it.
  const url = `/api/session/end?session=${encodeURIComponent(getSessionId())}`;
  try {
    if (navigator.sendBeacon?.(url, payload)) return true;
  } catch {
    /* fall through */
  }
  // Last resort for browsers without sendBeacon. `keepalive` asks fetch to
  // outlive the page; it's best-effort, and the server's TTL is what makes
  // the guarantee regardless.
  try {
    fetch(url, { method: 'POST', keepalive: true });
  } catch {
    /* the TTL backstop will collect it */
  }
  return false;
}
