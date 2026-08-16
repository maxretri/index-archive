import { describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { buildApp } from "../app.js";
import { createSession } from "../security/session.js";

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
