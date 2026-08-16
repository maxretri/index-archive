import { createClient } from "@supabase/supabase-js";
import type { Config } from "./config.js";

export function createDatabase(config: Config) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "index-server/0.1" } }
  });
}

export function scopeToUser<T extends { eq(column: string, value: string): unknown }>(query: T, userId: string) {
  return query.eq("user_id", userId);
}
