import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExternalAuditReport, planExternalAuditAdjustments } from "./external-audit";

// The fixture is the real week-2 external audit, verbatim - 215 groups (56 mismatches, 159
// matches), with every quirk the parser has to survive: parenthesized school names, apostrophes and
// accented letters in owner and player names, negative totals, multi-line "how" blocks, and the
// trailing "not scored yet" section.
const report = parseExternalAuditReport(readFileSync(new URL("./fixtures/week2-external-audit.txt", import.meta.url), "utf8"));
const find = (school: string, position: string) => report.groups.find(group => group.school === school && group.position === position);

describe("parseExternalAuditReport (real week 2 report)", () => {
  it("captures every group from both sections with the report's own counts", () => {
    expect(report.groups).toHaveLength(215);
    expect(report.groups.filter(group => group.status === "MISMATCH")).toHaveLength(56);
    expect(report.groups.filter(group => group.status === "MATCH")).toHaveLength(159);
    expect(report.pulledAt).toBe("2026-09-20 00:27");
  });

  it("reads a mismatch with its full multi-line how block and both totals", () => {
    const georgia = find("Georgia", "DST")!;
    expect(georgia).toMatchObject({ owner: "University of Bad Decisions", expectedPoints: 35, sitePointsAtAudit: 53, status: "MISMATCH" });
    expect(georgia.how).toHaveLength(8);
    expect(georgia.how[0]).toBe("Fumble recovery (Boyd) (3)");
    expect(georgia.how[4]).toBe("0-yd defensive return TD [review] (9)");
    expect(georgia.how[7]).toBe("Sack (Lonon Jr.) (1)");
  });

  it("reads a match line and does not invent how lines for it", () => {
    expect(find("Hawai'i", "K")).toMatchObject({ owner: "Marcus College", expectedPoints: 23, sitePointsAtAudit: 23, status: "MATCH", how: [] });
  });

  it("handles parenthesized schools, apostrophes, accents, and negative totals", () => {
    expect(find("Miami (OH)", "DST")).toMatchObject({ owner: "CreefDogg U", expectedPoints: 16, sitePointsAtAudit: 28 });
    expect(find("Minnesota", "DST")).toMatchObject({ owner: "Brigham's Bitchin Beard Jr College", expectedPoints: 16, sitePointsAtAudit: 4 });
    expect(find("LSU", "WR")).toMatchObject({ expectedPoints: -3, sitePointsAtAudit: 0, how: ["Wilson III fumble lost (-3)"] });
    expect(find("SMU", "TE")!.how[0]).toBe("Öhrström 2-yd TD rec (12)");
  });

  it("does not bleed a group's how lines into the next group", () => {
    // Alabama QB has 5 how lines; the next group, Arkansas State K, has its own 8.
    expect(find("Alabama", "QB")!.how).toHaveLength(5);
    expect(find("Arkansas State", "K")!.how).toHaveLength(8);
    expect(find("Arkansas State", "K")!.how[0]).toBe("Andel PAT (1)");
  });
});

describe("planExternalAuditAdjustments", () => {
  const key = (school: string, position: string) => `${school.toLowerCase()}::${position}`;
  it("computes NCAA minus the site's CURRENT total, not the total the report was pulled against", () => {
    // Old Dominion QB: report saw 0, NCAA says 16 - but the site has since been corrected to 16.
    const plan = planExternalAuditAdjustments(report, new Map([[key("Old Dominion", "QB"), 16], [key("Georgia", "DST"), 53]]), key);
    expect(plan.find(row => row.school === "Old Dominion")).toMatchObject({ status: "match", delta: 0, currentPoints: 16 });
    expect(plan.find(row => row.school === "Georgia" && row.position === "DST")).toMatchObject({ status: "adjust", delta: -18, currentPoints: 53, expectedPoints: 35 });
  });
  it("flags a report group the league has no slot for instead of guessing", () => {
    const plan = planExternalAuditAdjustments(report, new Map(), key);
    expect(plan.every(row => row.status === "unknown-group")).toBe(true);
  });
  it("is a no-op when re-run against an already-corrected week", () => {
    const corrected = new Map(report.groups.map(group => [key(group.school, group.position), group.expectedPoints]));
    const plan = planExternalAuditAdjustments(report, corrected, key);
    expect(plan.filter(row => row.status === "adjust")).toHaveLength(0);
    expect(plan.filter(row => row.status === "match")).toHaveLength(215);
  });
});

describe("parseExternalAuditReport (real week 3 report - different column widths, shutouts, byes)", () => {
  const week3 = parseExternalAuditReport(readFileSync(new URL("./fixtures/week3-external-audit.txt", import.meta.url), "utf8"));
  const find3 = (school: string, position: string) => week3.groups.find(group => group.school === school && group.position === position);

  it("matches the report's own counts even though the mismatch table's owner column is narrower than week 2's", () => {
    expect(week3.groups).toHaveLength(211);
    expect(week3.groups.filter(group => group.status === "MISMATCH")).toHaveLength(32);
    expect(week3.groups.filter(group => group.status === "MATCH")).toHaveLength(179);
    expect(week3.pulledAt).toBe("2026-09-20 21:58");
  });

  it("carries the external audit's shutout line - the rule the site's own live scoring missed for Indiana", () => {
    expect(find3("Indiana", "DST")).toMatchObject({ expectedPoints: 19, sitePointsAtAudit: 4, how: ["Sack (Osunsanmi) (1)", "INT (Jones) (3)", "Shutout (15)"] });
    expect(find3("Iowa", "DST")!.how).toContain("Shutout (15)");
    expect(find3("Oregon", "DST")!.how).toContain("Shutout (15)");
  });

  it("reads a negative NCAA total and a how line with a nested parenthetical", () => {
    expect(find3("SMU", "QB")).toMatchObject({ expectedPoints: -1, sitePointsAtAudit: 7 });
    expect(find3("SMU", "QB")!.how[2]).toBe("Jennings fumble lost (through the end zone, touchback) (-3)");
  });

  it("excludes the bye-week groups listed after the parse boundary (no NCAA number exists for them)", () => {
    for (const [school, position] of [["Hawai'i", "K"], ["Hawai'i", "QB"], ["Hawai'i", "WR"], ["Navy", "QB"], ["UNLV", "DST"]]) expect(find3(school, position)).toBeUndefined();
  });
});
