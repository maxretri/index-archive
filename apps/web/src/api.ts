import type { AuthResponse, Collection, LibraryFilter, PaginatedFiles } from "@index/shared";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const sessionKey = "index.session";

export function getSession() { return sessionStorage.getItem(sessionKey); }
export function setSession(value: string) { sessionStorage.setItem(sessionKey, value); }
export function clearSession() { sessionStorage.removeItem(sessionKey); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getSession();
  const headers = new Headers(options.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 401) clearSession();
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  authenticate: (initData: string) => request<AuthResponse>("/auth/telegram", { method: "POST", body: JSON.stringify({ initData }) }),
  files: (params: { filter: LibraryFilter; cursor?: string; q?: string; collectionId?: string; from?: string; to?: string }) => {
    const query = new URLSearchParams({ filter: params.filter, limit: "30" });
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.q) query.set("q", params.q);
    if (params.collectionId) query.set("collectionId", params.collectionId);
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    return request<PaginatedFiles>(`/api/files?${query}`);
  },
  collections: () => request<Collection[]>("/api/collections"),
  createCollection: (name: string) => request<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name }) }),
  deleteCollection: (id: string) => request<void>(`/api/collections/${id}`, { method: "DELETE" }),
  addFilesToCollections: (fileIds: string[], collectionIds: string[]) => request<{ fileCount: number; collectionIds: string[] }>("/api/collections/files", {
    method: "POST",
    body: JSON.stringify({ fileIds, collectionIds })
  }),
  favorite: (id: string, favorite: boolean) => request<{ id: string; isFavorite: boolean }>(`/api/files/${id}/favorite`, { method: "PATCH", body: JSON.stringify({ favorite }) }),
  prepareShare: (id: string) => request<{ messageId: string; expiresAt: number }>(`/api/files/${id}/share`, { method: "POST" }),
  setCollections: (id: string, collectionIds: string[]) => request<{ collectionIds: string[] }>(`/api/files/${id}/collections`, { method: "PUT", body: JSON.stringify({ collectionIds }) }),
  setTags: (id: string, tags: string[]) => request<{ tags: string[] }>(`/api/files/${id}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }),
  content: async (id: string, variant: "thumbnail" | "original" = "original", download = false) => {
    const token = getSession();
    const response = await fetch(`${API_URL}/api/files/${id}/content?variant=${variant}&download=${download}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("File unavailable");
    return response.blob();
  },
  upload: (file: File, onProgress: (progress: number) => void) => new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/uploads`);
    const token = getSession();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onload = () => {
      let payload: { id?: string; error?: string } = {};
      try { payload = JSON.parse(xhr.responseText) as typeof payload; } catch { /* no-op */ }
      if (xhr.status >= 200 && xhr.status < 300 && payload.id) resolve({ id: payload.id });
      else reject(new Error(payload.error ?? "Upload failed"));
    };
    const form = new FormData();
    form.set("file", file);
    xhr.send(form);
  })
};
