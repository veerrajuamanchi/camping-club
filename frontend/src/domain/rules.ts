export type RuleVersion = {
  id: string;
  definitionId: string;
  stableKey: string;
  version: number;
  scope: "general" | "trip";
  tripId: string | null;
  text: string;
  values: Record<string, unknown>;
  effectiveFrom: string;
  expiresAt: string | null;
  active: boolean;
};

export type RuleOverride = {
  id: string;
  tripId: string;
  baseVersionId: string;
  overrideVersion: RuleVersion;
  expiresAt: string;
};

export type EffectiveRule = Omit<RuleVersion, "scope" | "tripId" | "active"> & {
  source: "general" | "override" | "trip";
  sourceReferenceId: string | null;
};

type BundleInput = {
  tripId: string;
  at: string;
  generalVersions: RuleVersion[];
  tripVersions: RuleVersion[];
  overrides: RuleOverride[];
};

function effectiveAt(version: RuleVersion, instant: number): boolean {
  const starts = Date.parse(version.effectiveFrom);
  const ends = version.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(version.expiresAt);
  return version.active && Number.isFinite(starts) && starts <= instant && (version.expiresAt === null || Number.isFinite(ends)) && instant < ends;
}

function currentByDefinition(versions: RuleVersion[], instant: number): RuleVersion[] {
  const current = new Map<string, RuleVersion>();
  for (const version of versions) {
    if (!effectiveAt(version, instant)) continue;
    const existing = current.get(version.definitionId);
    if (!existing || version.version > existing.version) current.set(version.definitionId, version);
  }
  return [...current.values()];
}

export function buildEffectiveRuleBundle(input: BundleInput): EffectiveRule[] {
  const instant = Date.parse(input.at);
  if (!Number.isFinite(instant)) throw new Error("Bundle time must be a valid ISO timestamp.");

  const baseRules = currentByDefinition(
    input.generalVersions.filter((version) => version.scope === "general" && version.tripId === null),
    instant,
  );
  const tripRules = currentByDefinition(
    input.tripVersions.filter((version) => version.scope === "trip" && version.tripId === input.tripId),
    instant,
  );

  const effective: EffectiveRule[] = baseRules.map((base) => {
    const override = input.overrides
      .filter((candidate) => candidate.tripId === input.tripId
        && candidate.baseVersionId === base.id
        && Date.parse(candidate.expiresAt) > instant
        && effectiveAt(candidate.overrideVersion, instant))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const chosen = override?.overrideVersion ?? base;
    return {
      id: chosen.id,
      definitionId: base.definitionId,
      stableKey: base.stableKey,
      version: chosen.version,
      text: chosen.text,
      values: chosen.values,
      effectiveFrom: chosen.effectiveFrom,
      expiresAt: override?.expiresAt ?? chosen.expiresAt,
      source: override ? "override" : "general",
      sourceReferenceId: override?.id ?? null,
    };
  });

  for (const version of tripRules) {
    effective.push({
      id: version.id,
      definitionId: version.definitionId,
      stableKey: version.stableKey,
      version: version.version,
      text: version.text,
      values: version.values,
      effectiveFrom: version.effectiveFrom,
      expiresAt: version.expiresAt,
      source: "trip",
      sourceReferenceId: null,
    });
  }

  return effective.sort((a, b) => a.stableKey.localeCompare(b.stableKey) || a.definitionId.localeCompare(b.definitionId));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function canonicalRuleJson(bundle: EffectiveRule[]): string {
  return JSON.stringify(canonical(bundle));
}
