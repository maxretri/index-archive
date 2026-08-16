import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Services, TelegramUpdate } from "../types.js";
import { ingestMessage } from "../telegram/ingest.js";
import { sendWelcomeReply } from "../telegram/api.js";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isStartCommand(text: string | undefined) {
  return typeof text === "string" && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text);
}

export async function webhookRoutes(app: FastifyInstance, services: Services) {
  app.post("/telegram/webhook", async (request, reply) => {
    const secret = request.headers["x-telegram-bot-api-secret-token"];
    if (typeof secret !== "string" || !safeEqual(secret, services.config.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.code(401).send({ ok: false });
    }
    const update = request.body as TelegramUpdate;
    if (update?.message) {
      if (isStartCommand(update.message.text)) {
        await sendWelcomeReply(services.config, update.message.chat.id);
      } else {
        await ingestMessage(services, update.message, true);
      }
    }
    return reply.send({ ok: true });
  });
}
