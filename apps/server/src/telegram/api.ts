import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { TelegramMessage } from "../types.js";

interface TelegramEnvelope<T> { ok: boolean; result?: T; description?: string }

async function telegramCall<T>(config: Config, method: string, body?: BodyInit, headers?: HeadersInit): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, {
    method: "POST",
    body,
    headers
  });
  const envelope = await response.json() as TelegramEnvelope<T>;
  if (!response.ok || !envelope.ok || envelope.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${envelope.description ?? response.statusText}`);
  }
  return envelope.result;
}

export async function sendSavedReply(config: Config, chatId: number, messageId: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    reply_to_message_id: messageId,
    text: "SAVED TO INDEX.",
    reply_markup: { inline_keyboard: [[{ text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }]] }
  }), { "content-type": "application/json" });
}

export async function sendMediaGroupSavedReply(config: Config, chatId: number, messageId: number, itemCount: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    reply_to_message_id: messageId,
    text: `GROUP SAVED TO INDEX.\n${itemCount} ITEMS INDEXED.`,
    reply_markup: { inline_keyboard: [[{ text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }]] }
  }), { "content-type": "application/json" });
}

export async function sendWelcomeReply(config: Config, chatId: number) {
  const text = [
    "INDEX",
    "",
    "EN",
    "Forward or send photos, videos, documents, and audio here. They’ll appear in your private archive.",
    "",
    "RU",
    "Отправляйте или пересылайте сюда фото, видео, документы и аудио. Они появятся в вашем личном архиве.",
    "",
    "We only index files you explicitly send. We never read your chats.",
    "Мы индексируем только то, что вы отправляете. Мы не читаем ваши чаты."
  ].join("\n");

  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[{ text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }]] }
  }), { "content-type": "application/json" });
}

interface PreparedInlineMessage {
  id: string;
  expiration_date: number;
}

export async function preparePhotoShare(config: Config, telegramUserId: number, telegramFileId: string) {
  return telegramCall<PreparedInlineMessage>(config, "savePreparedInlineMessage", JSON.stringify({
    user_id: telegramUserId,
    result: {
      type: "photo",
      id: randomUUID(),
      photo_file_id: telegramFileId
    },
    allow_user_chats: true,
    allow_bot_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true
  }), { "content-type": "application/json" });
}

export async function sendUploadToTelegram(
  config: Config,
  chatId: number,
  file: { bytes: Buffer; filename: string; mimeType: string }
): Promise<TelegramMessage> {
  const isPhoto = file.mimeType.startsWith("image/") && !file.mimeType.includes("gif");
  const isVideo = file.mimeType.startsWith("video/");
  const isAudio = file.mimeType.startsWith("audio/");
  const field = isPhoto ? "photo" : isVideo ? "video" : isAudio ? "audio" : "document";
  const method = isPhoto ? "sendPhoto" : isVideo ? "sendVideo" : isAudio ? "sendAudio" : "sendDocument";
  const form = new FormData();
  form.set("chat_id", String(chatId));
  const bytes = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
  form.set(field, new Blob([bytes], { type: file.mimeType }), file.filename);
  return telegramCall<TelegramMessage>(config, method, form);
}

export async function resolveTelegramFile(config: Config, fileId: string) {
  const form = new URLSearchParams({ file_id: fileId });
  const file = await telegramCall<{ file_path?: string }>(config, "getFile", form);
  if (!file.file_path) throw new Error("Telegram did not return a file path");
  return `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
}

export async function configureTelegramBot(config: Config, webhookUrl: string) {
  const webhook = await telegramCall<boolean>(config, "setWebhook", JSON.stringify({
    url: webhookUrl,
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false
  }), { "content-type": "application/json" });
  const menu = await telegramCall<boolean>(config, "setChatMenuButton", JSON.stringify({
    menu_button: { type: "web_app", text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }
  }), { "content-type": "application/json" });
  return webhook && menu;
}
