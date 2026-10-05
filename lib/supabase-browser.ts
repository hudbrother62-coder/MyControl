import { createClient } from "@supabase/supabase-js";
// Every database request uses the authenticated same-origin backend. No DB key in browser.
export const supabase = createClient(
  "https://database.invalid",
  "public-proxy-placeholder",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const u = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (!u.pathname.startsWith("/rest/v1/"))
          throw new Error("Direct provider access is disabled");
        return fetch("/api/database/" + u.pathname.slice(9) + u.search, {
          ...init,
          credentials: "same-origin",
        });
      },
    },
  },
);
