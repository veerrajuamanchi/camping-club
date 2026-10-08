import assert from "node:assert/strict";
import test from "node:test";
import { resolveServiceApiKey } from "./service-key.mjs";

test("uses the configured default Supabase secret key", () => {
  assert.equal(
    resolveServiceApiKey('{"default":"sb_secret_current","backup":"sb_secret_other"}'),
    "sb_secret_current",
  );
});

test("fails closed when a secret key map has no default key", () => {
  assert.throws(
    () => resolveServiceApiKey('{"other":"sb_secret_other"}'),
    /default Supabase secret key/i,
  );
});

test("fails closed when the Supabase secret key map is absent", () => {
  assert.throws(
    () => resolveServiceApiKey(undefined),
    /SUPABASE_SECRET_KEYS/i,
  );
});

test("fails closed when the Supabase secret key map is malformed", () => {
  assert.throws(
    () => resolveServiceApiKey("not-json"),
    /SUPABASE_SECRET_KEYS must be a JSON object/i,
  );
});
