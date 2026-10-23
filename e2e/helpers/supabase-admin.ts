import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
export const MAILPIT_URL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type TestUser = {
  authId: string;
  memberId: string;
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "member" | "accountant";
};

export async function createSyntheticUser(options: {
  role: "admin" | "member" | "accountant";
  displayName: string;
  emailPrefix?: string;
}): Promise<TestUser> {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const prefix = options.emailPrefix || options.role;
  const email = `e2e-${prefix}-${randomSuffix}@example.test`;
  const password = `TestPass123!${randomSuffix}`;

  // 1. Create user in auth.users
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    throw new Error(`Failed to create synthetic auth user: ${authError?.message}`);
  }

  const authId = authData.user.id;

  // 2. Insert into public.member_profiles
  const { data: profileData, error: profileError } = await supabaseAdmin
    .from("member_profiles")
    .insert([
      {
        auth_user_id: authId,
        display_name: options.displayName,
        member_role: options.role,
        account_status: "active",
      },
    ])
    .select("member_id")
    .single();

  if (profileError || !profileData) {
    await supabaseAdmin.auth.admin.deleteUser(authId);
    throw new Error(`Failed to create member profile: ${profileError?.message}`);
  }

  const memberId = profileData.member_id;

  // 3. Insert contact info
  await supabaseAdmin.from("member_private_contacts").insert([
    {
      member_id: memberId,
      phone_e164: "+15555550199",
    },
  ]);

  return {
    authId,
    memberId,
    email,
    password,
    displayName: options.displayName,
    role: options.role,
  };
}

export async function cleanupSyntheticUsers(users: TestUser[]): Promise<void> {
  for (const user of users) {
    try {
      await supabaseAdmin.from("member_profiles").delete().eq("auth_user_id", user.authId);
      await supabaseAdmin.auth.admin.deleteUser(user.authId);
    } catch {
      // Ignore cleanup error
    }
  }
}

export type MailAuthCredentials = {
  code?: string;
  verifyUrl?: string;
};

export async function getLatestAuthFromMailpit(
  email: string,
  timeoutMs = 15000
): Promise<MailAuthCredentials> {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    try {
      const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
      if (res.ok) {
        const body = (await res.json()) as {
          messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string; Created: string }>;
        };
        const message = body.messages?.find((m) =>
          m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase())
        );
        if (message) {
          const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
          if (detailRes.ok) {
            const detail = (await detailRes.json()) as { Text: string; HTML: string };
            const fullContent = `${detail.Text || ""} ${detail.HTML || ""}`;

            // Check for 6-8 digit OTP code
            const codeMatch = fullContent.match(/\b([0-9]{6,8})\b/);
            const code = codeMatch ? codeMatch[1] : undefined;

            // Check for magic link verify URL
            const urlMatch = fullContent.match(
              /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/i
            );
            const verifyUrl = urlMatch ? urlMatch[0].replace(/&amp;/g, "&") : undefined;

            if (code || verifyUrl) {
              return { code, verifyUrl };
            }
          }
        }
      }
    } catch {
      // Continue polling
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for auth email in Mailpit for ${email}`);
}
