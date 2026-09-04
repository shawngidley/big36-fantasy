import { describe, expect, it } from "vitest";
import { boxScoreFumbleCandidates } from "./live-scoring";

// Real shape from /games/players for UNLV vs Memphis (game 401862693), Week 1 2026.
const box = {
  id: 401862693,
  teams: [
    { team: "UNLV", categories: [{ name: "fumbles", types: [
      { name: "FUM", athletes: [{ id: "-7753", name: " Team", stat: "1" }, { id: "4685388", name: "Denver Harris", stat: "0" }] },
      { name: "LOST", athletes: [{ id: "-7753", name: " Team", stat: "0" }, { id: "4685388", name: "Denver Harris", stat: "0" }] },
      { name: "REC", athletes: [{ id: "-7753", name: " Team", stat: "0" }, { id: "4685388", name: "Denver Harris", stat: "1" }] },
    ] }] },
    { team: "Memphis", categories: [{ name: "fumbles", types: [
      { name: "FUM", athletes: [{ id: "4685290", name: "Tychaun Chapman", stat: "1" }] },
      { name: "LOST", athletes: [{ id: "4685290", name: "Tychaun Chapman", stat: "1" }] },
      { name: "REC", athletes: [{ id: "4685290", name: "Tychaun Chapman", stat: "0" }] },
    ] }] },
  ],
};
const memphisRoster = [{ id: 4685290, firstName: "Tychaun", lastName: "Chapman", position: "RB", team: "Memphis" }];
const picks = [{ schoolName: "Memphis", position: "RB" as const }, { schoolName: "UNLV", position: "RB" as const }];

describe("boxScoreFumbleCandidates", () => {
  it("charges the drafted RB slot for a fumble the play feed never attributed", () => {
    const result = boxScoreFumbleCandidates({ gameId: 401862693, school: "Memphis", box, roster: memphisRoster, selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map() });
    expect(result.available).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ sourceEventKey: "401862693:FUMBLE_LOST:RB:box", position: "RB", eventType: "FUMBLE_LOST", statValue: 1, provisional: false });
    expect(result.candidates[0].note).toContain("Tychaun Chapman");
  });

  it("ignores the ' Team' bucket and players with LOST = 0 (UNLV recovered its own fumble)", () => {
    const result = boxScoreFumbleCandidates({ gameId: 401862693, school: "UNLV", box, roster: [{ id: 4685388, position: "RB" }], selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map() });
    expect(result.available).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });

  it("does not double-charge when the play feed already wrote the fumble for that slot", () => {
    const result = boxScoreFumbleCandidates({ gameId: 401862693, school: "Memphis", box, roster: memphisRoster, selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map([["RB", 1]]) });
    expect(result.candidates).toHaveLength(0);
  });

  it("reports unavailable (so play-derived fumbles stay in force) when there is no box score at all", () => {
    const result = boxScoreFumbleCandidates({ gameId: 1, school: "Memphis", box: undefined, roster: memphisRoster, selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map() });
    expect(result.available).toBe(false);
  });

  it("treats a team with no fumbles category as available with zero fumbles (USC / FSU / Illinois in week 1)", () => {
    const result = boxScoreFumbleCandidates({ gameId: 2, school: "USC", box: { id: 2, teams: [{ team: "USC", categories: [{ name: "passing", types: [] }] }] }, roster: [], selectedSchoolPositions: [{ schoolName: "USC", position: "QB" }], alreadyWrittenBySlot: new Map() });
    expect(result).toEqual({ available: true, candidates: [] });
  });

  it("matches when the roster carries ids as strings (the actual feed), and falls back to name when the id is absent", () => {
    const stringIdRoster = [{ id: "4685290" as unknown as number, firstName: "Tychaun", lastName: "Chapman", position: "RB" }];
    expect(boxScoreFumbleCandidates({ gameId: 401862693, school: "Memphis", box, roster: stringIdRoster, selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map() }).candidates).toHaveLength(1);
    const noIdRoster = [{ id: 1, firstName: "Tychaun", lastName: "Chapman", position: "RB" }];
    expect(boxScoreFumbleCandidates({ gameId: 401862693, school: "Memphis", box, roster: noIdRoster, selectedSchoolPositions: picks, alreadyWrittenBySlot: new Map() }).candidates).toHaveLength(1);
  });
});
