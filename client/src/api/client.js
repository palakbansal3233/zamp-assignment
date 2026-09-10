// Thin fetch wrapper — no axios. Every function throws an Error whose
// `.message` is already the server's human-readable message (from
// errorHandler.js on the server), so components can show it directly.
const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level 502/504 from a cold start or
    // timeout) — fall through to a generic message below.
  }

  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status}). Please try again.`);
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
