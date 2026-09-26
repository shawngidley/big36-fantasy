import type { Position } from "../drizzle/schema";
import { positions } from "../drizzle/schema";

// The weekly external audit is a fixed-width text report comparing every drafted group's official
// NCAA total ("NCAA Audit") against what 36football showed at the time it was pulled. It is the
// league's source of truth for a week once games are final - NOT CFBD, which is only the live feed.
// stats.ncaa.org blocks requests from Vercel's servers outright (a 403 even with a browser UA), so
// the site cannot produce this report itself from where it runs; it consumes the report instead
// and corrects its own ledger to match. Both the MISMATCHES section (with the per-play "how" lines
// underneath each group) and the MATCHES section are parsed, so a week's full 215-group truth is
// captured, not just the mismatches.
//
// Report shape (columns separated by two or more spaces; "how" lines are indented continuations):
//   Group                  Owner            NCAA Audit  36Football  Diff  How (NCAA Audit)
//   Georgia - DST          Univ of Bad D.           35          53   -18  Fumble recovery (Boyd) (3)
//                                                                         Sack (Harris Jr.) (1)
//   ...
//   MATCHES
//   Alabama - DST          O state                  25          25  MATCH

export type ExternalAuditGroup = {
  school: string;
  position: Position;
  owner: string;
  expectedPoints: number;
  sitePointsAtAudit: number;
  status: "MATCH" | "MISMATCH";
  how: string[];
};

export type ExternalAuditReport = { pulledAt: string | null; groups: ExternalAuditGroup[] };

const groupPattern = new RegExp(`^(.+?) - (${positions.join("|")})$`);
const integerPattern = /^[+-]?\d+$/;

export function parseExternalAuditReport(text: string): ExternalAuditReport {
  const lines = text.split(/\r?\n/);
  const pulledAt = lines.map(line => line.match(/data pulled (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/i)?.[1]).find(Boolean) ?? null;
  const groups: ExternalAuditGroup[] = [];
  let current: ExternalAuditGroup | null = null;
  for (const raw of lines) {
    // The trailing "36FOOTBALL SHOWS POINTS, GAME NOT SCORED BY NCAA AUDIT YET" section lists groups
    // with no official number - nothing to reconcile against, so parsing stops there.
    if (/^36FOOTBALL SHOWS POINTS/i.test(raw.trim())) break;
    const fields = raw.trim().split(/\s{2,}/);
    const groupMatch = fields[0]?.match(groupPattern);
    const isGroupLine = Boolean(groupMatch) && fields.length >= 4 && integerPattern.test(fields[2] ?? "") && integerPattern.test(fields[3] ?? "");
    if (isGroupLine && groupMatch) {
      const expectedPoints = Number(fields[2]);
      const sitePointsAtAudit = Number(fields[3]);
      const rest = fields.slice(4);
      const status: ExternalAuditGroup["status"] = rest.includes("MATCH") ? "MATCH" : "MISMATCH";
      // In the MISMATCHES section the diff column ("+4", "-18") comes next, then the first how line.
      const how = rest.filter(field => field !== "MATCH" && !integerPattern.test(field));
      current = { school: groupMatch[1].trim(), position: groupMatch[2] as Position, owner: fields[1].trim(), expectedPoints, sitePointsAtAudit, status, how };
      groups.push(current);
      continue;
    }
    // Indented continuation under the current group: another "how" line.
    if (current && /^\s+\S/.test(raw) && raw.trim() && !/^-{3,}$/.test(raw.trim())) { current.how.push(raw.trim()); continue; }
    // Anything else (section headings, column headers, rules, blank lines) ends the current group.
    if (!raw.trim() || !/^\s/.test(raw)) current = null;
  }
  return { pulledAt, groups };
}

export type ExternalAuditPlanRow = {
  school: string;
  position: Position;
  owner: string;
  expectedPoints: number;
  currentPoints: number | null;
  delta: number;
  status: "match" | "adjust" | "unknown-group";
  how: string[];
};

// Pure planning step: given the parsed report and the site's CURRENT per-group totals for the week
// (not the ones the report was pulled against - the site may have moved since), decide what each
// group needs. Re-running against an already-corrected week yields all "match" rows and no writes,
// which is what makes applying the same report twice safe.
export function planExternalAuditAdjustments(report: ExternalAuditReport, currentPointsByGroup: Map<string, number>, normalizeKey: (school: string, position: Position) => string): ExternalAuditPlanRow[] {
  return report.groups.map(group => {
    const current = currentPointsByGroup.get(normalizeKey(group.school, group.position));
    if (current === undefined) return { school: group.school, position: group.position, owner: group.owner, expectedPoints: group.expectedPoints, currentPoints: null, delta: 0, status: "unknown-group" as const, how: group.how };
    const delta = Number((group.expectedPoints - current).toFixed(2));
    return { school: group.school, position: group.position, owner: group.owner, expectedPoints: group.expectedPoints, currentPoints: current, delta, status: Math.abs(delta) < 0.01 ? ("match" as const) : ("adjust" as const), how: group.how };
  });
}
