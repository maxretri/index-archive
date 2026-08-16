import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { buildApp } from "./app.js";
import { createFilePreviewToken, createSession } from "./security/session.js";
import { createCollectionShareToken, hashCollectionShareToken } from "./security/collection-share.js";

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

class QuerySpy implements PromiseLike<{ data: unknown[]; error: null }> {
  filters: Array<[string, unknown]> = [];
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order() { return this; }
  limit() { return this; }
  in() { return this; }
  textSearch() { return this; }
  gte() { return this; }
  lte() { return this; }
  or() { return this; }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled ?? undefined);
  }
}

describe("ownership boundary", () => {
  it("rejects library reads without an application session before querying the database", async () => {
    let queried = false;
    const db = { from: () => { queried = true; throw new Error("must not query"); } };
    const app = await buildApp(config, db as never);
    const response = await app.inject({ method: "GET", url: "/api/files" });
    expect(response.statusCode).toBe(401);
    expect(queried).toBe(false);
    await app.close();
  });

  it("scopes a valid library query to the server-signed internal user id", async () => {
    const queries: QuerySpy[] = [];
    const db = { from: () => { const query = new QuerySpy(); queries.push(query); return query; } };
    const app = await buildApp(config, db as never);
    const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);
    const response = await app.inject({ method: "GET", url: "/api/files", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(queries[0]?.filters).toContainEqual(["user_id", userId]);
    await app.close();
  });

  it("does not prepare a share for a file outside the signed-in user's archive", async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    };
    const app = await buildApp(config, { from: () => query } as never);
    const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "POST",
      url: "/api/files/ca02001b-8f4f-4dfc-b3ff-105bc67615f1/share",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(404);
    expect(filters).toContainEqual(["user_id", userId]);
    await app.close();
  });

  it("scopes PDF preview access to the user embedded in its server-signed token", async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    };
    const app = await buildApp(config, { from: () => query } as never);
    const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const fileId = "ca02001b-8f4f-4dfc-b3ff-105bc67615f1";
    const token = await createFilePreviewToken(userId, fileId, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/files/${fileId}/preview?access=${encodeURIComponent(token)}`
    });

    expect(response.statusCode).toBe(404);
    expect(filters).toContainEqual(["user_id", userId]);
    expect(filters).toContainEqual(["id", fileId]);
    await app.close();
  });

  it("rejects bulk collection changes when any selected file is not owned by the session user", async () => {
    const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const fileId = "ca02001b-8f4f-4dfc-b3ff-105bc67615f1";
    const filters: Array<[string, string, unknown]> = [];
    const database = {
      from(table: string) {
        if (table === "collection_files") throw new Error("must not write memberships");
        const data = table === "collections" ? [{ id: collectionId }] : [];
        const chain = {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          in() { return this; },
          then(onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown) {
            return Promise.resolve({ data, error: null }).then(onfulfilled);
          }
        };
        return chain;
      }
    };
    const app = await buildApp(config, database as never);
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "POST",
      url: "/api/collections/files",
      headers: { authorization: `Bearer ${token}` },
      payload: { fileIds: [fileId], collectionIds: [collectionId] }
    });

    expect(response.statusCode).toBe(400);
    expect(filters).toContainEqual(["files", "user_id", userId]);
    expect(filters).toContainEqual(["collections", "user_id", userId]);
    await app.close();
  });

  it("does not expose a file that is outside the linked shared collection", async () => {
    const ownerId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const fileId = "ca02001b-8f4f-4dfc-b3ff-105bc67615f1";
    const shareToken = createCollectionShareToken();
    const filters: Array<[string, string, unknown]> = [];
    const database = {
      from(table: string) {
        if (table === "files") throw new Error("must not read an unrelated file");
        const chain = {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          is(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          maybeSingle() {
            return Promise.resolve({
              data: table === "collection_shares" ? { id: "share-id", user_id: ownerId, collection_id: collectionId } : null,
              error: null
            });
          }
        };
        return chain;
      }
    };
    const app = await buildApp(config, database as never);
    const session = await createSession({ id: recipientId, telegramUserId: "998877" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/shared-collections/files/${fileId}/content?variant=original`,
      headers: { authorization: `Bearer ${session}`, "x-index-share-token": shareToken }
    });

    expect(response.statusCode).toBe(404);
    expect(filters).toContainEqual(["collection_shares", "token_hash", hashCollectionShareToken(shareToken)]);
    expect(filters).toContainEqual(["collection_files", "collection_id", collectionId]);
    expect(filters).toContainEqual(["collection_files", "file_id", fileId]);
    await app.close();
  });

  it("scopes the persistent Shared library to the signed-in recipient", async () => {
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const filters: Array<[string, string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push(["collection_share_recipients", column, value]); return this; },
      order() { return this; },
      then(onfulfilled: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(onfulfilled);
      }
    };
    const app = await buildApp(config, { from: () => query } as never);
    const session = await createSession({ id: recipientId, telegramUserId: "998877" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: "/api/shared-collections/received",
      headers: { authorization: `Bearer ${session}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(filters).toContainEqual(["collection_share_recipients", "recipient_user_id", recipientId]);
    await app.close();
  });

  it("rejects the Shared library without a signed Telegram session before querying", async () => {
    let queried = false;
    const app = await buildApp(config, { from: () => {
      queried = true;
      throw new Error("must not query");
    } } as never);
    const response = await app.inject({ method: "GET", url: "/api/shared-collections/received" });
    expect(response.statusCode).toBe(401);
    expect(queried).toBe(false);
    await app.close();
  });

  it("does not open a persistent share accepted by a different recipient", async () => {
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const grantId = "8c0610d7-895d-4db8-a9c6-e8a079caef50";
    const filters: Array<[string, string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push(["collection_share_recipients", column, value]); return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    };
    const app = await buildApp(config, { from: () => query } as never);
    const session = await createSession({ id: recipientId, telegramUserId: "998877" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/shared-collections/received/${grantId}`,
      headers: { authorization: `Bearer ${session}` }
    });

    expect(response.statusCode).toBe(404);
    expect(filters).toContainEqual(["collection_share_recipients", "id", grantId]);
    expect(filters).toContainEqual(["collection_share_recipients", "recipient_user_id", recipientId]);
    await app.close();
  });

  it("stops persistent recipient access when the owner revokes sharing", async () => {
    const ownerId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const grantId = "8c0610d7-895d-4db8-a9c6-e8a079caef50";
    const shareId = "7a3d59ad-cd18-47cc-9b84-fd754bb0caf4";
    const filters: Array<[string, string, unknown]> = [];
    const database = {
      from(table: string) {
        return {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          is(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          maybeSingle() {
            return Promise.resolve({
              data: table === "collection_share_recipients" ? {
                id: grantId,
                share_id: shareId,
                collection_id: collectionId,
                owner_user_id: ownerId,
                recipient_user_id: recipientId,
                accepted_at: "2026-08-16T10:00:00.000Z"
              } : null,
              error: null
            });
          }
        };
      }
    };
    const app = await buildApp(config, database as never);
    const session = await createSession({ id: recipientId, telegramUserId: "998877" }, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/shared-collections/received/${grantId}`,
      headers: { authorization: `Bearer ${session}` }
    });

    expect(response.statusCode).toBe(404);
    expect(filters).toContainEqual(["collection_shares", "id", shareId]);
    expect(filters).toContainEqual(["collection_shares", "user_id", ownerId]);
    expect(filters).toContainEqual(["collection_shares", "collection_id", collectionId]);
    expect(filters).toContainEqual(["collection_shares", "revoked_at", null]);
    await app.close();
  });

  it("rejects webhook requests without Telegram's configured secret", async () => {
    const db = { from: () => { throw new Error("must not query"); } };
    const app = await buildApp(config, db as never);
    const response = await app.inject({ method: "POST", url: "/telegram/webhook", payload: { update_id: 1 } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
