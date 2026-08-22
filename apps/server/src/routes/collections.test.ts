import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { buildApp } from "../app.js";
import { createCollectionExportToken, createSession } from "../security/session.js";

const config: Config = {
  BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
  BOT_USERNAME: "indexarchivebot",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-is-long",
  MINI_APP_URL: "https://index.example.com",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",
  SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-characters",
  SERVER_HOST: "127.0.0.1", SERVER_PORT: 4000, WEB_ORIGIN: "https://index.example.com",
  MAX_UPLOAD_BYTES: 1024, AUTH_MAX_AGE_SECONDS: 600
};

const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";

afterEach(() => vi.unstubAllGlobals());

class CollectionMutation {
  filters: Array<[string, unknown]> = [];
  updated: unknown;
  deleted = false;

  constructor(private result: unknown, private error: unknown = null) {}
  update(value: unknown) { this.updated = value; return this; }
  delete() { this.deleted = true; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  select() { return this; }
  maybeSingle() { return Promise.resolve({ data: this.result, error: this.error }); }
}

async function session() {
  return createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);
}

describe("collection management", () => {
  it("renames only a collection owned by the signed-in user", async () => {
    const query = new CollectionMutation({ id: collectionId, name: "TRAVEL" });
    const app = await buildApp(config, { from: () => query } as never);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}`,
      headers: { authorization: `Bearer ${await session()}` },
      payload: { name: "  Travel  " }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: collectionId, name: "TRAVEL" });
    expect(query.updated).toEqual({ name: "TRAVEL" });
    expect(query.filters).toContainEqual(["user_id", userId]);
    expect(query.filters).toContainEqual(["id", collectionId]);
    await app.close();
  });

  it("does not rename a collection outside the signed-in user's archive", async () => {
    const query = new CollectionMutation(null);
    const app = await buildApp(config, { from: () => query } as never);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}`,
      headers: { authorization: `Bearer ${await session()}` },
      payload: { name: "PRIVATE" }
    });

    expect(response.statusCode).toBe(404);
    expect(query.filters).toContainEqual(["user_id", userId]);
    await app.close();
  });

  it("returns a clear conflict when the user already has that collection name", async () => {
    const query = new CollectionMutation(null, { code: "23505" });
    const app = await buildApp(config, { from: () => query } as never);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}`,
      headers: { authorization: `Bearer ${await session()}` },
      payload: { name: "WORK" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Collection already exists" });
    await app.close();
  });

  it("deletes only the owner's virtual collection", async () => {
    const query = new CollectionMutation({ id: collectionId });
    const app = await buildApp(config, { from: () => query } as never);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}`,
      headers: { authorization: `Bearer ${await session()}` }
    });

    expect(response.statusCode).toBe(204);
    expect(query.deleted).toBe(true);
    expect(query.filters).toContainEqual(["user_id", userId]);
    expect(query.filters).toContainEqual(["id", collectionId]);
    await app.close();
  });
});

describe("collection ZIP export", () => {
  it("creates a short-lived download only for the collection owner", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const database = {
      from(table: string) {
        let head = false;
        return {
          select(_columns: string, options?: { head?: boolean }) { head = Boolean(options?.head); return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          maybeSingle() {
            return Promise.resolve({ data: table === "collections" ? { id: collectionId, name: "SUMMER 2026" } : null, error: null });
          },
          then(onfulfilled: (value: { count: number; error: null }) => unknown) {
            if (!head) throw new Error("Unexpected database await");
            return Promise.resolve({ count: 2, error: null }).then(onfulfilled);
          }
        };
      }
    };
    const app = await buildApp(config, database as never);
    const response = await app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/export`,
      headers: { authorization: `Bearer ${await session()}` }
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{ url: string; filename: string; expiresIn: number }>();
    expect(result.filename).toBe("INDEX-SUMMER-2026.zip");
    expect(result.expiresIn).toBe(600);
    expect(result.url).toMatch(new RegExp(`^/api/collections/${collectionId}/download\\?access=`));
    expect(filters).toContainEqual(["collections", "user_id", userId]);
    expect(filters).toContainEqual(["collection_files", "user_id", userId]);
    await app.close();
  });

  it("streams the owner's Telegram files into a ZIP without storing the archive", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const database = {
      from(table: string) {
        return {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          order() { return this; },
          limit() {
            return Promise.resolve({
              data: [{ files: {
                telegram_file_id: "zip-photo-file-id",
                filename: "holiday.jpg",
                mime_type: "image/jpeg",
                file_type: "photo",
                file_size: 12,
                created_at: "2026-08-20T10:00:00.000Z"
              } }],
              error: null
            });
          },
          maybeSingle() {
            return Promise.resolve({ data: table === "collections" ? { id: collectionId, name: "SUMMER" } : null, error: null });
          }
        };
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "photos/holiday.jpg" } }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("photo-bytes", { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp(config, database as never);
    const token = await createCollectionExportToken(userId, collectionId, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/download?access=${encodeURIComponent(token)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="INDEX-SUMMER.zip"');
    expect(response.headers["access-control-allow-origin"]).toBe("https://web.telegram.org");
    expect(response.rawPayload.subarray(0, 2).toString()).toBe("PK");
    expect(response.rawPayload.toString("latin1")).toContain("holiday.jpg");
    expect(response.rawPayload.toString("latin1")).toContain("photo-bytes");
    expect(filters).toContainEqual(["collections", "user_id", userId]);
    expect(filters).toContainEqual(["collection_files", "user_id", userId]);
    await app.close();
  });

  it("rejects a download token for a different collection before querying metadata", async () => {
    let queried = false;
    const otherCollectionId = "3d351b7b-28cb-449f-98e8-70e760279089";
    const token = await createCollectionExportToken(userId, otherCollectionId, config.SESSION_SECRET, 60);
    const app = await buildApp(config, { from: () => {
      queried = true;
      throw new Error("Database must not be queried");
    } } as never);
    const response = await app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/download?access=${encodeURIComponent(token)}`
    });

    expect(response.statusCode).toBe(401);
    expect(queried).toBe(false);
    await app.close();
  });
});
