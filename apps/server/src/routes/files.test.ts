import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { buildApp } from "../app.js";
import { createFilePreviewToken } from "../security/session.js";
import { fileTypesForFilter } from "./files.js";

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

afterEach(() => vi.unstubAllGlobals());

describe("library type filters", () => {
  it("keeps documents and audio in separate sections", () => {
    expect(fileTypesForFilter("photos")).toEqual(["photo"]);
    expect(fileTypesForFilter("videos")).toEqual(["video"]);
    expect(fileTypesForFilter("files")).toEqual(["document"]);
    expect(fileTypesForFilter("audio")).toEqual(["audio"]);
  });

  it("does not apply a media type to all or favorites", () => {
    expect(fileTypesForFilter("all")).toBeNull();
    expect(fileTypesForFilter("favorites")).toBeNull();
  });
});

describe("PDF streaming preview", () => {
  it("forwards browser byte ranges without buffering the entire PDF", async () => {
    const query = {
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        return Promise.resolve({
          data: { telegram_file_id: "unique-pdf-file-id", mime_type: "application/pdf", filename: "archive.pdf" },
          error: null
        });
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "documents/archive.pdf" } }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("%PDF-streamed", {
        status: 206,
        headers: { "content-type": "application/pdf", "content-range": "bytes 0-12/100", "content-length": "13", "accept-ranges": "bytes" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp(config, { from: () => query } as never);
    const fileId = "ca02001b-8f4f-4dfc-b3ff-105bc67615f1";
    const token = await createFilePreviewToken("user-id", fileId, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/files/${fileId}/preview?access=${encodeURIComponent(token)}`,
      headers: { range: "bytes=0-12" }
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 0-12/100");
    expect(response.body).toBe("%PDF-streamed");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { range: "bytes=0-12" } });
    await app.close();
  });
});
