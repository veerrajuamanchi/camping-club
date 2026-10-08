import { describe, expect, it } from "vitest";
import { pathAfterSignIn } from "./signInRouting";

describe("pathAfterSignIn", () => {
  it("routes an authenticated invitee without a profile to profile completion", () => {
    expect(pathAfterSignIn({ status: "profileRequired" })).toBe("/accept-invitation");
  });

  it("routes an active member to the trip calendar", () => {
    expect(pathAfterSignIn({ status: "active", role: "admin", displayName: "Admin" })).toBe("/");
  });

  it("routes other signed-in states to the access-status page", () => {
    expect(pathAfterSignIn({ status: "inactive" })).toBe("/");
  });
});
