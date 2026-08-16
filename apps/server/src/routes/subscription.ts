import type { FastifyInstance } from "fastify";
import type { Services } from "../types.js";
import {
  createPlusPayload,
  isPlusActive,
  publicSubscriptionStatus,
  subscriptionRecord
} from "../billing/subscription.js";
import { createPlusInvoiceLink, editPlusSubscription } from "../telegram/api.js";

export async function subscriptionRoutes(
  app: FastifyInstance,
  services: Services,
  authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>
) {
  app.get("/api/subscription", { preHandler: authenticate }, async (request) => {
    return publicSubscriptionStatus(await subscriptionRecord(services, request.sessionUser!.id));
  });

  app.post("/api/subscription/checkout", {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const userId = request.sessionUser!.id;
    const telegramUserId = Number(request.sessionUser!.telegramUserId);
    if (!Number.isSafeInteger(telegramUserId)) return reply.code(400).send({ error: "Invalid Telegram user" });
    const current = await subscriptionRecord(services, userId);
    if (isPlusActive(current)) {
      return reply.code(409).send({ error: current?.cancel_at_period_end ? "PLUS is active. Resume it instead." : "INDEX PLUS is already active." });
    }
    const payload = createPlusPayload(userId, telegramUserId);
    const { error } = await services.db.from("subscription_checkout_intents").upsert({
      user_id: userId,
      telegram_user_id: telegramUserId,
      payload,
      status: "created",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }, { onConflict: "user_id" });
    if (error) throw error;
    try {
      const invoiceLink = await createPlusInvoiceLink(services.config, payload);
      return reply.send({ invoiceLink });
    } catch (invoiceError) {
      await services.db.from("subscription_checkout_intents").delete().eq("user_id", userId).eq("payload", payload);
      throw invoiceError;
    }
  });

  app.post("/api/subscription/cancel", { preHandler: authenticate }, async (request, reply) => {
    const userId = request.sessionUser!.id;
    const telegramUserId = Number(request.sessionUser!.telegramUserId);
    const current = await subscriptionRecord(services, userId);
    if (!Number.isSafeInteger(telegramUserId) || !isPlusActive(current)) {
      return reply.code(400).send({ error: "No active INDEX PLUS subscription" });
    }
    if (!current!.cancel_at_period_end) {
      await editPlusSubscription(services.config, telegramUserId, current!.first_charge_id, true);
      const { error } = await services.db.from("subscriptions").update({ cancel_at_period_end: true }).eq("user_id", userId);
      if (error) throw error;
    }
    return reply.send(publicSubscriptionStatus({ ...current!, cancel_at_period_end: true }));
  });

  app.post("/api/subscription/resume", { preHandler: authenticate }, async (request, reply) => {
    const userId = request.sessionUser!.id;
    const telegramUserId = Number(request.sessionUser!.telegramUserId);
    const current = await subscriptionRecord(services, userId);
    if (!Number.isSafeInteger(telegramUserId) || !isPlusActive(current) || !current!.cancel_at_period_end) {
      return reply.code(400).send({ error: "No canceled INDEX PLUS subscription to resume" });
    }
    await editPlusSubscription(services.config, telegramUserId, current!.first_charge_id, false);
    const { error } = await services.db.from("subscriptions").update({ cancel_at_period_end: false }).eq("user_id", userId);
    if (error) throw error;
    return reply.send(publicSubscriptionStatus({ ...current!, cancel_at_period_end: false }));
  });
}
