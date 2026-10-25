import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { authenticateSession } from "./auth";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, type TestUser } from "./supabase-admin";

export async function authenticateWorkloadSession(page: Page, user: TestUser) {
  if (process.env.HOSTED_QA !== "1") return authenticateSession(page, user);
  const url = new URL(SUPABASE_URL);
  if (url.hostname !== "rwmizunhxszjvcsaqkre.supabase.co") throw new Error("Hosted QA must target the explicitly classified staging project.");
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session) throw new Error("Could not create the synthetic staging session.");
  const storageKey = `sb-${url.hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: storageKey, session: data.session,
  });
  if (page.url() !== "about:blank") {
    await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
      key: storageKey, session: data.session,
    });
  }
}
