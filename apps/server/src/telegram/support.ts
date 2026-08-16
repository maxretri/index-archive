import { z } from "zod";
import type { Services, TelegramMessage } from "../types.js";
import { sendPaymentSupportReply, sendPlusOpenReply, sendTermsReply } from "./api.js";
import { parseBotCommand } from "./collection-commands.js";
import { upsertUser } from "./ingest.js";

export async function handleBillingCommand(services: Services, message: TelegramMessage) {
  const command = parseBotCommand(message.text);
  if (!command || !message.from || message.from.is_bot || message.chat.type !== "private") return false;
  if (command.name === "terms") {
    await sendTermsReply(services.config, message.chat.id);
    return true;
  }
  if (command.name === "plus") {
    await sendPlusOpenReply(services.config, message.chat.id);
    return true;
  }
  if (!["paysupport", "support"].includes(command.name)) return false;
  const parsed = z.string().trim().min(3).max(1000).safeParse(command.argument);
  if (!parsed.success) {
    await sendPaymentSupportReply(services.config, message.chat.id, false);
    return true;
  }
  const user = await upsertUser(services, message.from);
  const { error } = await services.db.from("payment_support_requests").insert({
    user_id: user.id,
    telegram_user_id: message.from.id,
    message: parsed.data
  });
  if (error) throw error;
  await sendPaymentSupportReply(services.config, message.chat.id, true);
  return true;
}
