import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { preparePhotoShare } from "./api.js";

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
