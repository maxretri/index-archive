import { once } from "node:events";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import type { FileType } from "@index/shared";
import type { Config } from "../config.js";
import { resolveTelegramFile } from "../telegram/api.js";

export const MAX_COLLECTION_EXPORT_ITEMS = 500;

export interface CollectionExportFile {
  telegramFileId: string;
  filename: string | null;
  mimeType: string | null;
  fileType: FileType;
  fileSize: number | null;
  createdAt: string;
}

const mimeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "application/pdf": ".pdf",
  "application/zip": ".zip"
};

export function collectionZipFilename(collectionName: string) {
  const name = collectionName.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return `INDEX-${name || "COLLECTION"}.zip`;
}

function fallbackExtension(file: CollectionExportFile) {
  if (file.mimeType && mimeExtensions[file.mimeType]) return mimeExtensions[file.mimeType];
  if (file.fileType === "photo") return ".jpg";
  if (file.fileType === "video") return ".mp4";
  if (file.fileType === "audio") return ".audio";
  return ".file";
}

function safeEntryName(value: string) {
  const base = path.basename(value.replace(/\\/g, "/")).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (base || "FILE").slice(0, 180);
}

export function collectionEntryNames(files: CollectionExportFile[]) {
  const used = new Map<string, number>();
  return files.map((file, index) => {
    const date = Number.isFinite(Date.parse(file.createdAt)) ? new Date(file.createdAt).toISOString().slice(0, 10) : "UNDATED";
    const initial = safeEntryName(file.filename ?? `INDEX_${String(index + 1).padStart(4, "0")}_${date}${fallbackExtension(file)}`);
    const extension = path.extname(initial);
    const stem = extension ? initial.slice(0, -extension.length) : initial;
    const key = initial.toLocaleLowerCase("en-US");
    const duplicate = used.get(key) ?? 0;
    used.set(key, duplicate + 1);
    if (!duplicate) return initial;
    let candidate = `${stem} (${duplicate + 1})${extension}`;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      const next = (used.get(key) ?? duplicate + 1) + 1;
      used.set(key, next);
      candidate = `${stem} (${next})${extension}`;
    }
    used.set(candidate.toLocaleLowerCase("en-US"), 1);
    return candidate;
  });
}

export function streamCollectionZip(config: Config, files: CollectionExportFile[]) {
  const output = new PassThrough({ highWaterMark: 64 * 1024 });
  const archive = new ZipArchive({ store: true });
  const abortController = new AbortController();
  const names = collectionEntryNames(files);

  archive.on("error", () => output.destroy(new Error("Collection ZIP failed")));
  archive.on("warning", () => { /* missing sources are reported inside the archive */ });
  archive.pipe(output);
  output.on("close", () => {
    if (!output.readableEnded) {
      abortController.abort();
      archive.abort();
    }
  });

  void (async () => {
    const skipped: string[] = [];
    if (!files.length) {
      archive.append("THIS COLLECTION IS EMPTY.\n", { name: "INDEX_EMPTY_COLLECTION.txt" });
    }
    for (const [index, file] of files.entries()) {
      const name = names[index]!;
      try {
        const telegramUrl = await resolveTelegramFile(config, file.telegramFileId);
        const response = await fetch(telegramUrl, { signal: abortController.signal });
        if (!response.ok || !response.body) throw new Error("Telegram file unavailable");
        const source = Readable.fromWeb(response.body as never);
        archive.append(source, { name, date: new Date(file.createdAt), store: true });
        await once(source, "end");
      } catch {
        if (abortController.signal.aborted) return;
        skipped.push(name);
      }
    }
    if (skipped.length) {
      archive.append([
        "INDEX COULD NOT DOWNLOAD THESE FILES FROM TELEGRAM:",
        "",
        ...skipped,
        "",
        "The official Telegram Bot API cannot download an individual file larger than 20 MB."
      ].join("\n"), { name: "INDEX_EXPORT_ERRORS.txt" });
    }
    await archive.finalize();
  })().catch(() => output.destroy(new Error("Collection ZIP failed")));

  return output;
}
