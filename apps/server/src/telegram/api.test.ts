import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { prepareCollectionShare, preparePhotoShare, sendSharedCollectionOpen } from "./api.js";

const config = {
  BOT_TOKEN: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
  MINI_APP_URL: "https://index.example.com"
} as Config;

afterEach(() => vi.unstubAllGlobals());

describe("prepared Telegram photo sharing", () => {
  it("reuses Telegram's cached photo and enables the native recipient picker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: "prepared-message-id", expiration_date: 1_800_000_300 }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await preparePhotoShare(config, 99112233, "telegram-photo-file-id");

    expect(result.id).toBe("prepared-message-id");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/savePreparedInlineMessage");
    const payload = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: 99112233,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
      result: { type: "photo", photo_file_id: "telegram-photo-file-id" }
    });
  });
});

describe("prepared Telegram collection sharing", () => {
  it("shares the newest collection photo as a full Telegram cover", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: "prepared-collection-id", expiration_date: 1_800_000_300 }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const link = "https://t.me/indexarchivebot?start=collection_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
    const result = await prepareCollectionShare(config, 99112233, { name: "TRAVEL", itemCount: 12 }, link, "latest-photo-file-id");

    expect(result.id).toBe("prepared-collection-id");
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as Record<string, any>;
    expect(payload).toMatchObject({
      user_id: 99112233,
      allow_user_chats: true,
      result: {
        type: "photo",
        photo_file_id: "latest-photo-file-id",
        reply_markup: { inline_keyboard: [[{ text: "OPEN COLLECTION", url: link }]] }
      }
    });
    expect(payload.result.caption).toContain("INDEX COLLECTION · TRAVEL");
    expect(payload.result.caption).toContain(link);
  });

  it("uses the INDEX editorial cover when a collection has no photos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: "prepared-collection-id", expiration_date: 1_800_000_300 }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const link = "https://t.me/indexarchivebot?start=collection_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
    await prepareCollectionShare(config, 99112233, { name: "DOCUMENTS", itemCount: 3 }, link);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as Record<string, any>;
    expect(payload.result).toMatchObject({
      type: "photo",
      photo_url: "https://index.example.com/brand/index-collection-cover.jpg",
      thumbnail_url: "https://index.example.com/brand/index-collection-cover.jpg"
    });
  });

  it("opens the exact shared collection from the recipient's private bot chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 12, chat: { id: 99112233, type: "private" } }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

    await sendSharedCollectionOpen(config, 99112233, { name: "TRAVEL", itemCount: 12 }, token);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as Record<string, any>;
    expect(payload).toMatchObject({
      chat_id: 99112233,
      reply_markup: { inline_keyboard: [[{
        text: "OPEN COLLECTION",
        web_app: { url: `https://index.example.com?share=${token}` }
      }]] }
    });
  });
});
