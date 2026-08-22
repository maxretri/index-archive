import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { buildApp } from "../app.js";
import { createFilePreviewToken, createSession } from "../security/session.js";
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

describe("streaming file preview", () => {
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

  it("streams video byte ranges so playback can begin before the whole file downloads", async () => {
    const query = {
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        return Promise.resolve({
          data: { telegram_file_id: "unique-video-file-id", mime_type: "video/mp4", filename: "clip.mp4" },
          error: null
        });
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "videos/clip.mp4" } }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("video-chunk", {
        status: 206,
        headers: { "content-type": "video/mp4", "content-range": "bytes 0-10/5000000", "content-length": "11", "accept-ranges": "bytes" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp(config, { from: () => query } as never);
    const fileId = "443f563f-e718-47ca-898c-31799594bdc3";
    const token = await createFilePreviewToken("user-id", fileId, config.SESSION_SECRET, 60);
    const response = await app.inject({
      method: "GET",
      url: `/api/files/${fileId}/preview?access=${encodeURIComponent(token)}`,
      headers: { range: "bytes=0-10" }
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(response.headers["content-range"]).toBe("bytes 0-10/5000000");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { range: "bytes=0-10" } });
    await app.close();
  });
});

describe("file deletion", () => {
  const userId = "b8dd939e-b670-4208-b845-a1aa0f299c66";
  const fileId = "ca02001b-8f4f-4dfc-b3ff-105bc67615f1";

  function deletionDb(ownedFiles: Array<{ id: string; telegram_chat_id: number; telegram_message_id: number }>) {
    let deletionStarted = false;
    let deleteCalls = 0;
    const ownerFilters: unknown[] = [];
    return {
      state: { get deleteCalls() { return deleteCalls; }, ownerFilters },
      client: {
        from(table: string) {
          if (table !== "files") throw new Error(`Unexpected table ${table}`);
          let mode: "read" | "delete" = "read";
          return {
            select() {
              if (mode === "delete") {
                return Promise.resolve({ data: ownedFiles.map(({ id }) => ({ id })), error: null });
              }
              return this;
            },
            eq(column: string, value: unknown) {
              if (column === "user_id") ownerFilters.push(value);
              return this;
            },
            in() {
              return mode === "read" ? Promise.resolve({ data: ownedFiles, error: null }) : this;
            },
            delete() {
              if (deletionStarted) throw new Error("Duplicate delete");
              deletionStarted = true;
              deleteCalls += 1;
              mode = "delete";
              return this;
            }
          };
        }
      }
    };
  }

  it("rejects deletion without a signed application session before touching the database", async () => {
    let queried = false;
    const app = await buildApp(config, { from: () => {
      queried = true;
      throw new Error("must not query");
    } } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/files/delete",
      payload: { fileIds: [fileId] }
    });

    expect(response.statusCode).toBe(401);
    expect(queried).toBe(false);
    await app.close();
  });

  it("deletes only owner-scoped metadata and removes the Telegram message", async () => {
    const db = deletionDb([{ id: fileId, telegram_chat_id: 100200300, telegram_message_id: 77 }]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200, headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp(config, db.client as never);
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);

    const response = await app.inject({
      method: "POST",
      url: "/api/files/delete",
      headers: { authorization: `Bearer ${token}` },
      payload: { fileIds: [fileId] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deletedIds: [fileId], telegramCleanup: true });
    expect(db.state.deleteCalls).toBe(1);
    expect(db.state.ownerFilters).toEqual([userId, userId]);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/deleteMessages");
    expect(JSON.parse(String(options.body))).toEqual({ chat_id: 100200300, message_ids: [77] });
    await app.close();
  });

  it("refuses the whole request when any file is not owned by the user", async () => {
    const db = deletionDb([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp(config, db.client as never);
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);

    const response = await app.inject({
      method: "POST",
      url: "/api/files/delete",
      headers: { authorization: `Bearer ${token}` },
      payload: { fileIds: [fileId] }
    });

    expect(response.statusCode).toBe(404);
    expect(db.state.deleteCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps deletion successful when Telegram can no longer remove an old message", async () => {
    const db = deletionDb([{ id: fileId, telegram_chat_id: 100200300, telegram_message_id: 77 }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, description: "Bad Request: message can't be deleted"
    }), { status: 400, headers: { "content-type": "application/json" } })));
    const app = await buildApp(config, db.client as never);
    const token = await createSession({ id: userId, telegramUserId: "100200300" }, config.SESSION_SECRET, 60);

    const response = await app.inject({
      method: "POST",
      url: "/api/files/delete",
      headers: { authorization: `Bearer ${token}` },
      payload: { fileIds: [fileId] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deletedIds: [fileId], telegramCleanup: false });
    expect(db.state.deleteCalls).toBe(1);
    await app.close();
  });
});
