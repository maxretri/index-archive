import type { Services, TelegramMessage, TelegramPreCheckoutQuery } from "../types.js";
import {
  PLUS_PERIOD_SECONDS,
  isPlusActive,
  validatePlusInvoice,
  subscriptionRecord
} from "../billing/subscription.js";
import { answerPreCheckout, sendPlusActiveReply } from "./api.js";
import { upsertUser } from "./ingest.js";

export async function handlePlusPreCheckout(services: Services, query: TelegramPreCheckoutQuery) {
  let errorMessage = "INDEX PLUS checkout could not be verified.";
  try {
    const payload = validatePlusInvoice(query.invoice_payload, query.currency, query.total_amount, query.from.id);
    if (!payload) {
      errorMessage = "This INDEX PLUS invoice is invalid.";
      await answerPreCheckout(services.config, query.id, false, errorMessage);
      return false;
    }
    const { data: user, error } = await services.db.from("users")
      .select("id,telegram_user_id")
      .eq("id", payload.userId)
      .eq("telegram_user_id", query.from.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      await answerPreCheckout(services.config, query.id, false, "INDEX account not found. Reopen the Mini App.");
      return false;
    }
    if (isPlusActive(await subscriptionRecord(services, payload.userId))) {
      await answerPreCheckout(services.config, query.id, false, "INDEX PLUS is already active for this account.");
      return false;
    }
    const { data: intent, error: intentError } = await services.db.from("subscription_checkout_intents")
      .update({ status: "approved" })
      .eq("user_id", payload.userId)
      .eq("telegram_user_id", query.from.id)
      .eq("payload", query.invoice_payload)
      .eq("status", "created")
      .gt("expires_at", new Date().toISOString())
      .select("user_id")
      .maybeSingle();
    if (intentError) throw intentError;
    if (!intent) {
      await answerPreCheckout(services.config, query.id, false, "This INDEX PLUS invoice expired. Create a new one.");
      return false;
    }
    await answerPreCheckout(services.config, query.id, true);
    return true;
  } catch {
    await answerPreCheckout(services.config, query.id, false, errorMessage);
    return false;
  }
}

export async function handleSuccessfulPlusPayment(services: Services, message: TelegramMessage) {
  const payment = message.successful_payment;
  if (!payment || !message.from || message.from.is_bot) return false;
  const payload = validatePlusInvoice(payment.invoice_payload, payment.currency, payment.total_amount, message.from.id);
  if (!payload) {
    return false;
  }
  const user = await upsertUser(services, message.from);
  if (user.id !== payload.userId) return false;
  const { data: intent, error: intentError } = await services.db.from("subscription_checkout_intents")
    .select("user_id,status")
    .eq("user_id", user.id)
    .eq("telegram_user_id", message.from.id)
    .eq("payload", payment.invoice_payload)
    .maybeSingle();
  if (intentError) throw intentError;
  if (!intent || !["approved", "paid"].includes(intent.status as string)) return false;

  const periodEnd = payment.subscription_expiration_date
    ? new Date(payment.subscription_expiration_date * 1000)
    : new Date(Date.now() + PLUS_PERIOD_SECONDS * 1000);
  const existing = await subscriptionRecord(services, user.id);
  const { data: insertedPayment, error: paymentError } = await services.db.from("star_payments").upsert({
    user_id: user.id,
    telegram_user_id: message.from.id,
    telegram_payment_charge_id: payment.telegram_payment_charge_id,
    provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
    invoice_payload: payment.invoice_payload,
    currency: payment.currency,
    total_amount: payment.total_amount,
    subscription_expiration_date: periodEnd.toISOString(),
    is_recurring: payment.is_recurring ?? false,
    is_first_recurring: payment.is_first_recurring ?? false
  }, { onConflict: "telegram_payment_charge_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (paymentError) throw paymentError;

  const { error: subscriptionError } = await services.db.from("subscriptions").upsert({
    user_id: user.id,
    telegram_user_id: message.from.id,
    plan: "plus",
    status: "active",
    current_period_end: periodEnd.toISOString(),
    first_charge_id: existing?.first_charge_id ?? payment.telegram_payment_charge_id,
    latest_charge_id: payment.telegram_payment_charge_id,
    cancel_at_period_end: false
  }, { onConflict: "user_id" });
  if (subscriptionError) throw subscriptionError;
  const { error: intentUpdateError } = await services.db.from("subscription_checkout_intents")
    .update({ status: "paid" }).eq("user_id", user.id).eq("payload", payment.invoice_payload);
  if (intentUpdateError) throw intentUpdateError;
  if (insertedPayment) await sendPlusActiveReply(services.config, message.chat.id, periodEnd);
  return true;
}
