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
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramFile;
  document?: TelegramFile;
  audio?: TelegramFile;
}

export interface TelegramUpdate { update_id: number; message?: TelegramMessage }

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
