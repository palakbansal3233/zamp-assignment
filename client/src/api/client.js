// Thin fetch wrapper — no axios. Every function throws an Error whose
// `.message` is already the server's human-readable message (from
// errorHandler.js on the server), so components can show it directly. The
// thrown Error also carries `.status` (the HTTP status code, or 0 for a
// request that never reached the server at all) so callers that need to
// tell "not found" apart from "something broke" — e.g. a document that was
// deleted out from under an open tab — don't have to string-match a message.
const BASE = '/api';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
  } catch (networkErr) {
    // fetch itself threw — offline, DNS failure, CORS, server unreachable.
    const err = new Error('Could not reach the server. Check your connection and try again.');
    err.status = 0;
    err.cause = networkErr;
    throw err;
  }

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level 502/504 from a cold start or
    // timeout) — fall through to a generic message below.
  }

  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status}). Please try again.`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result looks like "data:<mime>;base64,AAAA..." — we only want
      // the part after the comma.
      const commaIdx = reader.result.indexOf(',');
      resolve(reader.result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error(`Could not read "${file.name}" in the browser.`));
    reader.readAsDataURL(file);
  });
}

export async function uploadDocument(file) {
  const dataBase64 = await fileToBase64(file);
  return request('/documents', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
  });
}

export async function uploadRawText(filename, text) {
  const dataBase64 = btoa(unescape(encodeURIComponent(text)));
  return request('/documents', {
    method: 'POST',
    body: JSON.stringify({ filename, mimeType: 'text/plain', dataBase64 }),
  });
}

export function listDocuments({ page = 1, limit = 20 } = {}) {
  return request(`/documents?page=${page}&limit=${limit}`);
}

export function getDocument(id) {
  return request(`/documents/${id}`);
}

export function deleteDocument(id) {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

export function retryDocument(id) {
  return request(`/documents/${id}/retry`, { method: 'POST' });
}

// Continues a long document that didn't finish inside one request's budget
// (see the server's chunked extraction). Safe to call repeatedly — it's a
// no-op once the document is done.
export function resumeDocument(id) {
  return request(`/documents/${id}/resume`, { method: 'POST' });
}

export function searchDocuments(q, mode = 'smart') {
  const params = new URLSearchParams({ q, mode });
  return request(`/query?${params.toString()}`);
}

export function fileUrl(id) {
  return `${BASE}/documents/${id}/file`;
}

export function getHealth() {
  return request('/health');
}

export function askQuestion(question) {
  return request('/ask', { method: 'POST', body: JSON.stringify({ question }) });
}

export function getSuggestions() {
  return request('/ask/suggestions');
}

export function confirmField(docId, key, body) {
  return request(`/documents/${docId}/fields/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
