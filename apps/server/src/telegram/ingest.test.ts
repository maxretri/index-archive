import { describe, expect, it } from "vitest";
import { normalizeMedia } from "./ingest.js";

describe("Telegram media normalization", () => {
  it("uses the largest photo as the original and a smaller Telegram size as thumbnail", () => {
    const media = normalizeMedia({
      message_id: 4, date: 1800000000, chat: { id: 8, type: "private" },
      photo: [
        { file_id: "small", file_unique_id: "u1", width: 90, height: 120, file_size: 1000 },
        { file_id: "medium", file_unique_id: "u2", width: 480, height: 640, file_size: 9000 },
        { file_id: "original", file_unique_id: "u3", width: 1440, height: 1920, file_size: 80000 }
      ]
    });
    expect(media).toMatchObject({ telegramFileId: "original", thumbnailFileId: "medium", width: 1440, height: 1920, fileType: "photo" });
  });

  it("indexes a Telegram PDF as a document without copying its binary", () => {
    const media = normalizeMedia({
      message_id: 5,
      date: 1_800_000_000,
      chat: { id: 8, type: "private" },
      document: {
        file_id: "telegram-pdf-file-id",
        file_unique_id: "pdf-unique-id",
        file_name: "China visa.pdf",
        mime_type: "application/pdf",
        file_size: 84_221
      }
    });

    expect(media).toMatchObject({
      telegramFileId: "telegram-pdf-file-id",
      fileType: "document",
      mimeType: "application/pdf",
      filename: "China visa.pdf",
      fileSize: 84_221
    });
  });
});
