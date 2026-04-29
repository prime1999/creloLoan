import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cache a single admin client in server runtime to avoid recreating per call.
let cachedAdminClient: SupabaseClient | null = null;

export const getSupabaseAdminClient = (): SupabaseClient => {
  // Fast path for already initialized service-role client.
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables");
  }

  // Service-role client is server-only and disables session persistence.
  cachedAdminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      // Admin client should not store user sessions between calls.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
};
