import type { AuthResponse, Collection, LibraryFilter, PaginatedFiles, ReceivedCollection, SharedCollectionPage, SubscriptionStatus } from "@index/shared";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const sessionKey = "index.session";
const fileCachePrefix = "index.files.v1";

interface SessionPayload { sub?: string; telegramUserId?: string; exp?: number }
interface CachedFiles { savedAt: number; data: PaginatedFiles }

function readSessionPayload(value: string): SessionPayload | null {
  try {
    const encoded = value.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(normalized)) as SessionPayload;
  } catch { return null; }
}

export function getSession(expectedTelegramUserId?: string) {
  let value: string | null = null;
  try {
    value = localStorage.getItem(sessionKey) ?? sessionStorage.getItem(sessionKey);
  } catch { /* storage can be disabled by the webview */ }
  if (!value) return null;
  const payload = readSessionPayload(value);
  const expired = !payload?.exp || payload.exp * 1000 <= Date.now() + 5_000;
  const wrongTelegramUser = Boolean(expectedTelegramUserId && payload?.telegramUserId !== expectedTelegramUserId);
  if (!payload?.sub || expired || wrongTelegramUser) {
    clearSession();
    return null;
  }
  try {
    localStorage.setItem(sessionKey, value);
    sessionStorage.removeItem(sessionKey);
  } catch { /* keep the in-memory webview session when persistent storage is unavailable */ }
  return value;
}

export function setSession(value: string) {
  try {
    localStorage.setItem(sessionKey, value);
    sessionStorage.removeItem(sessionKey);
  } catch { sessionStorage.setItem(sessionKey, value); }
}

export function clearSession() {
  try { localStorage.removeItem(sessionKey); } catch { /* no-op */ }
  try { sessionStorage.removeItem(sessionKey); } catch { /* no-op */ }
}

function firstPageCacheKey(params: { filter: LibraryFilter; cursor?: string; q?: string; collectionId?: string; from?: string; to?: string }) {
  if (params.cursor || params.q || params.collectionId || params.from || params.to) return null;
  const session = getSession();
  const userId = session ? readSessionPayload(session)?.sub : undefined;
  return userId ? `${fileCachePrefix}.${userId}.${params.filter}` : null;
}

export function getCachedFiles(params: { filter: LibraryFilter; cursor?: string; q?: string; collectionId?: string; from?: string; to?: string }): CachedFiles | null {
  const key = firstPageCacheKey(params);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedFiles;
    if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > 24 * 60 * 60 * 1000 || !Array.isArray(cached.data?.items)) {
      localStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch { return null; }
}

function cacheFiles(params: { filter: LibraryFilter; cursor?: string; q?: string; collectionId?: string; from?: string; to?: string }, data: PaginatedFiles) {
  const key = firstPageCacheKey(params);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data } satisfies CachedFiles)); } catch { /* cache is an optional acceleration */ }
}

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
  subscription: () => request<SubscriptionStatus>("/api/subscription"),
  subscriptionCheckout: () => request<{ invoiceLink: string }>("/api/subscription/checkout", { method: "POST" }),
  cancelSubscription: () => request<SubscriptionStatus>("/api/subscription/cancel", { method: "POST" }),
  resumeSubscription: () => request<SubscriptionStatus>("/api/subscription/resume", { method: "POST" }),
  files: async (params: { filter: LibraryFilter; cursor?: string; q?: string; collectionId?: string; from?: string; to?: string }) => {
    const query = new URLSearchParams({ filter: params.filter, limit: "30" });
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.q) query.set("q", params.q);
    if (params.collectionId) query.set("collectionId", params.collectionId);
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    const result = await request<PaginatedFiles>(`/api/files?${query}`);
    cacheFiles(params, result);
    return result;
  },
  collections: () => request<Collection[]>("/api/collections"),
  createCollection: (name: string) => request<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name }) }),
  renameCollection: (id: string, name: string) => request<{ id: string; name: string }>(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteCollection: (id: string) => request<void>(`/api/collections/${id}`, { method: "DELETE" }),
  prepareCollectionDownload: async (id: string) => {
    const result = await request<{ url: string; filename: string; expiresIn: number }>(`/api/collections/${id}/export`, { method: "POST" });
    return { ...result, url: new URL(result.url, API_URL || window.location.origin).toString() };
  },
  shareCollection: (id: string) => request<{ messageId: string; expiresAt: number; link: string }>(`/api/collections/${id}/share`, { method: "POST" }),
  revokeCollectionShares: (id: string) => request<void>(`/api/collections/${id}/shares`, { method: "DELETE" }),
  addFilesToCollections: (fileIds: string[], collectionIds: string[]) => request<{ fileCount: number; collectionIds: string[] }>("/api/collections/files", {
    method: "POST",
    body: JSON.stringify({ fileIds, collectionIds })
  }),
  favorite: (id: string, favorite: boolean) => request<{ id: string; isFavorite: boolean }>(`/api/files/${id}/favorite`, { method: "PATCH", body: JSON.stringify({ favorite }) }),
  deleteFiles: (fileIds: string[]) => request<{ deletedIds: string[]; telegramCleanup: boolean }>("/api/files/delete", {
    method: "POST",
    body: JSON.stringify({ fileIds })
  }),
  prepareShare: (id: string) => request<{ messageId: string; expiresAt: number }>(`/api/files/${id}/share`, { method: "POST" }),
  setCollections: (id: string, collectionIds: string[]) => request<{ collectionIds: string[] }>(`/api/files/${id}/collections`, { method: "PUT", body: JSON.stringify({ collectionIds }) }),
  setTags: (id: string, tags: string[]) => request<{ tags: string[] }>(`/api/files/${id}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }),
  content: async (id: string, variant: "thumbnail" | "original" = "original", download = false) => {
    const token = getSession();
    const response = await fetch(`${API_URL}/api/files/${id}/content?variant=${variant}&download=${download}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("File unavailable");
    return response.blob();
  },
  previewUrl: async (id: string) => {
    const result = await request<{ token: string; expiresIn: number }>(`/api/files/${id}/preview-token`, { method: "POST" });
    return `${API_URL}/api/files/${id}/preview?access=${encodeURIComponent(result.token)}`;
  },
  sharedCollection: (token: string, cursor?: string) => request<SharedCollectionPage>("/api/shared-collections/open", {
    method: "POST",
    body: JSON.stringify({ token, cursor, limit: 30 })
  }),
  receivedCollections: () => request<ReceivedCollection[]>("/api/shared-collections/received"),
  receivedCollection: (grantId: string, cursor?: string) => {
    const query = new URLSearchParams({ limit: "30" });
    if (cursor) query.set("cursor", cursor);
    return request<SharedCollectionPage>(`/api/shared-collections/received/${grantId}?${query}`);
  },
  receivedContent: async (grantId: string, id: string, variant: "thumbnail" | "original" = "original", download = false) => {
    const token = getSession();
    const response = await fetch(`${API_URL}/api/shared-collections/received/${grantId}/files/${id}/content?variant=${variant}&download=${download}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) throw new Error("Shared file unavailable");
    return response.blob();
  },
  sharedContent: async (id: string, shareToken: string, variant: "thumbnail" | "original" = "original", download = false) => {
    const token = getSession();
    const response = await fetch(`${API_URL}/api/shared-collections/files/${id}/content?variant=${variant}&download=${download}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-index-share-token": shareToken
      }
    });
    if (!response.ok) throw new Error("Shared file unavailable");
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
