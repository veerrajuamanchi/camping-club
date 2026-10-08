import { describe, expect, it } from "vitest";
import { buildEffectiveRuleBundle, canonicalRuleJson } from "./rules";

const general = [
  { id: "general-v1", definitionId: "fee", stableKey: "cabin-share", version: 1, scope: "general" as const, tripId: null, text: "Old cabin rule", values: { cents: 4000 }, effectiveFrom: "2026-01-01T00:00:00Z", expiresAt: null, active: true },
  { id: "general-v2", definitionId: "fee", stableKey: "cabin-share", version: 2, scope: "general" as const, tripId: null, text: "Current cabin rule", values: { cents: 5000 }, effectiveFrom: "2026-09-01T00:00:00Z", expiresAt: null, active: true },
  { id: "general-safe", definitionId: "safety", stableKey: "safety", version: 1, scope: "general" as const, tripId: null, text: "Use the buddy system", values: {}, effectiveFrom: "2026-01-01T00:00:00Z", expiresAt: null, active: true },
];

describe("effective Camping Constitution bundles", () => {
  it("uses current general versions, applies a linked unexpired override, and includes active trip rules", () => {
    const bundle = buildEffectiveRuleBundle({
      tripId: "trip-1",
      at: "2026-10-01T00:00:00Z",
      generalVersions: general,
      tripVersions: [
        { id: "trip-active", definitionId: "parking", stableKey: "parking", version: 1, scope: "trip", tripId: "trip-1", text: "Park in the lower lot", values: {}, effectiveFrom: "2026-09-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", active: true },
        { id: "trip-expired", definitionId: "quiet", stableKey: "quiet", version: 1, scope: "trip", tripId: "trip-1", text: "Expired rule", values: {}, effectiveFrom: "2026-01-01T00:00:00Z", expiresAt: "2026-09-30T23:59:59Z", active: true },
      ],
      overrides: [
        { id: "override-active", tripId: "trip-1", baseVersionId: "general-v2", overrideVersion: { id: "override-v1", definitionId: "fee", stableKey: "cabin-share", version: 1, scope: "trip" as const, tripId: "trip-1", text: "Cabin share is $55 for this trip", values: { cents: 5500 }, effectiveFrom: "2026-09-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z", active: true }, expiresAt: "2026-11-01T00:00:00Z" },
      ],
    });

    expect(bundle.map(({ id, text, source }) => ({ id, text, source }))).toEqual([
      { id: "override-v1", text: "Cabin share is $55 for this trip", source: "override" },
      { id: "trip-active", text: "Park in the lower lot", source: "trip" },
      { id: "general-safe", text: "Use the buddy system", source: "general" },
    ]);
  });

  it("ignores stale overrides when the base rule has a newer version", () => {
    const bundle = buildEffectiveRuleBundle({
      tripId: "trip-1", at: "2026-10-01T00:00:00Z", generalVersions: general, tripVersions: [],
      overrides: [{ id: "stale", tripId: "trip-1", baseVersionId: "general-v1", overrideVersion: { id: "old-override", definitionId: "fee", stableKey: "cabin-share", version: 1, scope: "trip", tripId: "trip-1", text: "Stale override", values: {}, effectiveFrom: "2026-01-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", active: true }, expiresAt: "2026-12-01T00:00:00Z" }],
    });
    expect(bundle.find(({ stableKey }) => stableKey === "cabin-share")?.text).toBe("Current cabin rule");
  });

  it("serializes equivalent bundles deterministically regardless of input ordering", () => {
    const options = { tripId: "trip-1", at: "2026-10-01T00:00:00Z", tripVersions: [], overrides: [] };
    const a = buildEffectiveRuleBundle({ ...options, generalVersions: general });
    const b = buildEffectiveRuleBundle({ ...options, generalVersions: [...general].reverse() });
    expect(canonicalRuleJson(a)).toBe(canonicalRuleJson(b));
  });
});
