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

  it("resolves the capability and replies with the exact collection opener", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const ownerId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    const collectionId = "da3ad9ee-05dc-4844-8941-6b764e431406";
    const database = {
      from(table: string) {
        const chain = {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          is(column: string, value: unknown) { filters.push([table, column, value]); return this; },
          maybeSingle() {
            return Promise.resolve({
              data: table === "collection_shares"
                ? { user_id: ownerId, collection_id: collectionId }
                : { id: collectionId, name: "TRAVEL" },
              error: null
            });
          },
          then(onfulfilled: (value: { count: number; error: null }) => unknown) {
            return Promise.resolve({ count: 4, error: null }).then(onfulfilled);
          }
        };
        return chain;
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 12, chat: { id: 445566, type: "private" } }
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
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as Record<string, any>;
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://index.example.com?share=${token}`);
  });
});
