export type FieldKey = "event_time" | "user" | "organization" | "workspace" | "duration" | "environment";
export type ScoreParts = { present: number | null; type: number | null; populated: number | null; volume: number | null };
export type ContractField = { key: FieldKey; label: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean };
export type EventContract = { eventName: string; repo: string; aiTable: string; ampEventType: string; fields: ContractField[]; omitted: Array<{ name: string; reason: string }>; ampEnvs: string[]; aiEnvs: string[] };
export type SnapshotField = { key: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean; aiFill: number | null; ampFill: number | null };
export type CompareSnapshot = { version: 1; window: { start: string; end: string }; volume: { ai: number | null; amp: number | null }; fields: SnapshotField[] };
export type CompareRow = { eventName: string; snapshot: CompareSnapshot | null; refreshedAt: string | null; lastError: string | null; parts: ScoreParts; match: number | null };

export const POPULATED_FLOOR = 0.5;

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function closedDayWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: ymdUtc(start), end: ymdUtc(end) };
}

function isDateLike(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("DATE") || u.includes("TIMESTAMP");
}
function isString(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("VARCHAR") || u.includes("STRING") || u === "TEXT";
}
function isNumeric(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("FLOAT") || u.includes("NUMBER") || u.includes("DOUBLE") || u.includes("INT");
}

export function typesCompatible(aiType: string, ampType: string, key: FieldKey): boolean {
  if (key === "environment") return isString(aiType) && isString(ampType);
  if (isDateLike(aiType) && isDateLike(ampType)) return true;
  if (isString(aiType) && isString(ampType)) return true;
  if (isNumeric(aiType) && isNumeric(ampType)) return true;
  return false;
}

const gelFields: ContractField[] = [
  { key: "event_time", label: "Event time", aiColumn: "analytic_date", aiType: "DATE", ampColumn: "event_date", ampType: "DATE", present: true, typeCompatible: true },
  { key: "user", label: "User", aiColumn: "user_resource_id", aiType: "VARCHAR", ampColumn: "user_resource_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "organization", label: "Organization", aiColumn: "organization_id", aiType: "VARCHAR", ampColumn: "organization_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "workspace", label: "Workspace", aiColumn: "account_resource_id", aiType: "VARCHAR", ampColumn: "workspace_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "duration", label: "Duration", aiColumn: "value", aiType: "FLOAT", ampColumn: "raw_event_properties:value", ampType: "NUMBER", present: true, typeCompatible: true },
  { key: "environment", label: "Environment", aiColumn: "environment", aiType: "VARCHAR", ampColumn: "environment", ampType: "VARCHAR", present: true, typeCompatible: true },
];

export const GEL_CONTRACT: EventContract = {
  eventName: "General Experience Loading",
  repo: "wdesk_sdk",
  aiTable: "silver_prod.user_analytic.general_experience_loading",
  ampEventType: "General Experience Loading",
  fields: gelFields,
  omitted: [
    { name: "experience_name vs experienceName", reason: "App Intel stores the route segment; Amplitude stores a telemetry label like Experience loaded in (ms)_TextBox-embedded." },
    { name: "session_id", reason: "App Intel session_id is an obfuscated token; Amplitude session_id is epoch milliseconds." },
  ],
  ampEnvs: ["us", "eu", "apac"],
  aiEnvs: ["production", "prod-eu", "prod-apac"],
};

const CONTRACTS: EventContract[] = [GEL_CONTRACT];

export function contractFor(eventName: string): EventContract | undefined {
  return CONTRACTS.find((c) => c.eventName === eventName);
}

export function contractsForRepo(repo: string): EventContract[] {
  return CONTRACTS.filter((c) => c.repo === repo);
}

export function compositeScore(parts: ScoreParts): number | null {
  const vals = [parts.present, parts.type, parts.populated, parts.volume].filter((n): n is number => n != null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function formatScoreTitle(parts: ScoreParts): string {
  const label = (n: number | null) => (n == null ? "pending" : `${n}%`);
  return `Present ${label(parts.present)} · Type ${label(parts.type)} · Populated ${label(parts.populated)} · Volume ${label(parts.volume)}`;
}

export function volumeScore(ai: number | null, amp: number | null): number | null {
  if (ai == null || amp == null) return null;
  if (ai === 0 && amp === 0) return 100;
  if (ai === 0 || amp === 0) return 0;
  return Math.round((100 * Math.min(ai, amp)) / Math.max(ai, amp));
}

export function presentScore(fields: { present: boolean }[]): number | null {
  if (!fields.length) return null;
  return Math.round((100 * fields.filter((f) => f.present).length) / fields.length);
}

export function typeScore(fields: { present: boolean; typeCompatible: boolean }[]): number | null {
  const both = fields.filter((f) => f.present);
  if (!both.length) return null;
  return Math.round((100 * both.filter((f) => f.typeCompatible).length) / both.length);
}

export function populatedScore(fields: SnapshotField[]): number | null {
  const both = fields.filter((f) => f.present);
  if (!both.length) return null;
  if (both.some((f) => f.aiFill == null || f.ampFill == null)) return null;
  const ok = both.filter((f) => (f.aiFill ?? 0) >= POPULATED_FLOOR && (f.ampFill ?? 0) >= POPULATED_FLOOR);
  return Math.round((100 * ok.length) / both.length);
}

export function scoreParts(contract: EventContract | undefined, snapshot: CompareSnapshot | null): ScoreParts {
  if (!contract) return { present: null, type: null, populated: null, volume: null };
  const fields = snapshot?.fields.length ? snapshot.fields : contract.fields;
  return {
    present: presentScore(fields),
    type: typeScore(fields),
    populated: snapshot ? populatedScore(snapshot.fields) : null,
    volume: snapshot ? volumeScore(snapshot.volume.ai, snapshot.volume.amp) : null,
  };
}

function row(eventName: string, snapshot: CompareSnapshot | null, refreshedAt: string | null, lastError: string | null): CompareRow {
  const parts = scoreParts(contractFor(eventName), snapshot);
  return { eventName, snapshot, refreshedAt, lastError, parts, match: compositeScore(parts) };
}

export function compareRowFromContract(eventName: string): CompareRow | null {
  if (!contractFor(eventName)) return null;
  return row(eventName, null, null, null);
}

export function compareRowFromCache(
  eventName: string,
  snapshot: CompareSnapshot | null,
  refreshedAt: string | null,
  lastError: string | null,
): CompareRow {
  return row(eventName, snapshot, refreshedAt, lastError);
}
