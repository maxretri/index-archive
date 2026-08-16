import type { SupabaseClient } from "@supabase/supabase-js";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: TelegramPhotoSize;
}

export interface TelegramMessage {
  message_id: number;
  media_group_id?: string;
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramFile;
  document?: TelegramFile;
  audio?: TelegramFile;
  successful_payment?: TelegramSuccessfulPayment;
}

export interface TelegramSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

export interface TelegramPreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: Pick<TelegramMessage, "message_id" | "chat">;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  pre_checkout_query?: TelegramPreCheckoutQuery;
}

export interface SessionUser {
  id: string;
  telegramUserId: string;
}

export interface Services {
  db: SupabaseClient;
  config: import("./config.js").Config;
}

declare module "fastify" {
  interface FastifyRequest { sessionUser?: SessionUser }
}
