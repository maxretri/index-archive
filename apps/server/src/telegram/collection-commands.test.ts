import { afterEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../types.js";
import { handleCollectionCallback, parseBotCommand } from "./collection-commands.js";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram collection commands", () => {
  it("parses commands, bot suffixes and collection names", () => {
    expect(parseBotCommand("/collections")).toEqual({ name: "collections", argument: "" });
    expect(parseBotCommand("/newcollection@indexarchivebot China visa")).toEqual({
      name: "newcollection",
      argument: "China visa"
    });
    expect(parseBotCommand("regular message")).toBeNull();
  });

  it("cannot activate a collection that is outside the callback user's archive", async () => {
    const filters: Array<[string, unknown]> = [];
    let updated = false;
    const user = {
      id: "81a41446-c8ce-4b53-a8a7-9080c5b31ba1",
      telegram_user_id: 99112233,
      first_name: "Mara",
      username: null,
      active_collection_id: null
    };
    const database = {
      from(table: string) {
        if (table === "users") return {
          upsert() { return this; }, select() { return this; },
          single() { return Promise.resolve({ data: user, error: null }); },
          update() { updated = true; return this; },
          eq() { return this; }
        };
        return {
          select() { return this; },
          eq(column: string, value: unknown) { filters.push([column, value]); return this; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); }
        };
      }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })));
    const services = {
      db: database,
      config: { BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi" }
    } as unknown as Services;

    await handleCollectionCallback(services, {
      id: "callback-1",
      from: { id: 99112233, first_name: "Mara" },
      message: { message_id: 10, chat: { id: 99112233, type: "private" } },
      data: "index:collection:da3ad9ee-05dc-4844-8941-6b764e431406"
    });

    expect(filters).toContainEqual(["user_id", user.id]);
    expect(updated).toBe(false);
  });
});
