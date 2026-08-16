import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { TelegramMessage } from "../types.js";

interface TelegramEnvelope<T> { ok: boolean; result?: T; description?: string }
const resolvedFiles = new Map<string, { url: string; expiresAt: number }>();

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

const openIndexMarkup = (config: Config) => ({
  inline_keyboard: [[{ text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }]]
});

export async function sendSavedReply(config: Config, chatId: number, messageId: number, collectionName?: string | null) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    reply_to_message_id: messageId,
    text: collectionName ? `SAVED TO INDEX.\nCOLLECTION · ${collectionName}` : "SAVED TO INDEX.",
    reply_markup: openIndexMarkup(config)
  }), { "content-type": "application/json" });
}

export async function sendMediaGroupSavedReply(config: Config, chatId: number, messageId: number, itemCount: number, collectionName?: string | null) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    reply_to_message_id: messageId,
    text: `GROUP SAVED TO INDEX.\n${itemCount} ITEMS INDEXED.${collectionName ? `\nCOLLECTION · ${collectionName}` : ""}`,
    reply_markup: openIndexMarkup(config)
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
    "Мы индексируем только то, что вы отправляете. Мы не читаем ваши чаты.",
    "",
    "/collections — choose a collection / выбрать коллекцию",
    "/newcollection NAME — create one / создать коллекцию",
    "/nocollection — save without one / сохранять без коллекции"
  ].join("\n");

  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text,
    reply_markup: openIndexMarkup(config)
  }), { "content-type": "application/json" });
}

export async function sendSharedCollectionOpen(
  config: Config,
  chatId: number,
  collection: { name: string; itemCount: number },
  token: string,
  delivery?: { copiedCount: number; truncated: boolean; grantId?: string }
) {
  const separator = config.MINI_APP_URL.includes("?") ? "&" : "?";
  const openParameter = delivery?.grantId
    ? `shared=${encodeURIComponent(delivery.grantId)}`
    : `share=${encodeURIComponent(`collection_${token}`)}`;
  const deliveryText = delivery
    ? `\n${delivery.copiedCount} ${delivery.copiedCount === 1 ? "FILE" : "FILES"} SENT TO THIS CHAT${delivery.truncated ? " · OPEN INDEX FOR THE REST" : ""}`
    : "";
  const libraryText = delivery?.grantId ? "\nADDED TO YOUR SHARED LIBRARY" : "";
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: `SHARED INDEX COLLECTION · ${collection.name}\n${collection.itemCount} ${collection.itemCount === 1 ? "ITEM" : "ITEMS"}${deliveryText}${libraryText}\nREAD ONLY`,
    reply_markup: { inline_keyboard: [[{
      text: delivery?.grantId ? "OPEN IN SHARED" : "OPEN COLLECTION",
      web_app: { url: `${config.MINI_APP_URL}${separator}${openParameter}` }
    }]] }
  }), { "content-type": "application/json" });
}

export async function sendSharedCollectionUnavailable(config: Config, chatId: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: "COLLECTION UNAVAILABLE.\nTHE LINK MAY HAVE BEEN REVOKED OR DELETED.",
    reply_markup: openIndexMarkup(config)
  }), { "content-type": "application/json" });
}

export interface TelegramCollectionChoice { id: string; name: string }

export async function sendCollectionPicker(
  config: Config,
  chatId: number,
  collections: TelegramCollectionChoice[],
  activeCollectionId: string | null
) {
  const active = collections.find((collection) => collection.id === activeCollectionId);
  type InlineButton = { text: string; callback_data?: string; web_app?: { url: string } };
  const rows: InlineButton[][] = collections.map((collection) => [{
    text: `${collection.id === activeCollectionId ? "✓ " : ""}${collection.name}`,
    callback_data: `index:collection:${collection.id}`
  }]);
  rows.push([{ text: "+ NEW COLLECTION", callback_data: "index:collection:new" }]);
  rows.push([{ text: "NO COLLECTION", callback_data: "index:collection:none" }]);
  rows.push([{ text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }]);
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: `CHOOSE WHERE NEW FILES GO.\nACTIVE · ${active?.name ?? "NO COLLECTION"}`,
    reply_markup: { inline_keyboard: rows }
  }), { "content-type": "application/json" });
}

export async function sendCollectionStatus(config: Config, chatId: number, collectionName: string | null) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: collectionName
      ? `ACTIVE COLLECTION · ${collectionName}\nNEW FILES WILL BE ADDED HERE.`
      : "NO ACTIVE COLLECTION.\nNEW FILES WILL STAY IN THE MAIN INDEX.",
    reply_markup: openIndexMarkup(config)
  }), { "content-type": "application/json" });
}

export async function sendNewCollectionPrompt(config: Config, chatId: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: "CREATE A COLLECTION:\n/newcollection TRAVEL\n\nСОЗДАТЬ КОЛЛЕКЦИЮ:\n/newcollection ПУТЕШЕСТВИЯ"
  }), { "content-type": "application/json" });
}

export async function answerCallback(config: Config, callbackQueryId: string, text?: string) {
  return telegramCall<boolean>(config, "answerCallbackQuery", JSON.stringify({
    callback_query_id: callbackQueryId,
    text
  }), { "content-type": "application/json" });
}

export async function deleteTelegramMessages(config: Config, chatId: number, messageIds: number[]) {
  return telegramCall<boolean>(config, "deleteMessages", JSON.stringify({
    chat_id: chatId,
    message_ids: messageIds
  }), { "content-type": "application/json" });
}

export async function copyTelegramMessages(config: Config, chatId: number, fromChatId: number, messageIds: number[]) {
  return telegramCall<Array<{ message_id: number }>>(config, "copyMessages", JSON.stringify({
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_ids: messageIds
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

export async function prepareCollectionShare(
  config: Config,
  telegramUserId: number,
  collection: { name: string; itemCount: number },
  link: string,
  coverTelegramFileId?: string | null
) {
  const message = `INDEX COLLECTION · ${collection.name}\n${collection.itemCount} ${collection.itemCount === 1 ? "ITEM" : "ITEMS"}\n\n${link}`;
  const result = coverTelegramFileId ? {
    type: "photo",
    id: randomUUID(),
    photo_file_id: coverTelegramFileId,
    caption: message,
    reply_markup: { inline_keyboard: [[{ text: "OPEN COLLECTION", url: link }]] }
  } : {
    type: "photo",
    id: randomUUID(),
    photo_url: `${config.MINI_APP_URL.replace(/\/$/, "")}/brand/index-collection-cover.jpg`,
    thumbnail_url: `${config.MINI_APP_URL.replace(/\/$/, "")}/brand/index-collection-cover.jpg`,
    caption: message,
    reply_markup: { inline_keyboard: [[{ text: "OPEN COLLECTION", url: link }]] }
  };
  return telegramCall<PreparedInlineMessage>(config, "savePreparedInlineMessage", JSON.stringify({
    user_id: telegramUserId,
    result,
    allow_user_chats: true,
    allow_bot_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true
  }), { "content-type": "application/json" });
}

export async function createPlusInvoiceLink(config: Config, payload: string) {
  return telegramCall<string>(config, "createInvoiceLink", JSON.stringify({
    title: "INDEX PLUS",
    description: "Ad-free INDEX membership. Renews every 30 days until canceled.",
    payload,
    currency: "XTR",
    prices: [{ label: "INDEX PLUS · 30 DAYS", amount: 299 }],
    subscription_period: 2_592_000
  }), { "content-type": "application/json" });
}

export async function answerPreCheckout(config: Config, queryId: string, ok: boolean, errorMessage?: string) {
  return telegramCall<boolean>(config, "answerPreCheckoutQuery", JSON.stringify({
    pre_checkout_query_id: queryId,
    ok,
    ...(ok ? {} : { error_message: errorMessage ?? "INDEX PLUS checkout is unavailable." })
  }), { "content-type": "application/json" });
}

export async function editPlusSubscription(config: Config, telegramUserId: number, chargeId: string, isCanceled: boolean) {
  return telegramCall<boolean>(config, "editUserStarSubscription", JSON.stringify({
    user_id: telegramUserId,
    telegram_payment_charge_id: chargeId,
    is_canceled: isCanceled
  }), { "content-type": "application/json" });
}

export async function sendPlusActiveReply(config: Config, chatId: number, periodEnd: Date) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: `INDEX PLUS ACTIVE.\n299 STARS / 30 DAYS.\nACTIVE UNTIL · ${periodEnd.toISOString().slice(0, 10)}`,
    reply_markup: openIndexMarkup(config)
  }), { "content-type": "application/json" });
}

export async function sendPaymentSupportReply(config: Config, chatId: number, received: boolean) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: received
      ? "PAYMENT SUPPORT REQUEST RECEIVED.\nWE WILL REVIEW IT MANUALLY."
      : "PAYMENT SUPPORT\nUSE: /paysupport DESCRIBE YOUR PAYMENT ISSUE\n\nDO NOT SEND PASSWORDS OR CARD DETAILS. TELEGRAM SUPPORT CANNOT RESOLVE INDEX PURCHASES."
  }), { "content-type": "application/json" });
}

export async function sendTermsReply(config: Config, chatId: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: "INDEX TERMS & SUBSCRIPTION TERMS",
    reply_markup: { inline_keyboard: [[{ text: "OPEN TERMS", url: `${config.MINI_APP_URL.replace(/\/$/, "")}/terms.html` }]] }
  }), { "content-type": "application/json" });
}

export async function sendPlusOpenReply(config: Config, chatId: number) {
  return telegramCall<TelegramMessage>(config, "sendMessage", JSON.stringify({
    chat_id: chatId,
    text: "INDEX PLUS\n299 STARS / 30 DAYS\nRECURRING · CANCEL ANYTIME",
    reply_markup: { inline_keyboard: [[{ text: "OPEN INDEX PLUS", web_app: { url: `${config.MINI_APP_URL}${config.MINI_APP_URL.includes("?") ? "&" : "?"}screen=plus` } }]] }
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
  const cached = resolvedFiles.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const form = new URLSearchParams({ file_id: fileId });
  const file = await telegramCall<{ file_path?: string }>(config, "getFile", form);
  if (!file.file_path) throw new Error("Telegram did not return a file path");
  const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
  resolvedFiles.set(fileId, { url, expiresAt: Date.now() + 50 * 60 * 1000 });
  return url;
}

export async function configureTelegramBot(config: Config, webhookUrl: string) {
  const webhook = await telegramCall<boolean>(config, "setWebhook", JSON.stringify({
    url: webhookUrl,
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "pre_checkout_query"],
    drop_pending_updates: false
  }), { "content-type": "application/json" });
  const menu = await telegramCall<boolean>(config, "setChatMenuButton", JSON.stringify({
    menu_button: { type: "web_app", text: "OPEN INDEX", web_app: { url: config.MINI_APP_URL } }
  }), { "content-type": "application/json" });
  const commands = await telegramCall<boolean>(config, "setMyCommands", JSON.stringify({ commands: [
    { command: "start", description: "Open INDEX" },
    { command: "collections", description: "Choose an active collection" },
    { command: "newcollection", description: "Create and select a collection" },
    { command: "nocollection", description: "Save to the main index" },
    { command: "plus", description: "Open INDEX PLUS" },
    { command: "paysupport", description: "Payment support" },
    { command: "terms", description: "Terms and subscription terms" }
  ] }), { "content-type": "application/json" });
  return webhook && menu && commands;
}
