export type FieldKey = "event_time" | "user" | "organization" | "workspace" | "duration" | "environment" | "page_url" | "host";
export type ScoreParts = { present: number | null; type: number | null; populated: number | null; volume: number | null };
export type ContractField = { key: FieldKey; label: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean };
export type EventContract = {
  eventName: string;
  repo: string;
  aiTable: string;
  aiDateExpr: string;
  aiCategory: string;
  aiAction: string;
  aiEvent?: string;
  aiEventExclude?: string[];
  ampEventType: string;
  fields: ContractField[];
  omitted: Array<{ name: string; reason: string }>;
  ampEnvs: string[];
  aiEnvs: string[];
};
export type SnapshotField = { key: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean; aiFill: number | null; ampFill: number | null };
export type DailyVolume = { date: string; ai: number | null; amp: number | null };
export type CompareSnapshot = {
  version: 1;
  window: { start: string; end: string };
  volume: { ai: number | null; amp: number | null };
  daily?: DailyVolume[];
  fields: SnapshotField[];
};
export type CompareRow = { eventName: string; snapshot: CompareSnapshot | null; refreshedAt: string | null; lastError: string | null; parts: ScoreParts; match: number | null };

export const POPULATED_FLOOR = 0.5;
export const INGEST_LAG_DAYS = 2;
export const VOLUME_WINDOW_DAYS = 7;

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function closedDayWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - INGEST_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (VOLUME_WINDOW_DAYS - 1));
  return { start: ymdUtc(start), end: ymdUtc(end) };
}

export function overlapVolume(daily: DailyVolume[]): { ai: number; amp: number } | null {
  const both = daily.filter((d) => d.ai != null && d.amp != null);
  if (!both.length) return null;
  return {
    ai: both.reduce((s, d) => s + (d.ai ?? 0), 0),
    amp: both.reduce((s, d) => s + (d.amp ?? 0), 0),
  };
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
  if (key === "event_time") {
    const aiOk = isDateLike(aiType) || isString(aiType);
    return aiOk && isDateLike(ampType);
  }
  if (isDateLike(aiType) && isDateLike(ampType)) return true;
  if (isString(aiType) && isString(ampType)) return true;
  if (isNumeric(aiType) && isNumeric(ampType)) return true;
  return false;
}

const gelFields: ContractField[] = [
  { key: "event_time", label: "Event time", aiColumn: "dimensions:timestamp", aiType: "VARCHAR ISO", ampColumn: "event_date", ampType: "DATE", present: true, typeCompatible: true },
  { key: "user", label: "User", aiColumn: "dimensions:user_resource_id", aiType: "VARCHAR", ampColumn: "user_resource_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "organization", label: "Organization", aiColumn: "dimensions:organization_id", aiType: "VARCHAR", ampColumn: "organization_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "workspace", label: "Workspace", aiColumn: "dimensions:account_resource_id", aiType: "VARCHAR", ampColumn: "workspace_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "duration", label: "Duration", aiColumn: "value", aiType: "VARIANT INTEGER", ampColumn: "raw_event_properties:value", ampType: "NUMBER", present: true, typeCompatible: true },
  { key: "environment", label: "Environment", aiColumn: "environment", aiType: "VARCHAR", ampColumn: "environment", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "page_url", label: "Page URL", aiColumn: "dimensions:url", aiType: "VARCHAR", ampColumn: "page_url", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "host", label: "Host", aiColumn: "dimensions:host", aiType: "VARCHAR", ampColumn: "page_domain", ampType: "VARCHAR", present: true, typeCompatible: true },
];

const AI_TABLE = "SILVER_PROD.ADMIN.USER_ANALYTIC";
const AI_DATE_EXPR = "TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE";
const AMP_ENVS = ["us", "eu", "apac"];
const AI_ENVS = ["production", "prod-eu", "prod-apac"];

const sharedOmitted: EventContract["omitted"] = [
  { name: "session_id", reason: "App Intel session_id is an obfuscated token; Amplitude session_id is epoch milliseconds." },
  { name: "page_location", reason: "Same as Amplitude page_url for this event; do not score it twice." },
  { name: "page_path", reason: "Amplitude pathname only. App Intel has no path column; path is implied by url." },
];

const experienceOmitted: EventContract["omitted"] = [
  { name: "experience_name vs experienceName", reason: "App Intel stores the route segment; Amplitude stores a telemetry label like Experience loaded in (ms)_TextBox-embedded." },
  ...sharedOmitted,
];

const envelopeFields: ContractField[] = gelFields.filter((f) => f.key !== "duration");

export const GEL_CONTRACT: EventContract = {
  eventName: "General Experience Loading",
  repo: "wdesk_sdk",
  aiTable: AI_TABLE,
  aiDateExpr: AI_DATE_EXPR,
  aiCategory: "general",
  aiAction: "experience-loading",
  ampEventType: "General Experience Loading",
  fields: gelFields,
  omitted: experienceOmitted,
  ampEnvs: AMP_ENVS,
  aiEnvs: AI_ENVS,
};

function sdkContract(over: {
  eventName: string;
  aiCategory: string;
  aiAction: string;
  aiEvent?: string;
  aiEventExclude?: string[];
  fields?: ContractField[];
  omitted?: EventContract["omitted"];
}): EventContract {
  return {
    repo: "wdesk_sdk",
    aiTable: AI_TABLE,
    aiDateExpr: AI_DATE_EXPR,
    ampEventType: over.eventName,
    fields: over.fields ?? envelopeFields,
    omitted: over.omitted ?? sharedOmitted,
    ampEnvs: AMP_ENVS,
    aiEnvs: AI_ENVS,
    ...over,
  };
}

const DEDICATED: Array<{ eventName: string; aiCategory: string; aiAction: string; omitted?: EventContract["omitted"] }> = [
  { eventName: "General Experience Unloading", aiCategory: "general", aiAction: "experience-unloading", omitted: experienceOmitted },
  { eventName: "Unload General Experience", aiCategory: "general", aiAction: "experience-unloaded", omitted: experienceOmitted },
  { eventName: "Connect W Transport Web Socket", aiCategory: "wTransport", aiAction: "webSocket-connect" },
  { eventName: "Open Workspace", aiCategory: "workspace", aiAction: "open" },
  { eventName: "Open Organization", aiCategory: "organization", aiAction: "open" },
  { eventName: "Insert General Experience Embedded", aiCategory: "general", aiAction: "experience-embedded-insert", omitted: experienceOmitted },
  { eventName: "General Browser Upgrade Modal", aiCategory: "general", aiAction: "browser-upgrade-modal" },
  { eventName: "Open Marketplace External", aiCategory: "marketplace", aiAction: "open-external" },
];

const NAMED_SHELL: Array<[string, string]> = [
  ["About Workiva", "aboutWorkiva"],
  ["Change Workspace", "changeWorkspace"],
  ["Create Menu", "createMenu"],
  ["Create Workspace", "createWorkspace"],
  ["Help Menu", "helpMenu"],
  ["Keyboard Shortcuts", "keyboardShortcuts"],
  ["Kpmg Support", "kpmgSupport"],
  ["Logo", "logo"],
  ["Members", "members"],
  ["My Profile", "myProfile"],
  ["Open Experience Already", "experienceAlreadyOpen"],
  ["Open Workspace In New Tab", "openWorkspaceInNewTab"],
  ["Open Wtab In New Browser Tab", "openWtabInNewBrowserTab"],
  ["Org Admin", "orgAdmin"],
  ["Privacy Policy", "privacyPolicy"],
  ["Profile Menu", "profileMenu"],
  ["Service Provider Admin", "serviceProviderAdmin"],
  ["Sign Out", "signOut"],
  ["Super Admin", "superAdmin"],
  ["Support Chat", "supportChat"],
  ["Switch Org", "switchOrg"],
  ["Workspace Menu", "workspaceMenu"],
  ["Workspace Settings", "workspaceSettings"],
];

const CONTRACTS: EventContract[] = [
  GEL_CONTRACT,
  ...DEDICATED.map((c) => sdkContract(c)),
  ...NAMED_SHELL.map(([eventName, aiEvent]) =>
    sdkContract({ eventName, aiCategory: "shell", aiAction: "generic-analytic", aiEvent }),
  ),
  sdkContract({
    eventName: "Shell Generic Analytic",
    aiCategory: "shell",
    aiAction: "generic-analytic",
    aiEventExclude: NAMED_SHELL.map(([, aiEvent]) => aiEvent),
  }),
];

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
