import type { FileType } from "@index/shared";
import type { Services, TelegramFile, TelegramMessage, TelegramPhotoSize, TelegramUser } from "../types.js";
import { sendSavedReply } from "./api.js";

interface NormalizedMedia {
  telegramFileId: string;
  thumbnailFileId: string | null;
  telegramFileUniqueId: string;
  fileType: FileType;
  mimeType: string | null;
  filename: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  source: Record<string, unknown>;
}

function normalizeAttached(file: TelegramFile, fileType: Exclude<FileType, "photo">): NormalizedMedia {
  return {
    telegramFileId: file.file_id,
    thumbnailFileId: file.thumbnail?.file_id ?? null,
    telegramFileUniqueId: file.file_unique_id,
    fileType,
    mimeType: file.mime_type ?? null,
    filename: file.file_name ?? null,
    fileSize: file.file_size ?? null,
    width: file.width ?? null,
    height: file.height ?? null,
    duration: file.duration ?? null,
    source: { thumbnail: file.thumbnail ?? null }
  };
}

export function normalizeMedia(message: TelegramMessage): NormalizedMedia | null {
  if (message.photo?.length) {
    const sorted = [...message.photo].sort((a, b) => a.width * a.height - b.width * b.height);
    const original = sorted.at(-1)!;
    const thumbnail = sorted.find((item) => item.width >= 320) ?? sorted[0] as TelegramPhotoSize;
    return {
      telegramFileId: original.file_id,
      thumbnailFileId: thumbnail.file_id,
      telegramFileUniqueId: original.file_unique_id,
      fileType: "photo",
      mimeType: "image/jpeg",
      filename: null,
      fileSize: original.file_size ?? null,
      width: original.width,
      height: original.height,
      duration: null,
      source: { sizes: sorted.map(({ file_id, file_unique_id, width, height, file_size }) => ({ file_id, file_unique_id, width, height, file_size })) }
    };
  }
  if (message.video) return normalizeAttached(message.video, "video");
  if (message.document) return normalizeAttached(message.document, "document");
  if (message.audio) return normalizeAttached(message.audio, "audio");
  return null;
}

export async function upsertUser(services: Services, user: TelegramUser) {
  const { data, error } = await services.db.from("users").upsert({
    telegram_user_id: user.id,
    first_name: user.first_name,
    last_name: user.last_name ?? null,
    username: user.username ?? null,
    language_code: user.language_code ?? null
  }, { onConflict: "telegram_user_id" }).select("id, telegram_user_id, first_name, username").single();
  if (error) throw error;
  return data as { id: string; telegram_user_id: number; first_name: string; username: string | null };
}

export async function ingestMessage(services: Services, message: TelegramMessage, replyToUser = true) {
  if (!message.from || message.from.is_bot || message.chat.type !== "private") return null;
  const media = normalizeMedia(message);
  if (!media) return null;

  const user = await upsertUser(services, message.from);
  const { data, error } = await services.db.from("files").upsert({
    user_id: user.id,
    telegram_user_id: message.from.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    telegram_file_id: media.telegramFileId,
    telegram_thumbnail_file_id: media.thumbnailFileId,
    telegram_file_unique_id: media.telegramFileUniqueId,
    file_type: media.fileType,
    mime_type: media.mimeType,
    filename: media.filename,
    file_size: media.fileSize,
    width: media.width,
    height: media.height,
    duration: media.duration,
    caption: message.caption ?? null,
    original_metadata: media.source,
    created_at: new Date(message.date * 1000).toISOString()
  }, { onConflict: "telegram_chat_id,telegram_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw error;

  if (data && replyToUser) await sendSavedReply(services.config, message.chat.id, message.message_id);
  return data as { id: string } | null;
}
