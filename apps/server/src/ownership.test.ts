import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { buildApp } from "./app.js";
import { createSession } from "./security/session.js";

const config: Config = {
  BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
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

  it("rejects webhook requests without Telegram's configured secret", async () => {
    const db = { from: () => { throw new Error("must not query"); } };
    const app = await buildApp(config, db as never);
    const response = await app.inject({ method: "POST", url: "/telegram/webhook", payload: { update_id: 1 } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
