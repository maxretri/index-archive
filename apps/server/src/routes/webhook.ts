import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Services, TelegramUpdate } from "../types.js";
import { ingestMessage } from "../telegram/ingest.js";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function webhookRoutes(app: FastifyInstance, services: Services) {
  app.post("/telegram/webhook", async (request, reply) => {
    const secret = request.headers["x-telegram-bot-api-secret-token"];
    if (typeof secret !== "string" || !safeEqual(secret, services.config.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.code(401).send({ ok: false });
    }
    const update = request.body as TelegramUpdate;
    if (update?.message) await ingestMessage(services, update.message, true);
    return reply.send({ ok: true });
  });
}
