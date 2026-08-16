import { afterEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../types.js";
import { hashCollectionShareToken } from "../security/collection-share.js";
import { handleSharedCollectionStart, sharedCollectionTokenFromStart } from "./shared-collection-start.js";

const token = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
afterEach(() => vi.unstubAllGlobals());

describe("shared collection bot deep links", () => {
  it("extracts a capability from Telegram's /start payload", () => {
    expect(sharedCollectionTokenFromStart(`/start collection_${token}`)).toBe(token);
    expect(sharedCollectionTokenFromStart(`/start@indexarchivebot collection_${token}`)).toBe(token);
  });

  it("does not confuse regular or malformed /start commands with collection links", () => {
    expect(sharedCollectionTokenFromStart("/start")).toBeNull();
    expect(sharedCollectionTokenFromStart("/start collection_short")).toBeNull();
    expect(sharedCollectionTokenFromStart(`/start other_${token}`)).toBeNull();
  });

  it("accepts the share, copies sorted files, and opens the recipient's persistent Shared library", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const ownerId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const shareId = "7a3d59ad-cd18-47cc-9b84-fd754bb0caf4";
    const grantId = "8c0610d7-895d-4db8-a9c6-e8a079caef50";
    const upserts: Array<[string, unknown]> = [];
    const inserts: Array<[string, unknown]> = [];
    const database = {
      from(table: string) {
        let selection = "";
        const chain = {
          select(columns: string, options?: { head?: boolean }) {
            selection = options?.head ? "count" : columns.includes("files!inner") ? "memberships" : "single";
            return this;
          },
          upsert(value: unknown) { upserts.push([table, value]); return this; },
          insert(value: unknown) { inserts.push([table, value]); return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          is(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          order() { return this; },
          limit() {
            if (selection !== "memberships") return this;
            return Promise.resolve({
              data: [{
                created_at: "2026-08-16T10:00:00.000Z",
                files: { telegram_chat_id: 112233, telegram_message_id: 92 }
              }, {
                created_at: "2026-08-16T10:01:00.000Z",
                files: { telegram_chat_id: 112233, telegram_message_id: 91 }
              }],
              error: null
            });
          },
          maybeSingle() {
            return Promise.resolve({
              data: table === "collection_shares"
                ? { id: shareId, user_id: ownerId, collection_id: collectionId }
                : { id: collectionId, name: "TRAVEL" },
              error: null
            });
          },
          single() {
            return Promise.resolve({
              data: table === "users"
                ? { id: recipientId, telegram_user_id: 445566, first_name: "Nora", username: null, active_collection_id: null }
                : { id: grantId },
              error: null
            });
          },
          then(onfulfilled: (value: { count: number; error: null }) => unknown) {
            if (selection !== "count") throw new Error(`Unexpected await for ${selection}`);
            return Promise.resolve({ count: 4, error: null }).then(onfulfilled);
          }
        };
        return chain;
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: [{ message_id: 12 }, { message_id: 13 }]
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { message_id: 13, chat: { id: 445566, type: "private" } }
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const services = {
      db: database,
      config: {
        BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
        MINI_APP_URL: "https://index.example.com"
      }
    } as unknown as Services;

    const handled = await handleSharedCollectionStart(services, {
      message_id: 7,
      date: 1_800_000_000,
      chat: { id: 445566, type: "private" },
      from: { id: 445566, first_name: "Nora" },
      text: `/start collection_${token}`
    });

    expect(handled).toBe(true);
    expect(filters).toContainEqual(["collection_shares", "token_hash", hashCollectionShareToken(token)]);
    expect(upserts.some(([table]) => table === "users")).toBe(true);
    expect(inserts).toContainEqual(["collection_share_recipients", expect.objectContaining({
      share_id: shareId,
      collection_id: collectionId,
      owner_user_id: ownerId,
      recipient_user_id: recipientId
    })]);
    const [copyUrl, copyOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(copyUrl).toContain("/copyMessages");
    expect(JSON.parse(String(copyOptions.body))).toEqual({
      chat_id: 445566,
      from_chat_id: 112233,
      message_ids: [91, 92]
    });
    const [, openOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
    const openPayload = JSON.parse(String(openOptions.body)) as Record<string, any>;
    expect(openPayload.text).toContain("2 FILES SENT TO THIS CHAT");
    expect(openPayload.text).toContain("ADDED TO YOUR SHARED LIBRARY");
    expect(openPayload.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://index.example.com?shared=${grantId}`);
  });

  it("does not copy the files again when the same recipient opens the collection twice", async () => {
    const ownerId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const recipientId = "76677226-2cb0-453e-99a4-0db75e4a8751";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const shareId = "7a3d59ad-cd18-47cc-9b84-fd754bb0caf4";
    const grantId = "8c0610d7-895d-4db8-a9c6-e8a079caef50";
    let recipientQueries = 0;
    const updates: unknown[] = [];
    const database = {
      from(table: string) {
        const recipientQuery = table === "collection_share_recipients" ? ++recipientQueries : 0;
        let selection = "";
        return {
          select(columns: string, options?: { head?: boolean }) {
            selection = options?.head ? "count" : columns.includes("files!inner") ? "memberships" : "single";
            return this;
          },
          upsert() { return this; },
          insert() { return this; },
          update(value: unknown) { updates.push(value); return this; },
          eq() { return this; },
          is() { return this; },
          order() { return this; },
          limit() {
            if (selection !== "memberships") return this;
            return Promise.resolve({
              data: [{ created_at: "2026-08-16T10:00:00.000Z", files: { telegram_chat_id: 112233, telegram_message_id: 91 } }],
              error: null
            });
          },
          maybeSingle() {
            if (table === "collection_shares") return Promise.resolve({ data: { id: shareId, user_id: ownerId, collection_id: collectionId }, error: null });
            if (table === "collections") return Promise.resolve({ data: { id: collectionId, name: "TRAVEL" }, error: null });
            if (table === "collection_share_recipients" && recipientQuery === 2) return Promise.resolve({ data: { id: grantId }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === "users") return Promise.resolve({
              data: { id: recipientId, telegram_user_id: 445566, first_name: "Nora", username: null, active_collection_id: null },
              error: null
            });
            if (table === "collection_share_recipients" && recipientQuery === 1) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            }
            return Promise.resolve({ data: { id: grantId }, error: null });
          },
          then(onfulfilled: (value: { count: number; error: null }) => unknown) {
            if (selection !== "count") throw new Error(`Unexpected await for ${selection}`);
            return Promise.resolve({ count: 4, error: null }).then(onfulfilled);
          }
        };
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 20, chat: { id: 445566, type: "private" } }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const services = {
      db: database,
      config: { BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi", MINI_APP_URL: "https://index.example.com" }
    } as unknown as Services;

    const handled = await handleSharedCollectionStart(services, {
      message_id: 8,
      date: 1_800_000_100,
      chat: { id: 445566, type: "private" },
      from: { id: 445566, first_name: "Nora" },
      text: `/start collection_${token}`
    });

    expect(handled).toBe(true);
    expect(updates).toContainEqual({ share_id: shareId, owner_user_id: ownerId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sendMessage");
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, any>;
    expect(payload.text).toContain("FILES WERE NOT SENT AGAIN");
    expect(payload.text).toContain("ALREADY IN YOUR SHARED LIBRARY");
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://index.example.com?shared=${grantId}`);
  });
});
