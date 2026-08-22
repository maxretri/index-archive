import { describe, expect, it } from "vitest";
import { collectionEntryNames, collectionZipFilename, type CollectionExportFile } from "./collection-export.js";

function file(filename: string | null): CollectionExportFile {
  return {
    telegramFileId: "telegram-file",
    filename,
    mimeType: "image/jpeg",
    fileType: "photo",
    fileSize: 100,
    createdAt: "2026-08-22T10:00:00.000Z"
  };
}

describe("collection ZIP filenames", () => {
  it("removes paths and gives duplicate files distinct names", () => {
    expect(collectionEntryNames([
      file("../../private/photo.jpg"),
      file("photo.jpg"),
      file("photo.jpg")
    ])).toEqual(["photo.jpg", "photo (2).jpg", "photo (3).jpg"]);
  });

  it("creates useful dated names for Telegram photos without filenames", () => {
    expect(collectionEntryNames([file(null)])).toEqual(["INDEX_0001_2026-08-22.jpg"]);
  });

  it("keeps the response filename safe for Content-Disposition", () => {
    expect(collectionZipFilename("Summer / 2026")).toBe("INDEX-Summer-2026.zip");
    expect(collectionZipFilename("ПУТЕШЕСТВИЯ")).toBe("INDEX-COLLECTION.zip");
  });
});
