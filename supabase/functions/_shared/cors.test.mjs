import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders } from "./cors.mjs";

test("allows the Supabase client headers needed for a browser invocation", () => {
  const headers = corsHeaders("https://camping-club.onrender.com", ["https://camping-club.onrender.com"]);
  const allowed = headers["Access-Control-Allow-Headers"].toLowerCase().split(", ");

  for (const header of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assert.ok(allowed.includes(header), `CORS response did not allow ${header}`);
  }
  assert.equal(headers["Access-Control-Allow-Origin"], "https://camping-club.onrender.com");
});
