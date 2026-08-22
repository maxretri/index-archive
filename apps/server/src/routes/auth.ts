import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../types.js";
import { createSession } from "../security/session.js";
import { TelegramAuthError, verifyTelegramInitData } from "../security/telegram-auth.js";
import { upsertUser } from "../telegram/ingest.js";

const bodySchema = z.object({ initData: z.string().min(1).max(16_384) });

export async function authRoutes(app: FastifyInstance, services: Services) {
  app.post("/auth/telegram", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = bodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid authentication payload" });
    try {
      const verified = verifyTelegramInitData(body.data.initData, services.config.BOT_TOKEN, {
        maxAgeSeconds: services.config.AUTH_MAX_AGE_SECONDS
      });
      const dbUser = await upsertUser(services, verified.user);
      const expiresIn = 7 * 86_400;
      const token = await createSession({ id: dbUser.id, telegramUserId: String(dbUser.telegram_user_id) }, services.config.SESSION_SECRET, expiresIn);
      return reply.send({
        token,
        expiresIn,
        user: { id: dbUser.id, telegramUserId: String(dbUser.telegram_user_id), firstName: dbUser.first_name, username: dbUser.username }
      });
    } catch (error) {
      if (error instanceof TelegramAuthError) return reply.code(401).send({ error: "Telegram authentication failed" });
      throw error;
    }
  });
}
