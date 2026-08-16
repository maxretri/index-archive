import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Services, TelegramUpdate } from "../types.js";
import { ingestMessage } from "../telegram/ingest.js";
import { sendMediaGroupSavedReply, sendWelcomeReply } from "../telegram/api.js";
import { handleCollectionCallback, handleCollectionCommand } from "../telegram/collection-commands.js";
import { MediaGroupReplyBatcher } from "../telegram/media-group-batcher.js";
import { handlePlusPreCheckout, handleSuccessfulPlusPayment } from "../telegram/payments.js";
import { handleBillingCommand } from "../telegram/support.js";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isStartCommand(text: string | undefined) {
  return typeof text === "string" && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text);
}

export async function webhookRoutes(app: FastifyInstance, services: Services) {
  const mediaGroups = new MediaGroupReplyBatcher(
    (chatId, messageId, count, collectionName) => sendMediaGroupSavedReply(services.config, chatId, messageId, count, collectionName),
    (error) => app.log.error({ err: error }, "Failed to send media group summary")
  );
  app.addHook("onClose", async () => mediaGroups.close());

  app.post("/telegram/webhook", async (request, reply) => {
    const secret = request.headers["x-telegram-bot-api-secret-token"];
    if (typeof secret !== "string" || !safeEqual(secret, services.config.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.code(401).send({ ok: false });
    }
    const update = request.body as TelegramUpdate;
    if (update?.pre_checkout_query) {
      await handlePlusPreCheckout(services, update.pre_checkout_query);
      return reply.send({ ok: true });
    }
    if (update?.callback_query) await handleCollectionCallback(services, update.callback_query);
    if (update?.message) {
      if (update.message.successful_payment) {
        await handleSuccessfulPlusPayment(services, update.message);
      } else if (isStartCommand(update.message.text)) {
        await sendWelcomeReply(services.config, update.message.chat.id);
      } else if (await handleBillingCommand(services, update.message)) {
        // Billing commands and support requests are never ingested.
      } else if (await handleCollectionCommand(services, update.message)) {
        // Collection commands are complete bot interactions and are not ingested.
      } else if (update.message.media_group_id) {
        const indexed = await ingestMessage(services, update.message, false);
        if (indexed) {
          mediaGroups.add(
            `${update.message.chat.id}:${update.message.media_group_id}`,
            update.message.chat.id,
            update.message.message_id,
            indexed.collectionName
          );
        }
      } else {
        await ingestMessage(services, update.message, true);
      }
    }
    return reply.send({ ok: true });
  });
}
