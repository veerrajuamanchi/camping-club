import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const project = "rwmizunhxszjvcsaqkre";
const email = "veerraju.amanchi@gmail.com";
const displayName = "Veerraju Amanchi";

const run = spawnSync(
  "npx",
  ["supabase", "projects", "api-keys", "--project-ref", project, "--reveal", "--output", "json"],
  { encoding: "utf8" }
);
const parsed = JSON.parse(run.stdout.slice(run.stdout.search(/[\[{]/)));

function objects(value) {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === "object") return [value, ...Object.values(value).flatMap(objects)];
  return [];
}

const values = objects(parsed).flatMap((value) => Object.values(value));
const secret = values.find((value) => typeof value === "string" && value.startsWith("sb_secret_"));
const client = createClient(`https://${project}.supabase.co`, secret);

console.log(`Checking if ${email} already exists in staging auth...`);
const { data: userList } = await client.auth.admin.listUsers();
let user = userList?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (!user) {
  console.log(`Creating auth user for ${email}...`);
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) {
    console.error("Failed to create auth user:", error);
    process.exit(1);
  }
  user = data.user;
  console.log(`Auth user created: ${user.id}`);
} else {
  console.log(`Found existing auth user: ${user.id}`);
}

console.log("Upserting member profile in public.member_profiles...");
const { data: profile, error: profileError } = await client
  .from("member_profiles")
  .upsert(
    {
      auth_user_id: user.id,
      display_name: displayName,
      member_role: "admin",
      account_status: "active",
    },
    { onConflict: "auth_user_id" }
  )
  .select()
  .single();

if (profileError) {
  console.error("Failed to upsert member profile:", profileError);
  process.exit(1);
}

console.log("Successfully provisioned staging admin profile:", profile);
