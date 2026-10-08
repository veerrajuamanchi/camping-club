export type RotationSite = {
  id: string;
  name: string;
  rotationPosition: number;
};

export type MonthlyAssignment = {
  monthKey: string;
  campsiteId: string;
  campsiteName: string;
  rotationPosition: number;
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function planMonthlyRotation(
  monthKeys: string[],
  sites: RotationSite[],
  startingPosition: number,
): MonthlyAssignment[] {
  if (!Number.isInteger(startingPosition) || startingPosition < 1 || startingPosition > 7) {
    throw new Error("Starting rotation position must be between 1 and 7.");
  }
  if (sites.length !== 7 || new Set(sites.map(({ id }) => id)).size !== 7) {
    throw new Error("Rotation requires exactly seven active campsites.");
  }
  const positions = new Set(sites.map(({ rotationPosition }) => rotationPosition));
  if (positions.size !== 7 || Array.from({ length: 7 }, (_, i) => i + 1).some((n) => !positions.has(n))) {
    throw new Error("Rotation requires unique rotation positions from 1 through 7.");
  }
  if (new Set(monthKeys).size !== monthKeys.length || monthKeys.some((key) => !MONTH_RE.test(key))) {
    throw new Error("Calendar months must be unique YYYY-MM values.");
  }

  const ordered = [...sites].sort((a, b) => a.rotationPosition - b.rotationPosition);
  const startIndex = startingPosition - 1;
  return monthKeys.map((monthKey, index) => {
    const position = (startIndex + index) % ordered.length;
    const site = ordered[position];
    return {
      monthKey,
      campsiteId: site.id,
      campsiteName: site.name,
      rotationPosition: site.rotationPosition,
    };
  });
}

export function defaultPollDeadlineDate(tripStartDate: string, leadDays = 35): string {
  if (!Number.isInteger(leadDays) || leadDays < 0) throw new Error("Lead days must be a non-negative integer.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tripStartDate);
  if (!match) throw new Error("Trip start date must be a valid YYYY-MM-DD date.");
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.toISOString().slice(0, 10) !== tripStartDate) throw new Error("Trip start date must be a valid YYYY-MM-DD date.");
  parsed.setUTCDate(parsed.getUTCDate() - leadDays);
  return parsed.toISOString().slice(0, 10);
}

export function formatZonedDateTimeLocal(value: string | null, timeZone: string | null): string {
  if (!value) return "";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const fields = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
