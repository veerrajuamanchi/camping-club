import { describe, expect, it, vi } from "vitest";
import { AuthApiError, invokeAuthApi, responseErrorCode, supabase } from "./supabase";

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

describe("invokeAuthApi", () => {
  it("invokes auth-api and returns response data", async () => {
    if (!supabase) throw new Error("Supabase client expected to be initialized");
    const invokeSpy = vi.spyOn(Object.getPrototypeOf(supabase.functions), "invoke").mockResolvedValueOnce({
      data: { data: { status: "approved_member" } },
      error: null,
      response: new Response(JSON.stringify({ data: { status: "approved_member" } }), { status: 200 }),
    });

    const result = await invokeAuthApi<{ status: string }>("check_access", {
      name: "Alice",
      email: "alice@example.com",
    });

    expect(invokeSpy).toHaveBeenCalledWith("auth-api", {
      body: {
        action: "check_access",
        input: { name: "Alice", email: "alice@example.com" },
      },
    });
    expect(result).toEqual({ status: "approved_member" });
  });

  it("defaults input to empty object if omitted", async () => {
    if (!supabase) throw new Error("Supabase client expected to be initialized");
    const invokeSpy = vi.spyOn(Object.getPrototypeOf(supabase.functions), "invoke").mockResolvedValueOnce({
      data: { data: { status: "approved_member" } },
      error: null,
      response: new Response(JSON.stringify({ data: { status: "approved_member" } }), { status: 200 }),
    });

    await invokeAuthApi("check_access");

    expect(invokeSpy).toHaveBeenCalledWith("auth-api", {
      body: { action: "check_access", input: {} },
    });
  });

  it("throws AuthApiError with error code and status on HTTP failure", async () => {
    if (!supabase) throw new Error("Supabase client expected to be initialized");
    const errorResponse = new Response(
      JSON.stringify({ error: { code: "too_many_requests" } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    vi.spyOn(Object.getPrototypeOf(supabase.functions), "invoke").mockResolvedValueOnce({
      data: null,
      error: new Error("Too Many Requests"),
      response: errorResponse,
    });

    try {
      await invokeAuthApi("check_access", { name: "Bob", email: "bob@example.com" });
      expect.unreachable("should have thrown AuthApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthApiError);
      const authErr = err as AuthApiError;
      expect(authErr.code).toBe("too_many_requests");
      expect(authErr.status).toBe(429);
    }
  });

  it("throws AuthApiError when payload contains data.error", async () => {
    if (!supabase) throw new Error("Supabase client expected to be initialized");
    vi.spyOn(Object.getPrototypeOf(supabase.functions), "invoke").mockResolvedValueOnce({
      data: { error: { code: "invalid_request" } },
      error: null,
      response: new Response(JSON.stringify({ error: { code: "invalid_request" } }), { status: 400 }),
    });

    await expect(invokeAuthApi("check_access", { name: "", email: "invalid" }))
      .rejects.toMatchObject({
        name: "AuthApiError",
        code: "invalid_request",
      });
  });
});
