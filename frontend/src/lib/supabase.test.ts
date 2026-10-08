import { describe, expect, it } from "vitest";
import { responseErrorCode } from "./supabase";

describe("responseErrorCode", () => {
  it("reads the string error shape returned by member-api", async () => {
    const response = new Response(JSON.stringify({ error: "invitation_profile_required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

    await expect(responseErrorCode(response)).resolves.toBe("invitation_profile_required");
  });

  it("reads a structured error code when one is returned", async () => {
    const response = new Response(JSON.stringify({ error: { code: "membership_inactive" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

    await expect(responseErrorCode(response)).resolves.toBe("membership_inactive");
  });
});
