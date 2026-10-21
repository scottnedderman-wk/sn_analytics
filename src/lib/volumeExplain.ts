import type { MigrationEvent } from "./model";

export type DayVolume = { date: string; amp: number; ai: number | null };

export type VolumeReason =
  | { kind: "within" }
  | { kind: "no-amplitude" }
  | { kind: "shared"; others: string[]; combinedDiff: number }
  | { kind: "one-day"; day: string }
  | { kind: "unexplained"; diff: number };

export type ExplainCounts = {
  shared: number;
  oneDay: number;
  noAmplitude: number;
  unexplained: number;
};

function diffPct(amp: number, ai: number | null | undefined): number | null {
  if (ai == null || amp === 0) return null;
  return Math.round((100 * (amp - ai)) / amp);
}

export function identityKey(
  event: Pick<MigrationEvent, "aiCategory" | "aiAction" | "aiEvent" | "aiEventExclude">,
): string | null {
  if (!event.aiCategory || !event.aiAction) return null;
  const excluded = [...(event.aiEventExclude ?? [])].sort().join(",");
  return [event.aiCategory, event.aiAction, event.aiEvent ?? "", excluded].join("\0");
}

function othersNamed(events: MigrationEvent[], event: MigrationEvent): string[] {
  return events.filter((item) => item !== event && item.name !== event.name).map((item) => item.name);
}

export function explainEvent(
  event: MigrationEvent,
  events: MigrationEvent[],
  days: DayVolume[] | null,
  tolerance: number,
): VolumeReason {
  const ai = event.ai30;
  if (ai == null) return { kind: "within" };
  if (event.v30 === 0) return ai > 0 ? { kind: "no-amplitude" } : { kind: "within" };
  const diff = diffPct(event.v30, ai);
  if (diff == null || Math.abs(diff) <= tolerance) return { kind: "within" };

  const key = identityKey(event);
  const group = key ? events.filter((item) => identityKey(item) === key) : [event];
  if (group.length > 1) {
    const combinedAmp = group.reduce((sum, item) => sum + item.v30, 0);
    const combinedDiff = diffPct(combinedAmp, ai);
    if (combinedDiff != null && Math.abs(combinedDiff) <= tolerance) {
      return { kind: "shared", others: othersNamed(group, event), combinedDiff };
    }
  }

  if (days?.length) {
    let worst = days[0]!;
    for (const day of days) {
      const gap = Math.abs(day.amp - (day.ai ?? 0));
      const worstGap = Math.abs(worst.amp - (worst.ai ?? 0));
      if (gap > worstGap) worst = day;
    }
    const worstAi = worst.ai ?? 0;
    const restAmp = event.v30 - worst.amp;
    const restAi = ai - worstAi;
    const restDiff = diffPct(restAmp, restAi);
    const restQuiet = (restAmp === 0 && restAi === 0) || (restDiff != null && Math.abs(restDiff) <= tolerance);
    if (restQuiet && Math.abs(worst.amp - worstAi) > 0) return { kind: "one-day", day: worst.date };
  }

  return { kind: "unexplained", diff };
}

export function reasonText(reason: VolumeReason): string | null {
  if (reason.kind === "no-amplitude") return "No Amplitude volume";
  if (reason.kind === "one-day") return `Most of the gap is ${reason.day}`;
  if (reason.kind !== "shared") return null;
  if (reason.others.length <= 2) return `Shared with ${reason.others.join(", ")}`;
  return `Shared with ${reason.others.length} events`;
}

export function explainCounts(reasons: VolumeReason[]): ExplainCounts {
  return reasons.reduce<ExplainCounts>(
    (counts, reason) => {
      if (reason.kind === "shared") counts.shared += 1;
      if (reason.kind === "one-day") counts.oneDay += 1;
      if (reason.kind === "no-amplitude") counts.noAmplitude += 1;
      if (reason.kind === "unexplained") counts.unexplained += 1;
      return counts;
    },
    { shared: 0, oneDay: 0, noAmplitude: 0, unexplained: 0 },
  );
}

export function explainSummary(counts: ExplainCounts): string | null {
  const parts: string[] = [];
  if (counts.shared) parts.push(`${counts.shared} shared ${counts.shared === 1 ? "identity" : "identities"}`);
  if (counts.oneDay) parts.push(`${counts.oneDay} mostly one day`);
  if (counts.noAmplitude) parts.push(`${counts.noAmplitude} no Amplitude volume`);
  if (counts.unexplained) parts.push(`${counts.unexplained} unexplained`);
  return parts.length ? parts.join(" · ") : null;
}

export function dominantGapDay(days: DayVolume[]): string | null {
  let best: DayVolume | null = null;
  let bestGap = 0;
  for (const day of days) {
    const gap = Math.abs(day.amp - (day.ai ?? 0));
    if (!best || gap > bestGap || (gap === bestGap && day.date > best.date)) {
      best = day;
      bestGap = gap;
    }
  }
  return best && bestGap > 0 ? best.date : null;
}
