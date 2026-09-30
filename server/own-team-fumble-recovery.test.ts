import { describe, expect, it } from "vitest";
import { fumbleRecoveryFromText, mapLivePlayToCandidates, textTeamTokenMatchesSchool } from "./live-scoring";

// Every play below is verbatim CFBD text from week 4 (Sept 27, 2026) games, taken from the site's
// own scoring ledger. The "own recovery" group was scored as a takeaway (+3 DEFENSIVE_TURNOVER and,
// where the fumbling unit was drafted, -3 FUMBLE_LOST) that the NCAA week-4 audit report does not
// have: the ball never changed hands, so the official book shows nothing for these plays. The
// "genuine takeaway" group is credited in that same report and must keep scoring.
const dst = (school: string) => ({ schoolName: school, position: "DST" as const });
const qb = (school: string) => ({ schoolName: school, position: "QB" as const });
const wr = (school: string) => ({ schoolName: school, position: "WR" as const });
const types = (candidates: ReturnType<typeof mapLivePlayToCandidates>) => candidates.map(candidate => `${candidate.schoolName}:${candidate.eventType}`).sort();

describe("textTeamTokenMatchesSchool", () => {
  it("resolves the abbreviations CFBD actually writes after 'recovered by'", () => {
    expect(textTeamTokenMatchesSchool("TEXAS", "Texas")).toBe(true);
    expect(textTeamTokenMatchesSchool("TENN", "Tennessee")).toBe(true);
    expect(textTeamTokenMatchesSchool("ASU", "Arkansas State")).toBe(true);
    expect(textTeamTokenMatchesSchool("TAMU", "Texas A&M")).toBe(true);
    expect(textTeamTokenMatchesSchool("TOLEDO", "Toledo")).toBe(true);
    expect(textTeamTokenMatchesSchool("NW", "Northwestern")).toBe(true);
    expect(textTeamTokenMatchesSchool("TXST", "Texas State")).toBe(true);
    expect(textTeamTokenMatchesSchool("NEB", "Nebraska")).toBe(true);
    expect(textTeamTokenMatchesSchool("WASH", "Washington")).toBe(true);
    expect(textTeamTokenMatchesSchool("KSU", "Kennesaw State")).toBe(true);
    expect(textTeamTokenMatchesSchool("UND", "Notre Dame")).toBe(true);
    expect(textTeamTokenMatchesSchool("FST", "Fresno State")).toBe(true);
    expect(textTeamTokenMatchesSchool("u m", "Michigan")).toBe(true);
  });
  it("does not let one team's abbreviation fit the other team on the play", () => {
    expect(textTeamTokenMatchesSchool("TEXAS", "Tennessee")).toBe(false);
    expect(textTeamTokenMatchesSchool("TENN", "Texas")).toBe(false);
    expect(textTeamTokenMatchesSchool("ASU", "Kennesaw State")).toBe(false);
    expect(textTeamTokenMatchesSchool("TAMU", "LSU")).toBe(false);
    expect(textTeamTokenMatchesSchool("NW", "Indiana")).toBe(false);
    expect(textTeamTokenMatchesSchool("WASH", "Minnesota")).toBe(false);
    expect(textTeamTokenMatchesSchool("FST", "USC")).toBe(false);
    expect(textTeamTokenMatchesSchool("UMD", "UCLA")).toBe(false);
  });
  it("reports no match for nicknames and abbreviations it cannot derive, so callers keep their existing behavior", () => {
    expect(textTeamTokenMatchesSchool("Hokies", "Virginia Tech")).toBe(false);
    expect(textTeamTokenMatchesSchool("CANES", "Miami")).toBe(false);
    expect(textTeamTokenMatchesSchool("UGA", "Georgia")).toBe(false);
    expect(fumbleRecoveryFromText({ normalizedText: "fumbled by 81 r beers at ou 28 forced by 14 r dinkins recovered by uga 14 r dinkins at ou 28", offense: "Oklahoma", defense: "Georgia", possessingSchool: "Oklahoma" })).toBeNull();
  });
});

describe("own-team fumble recoveries are not takeaways (week-4 NCAA audit)", () => {
  it("Texas rush, fumbled by Texas, recovered by TEXAS: no Tennessee takeaway and no Texas fumble lost (was -3 Texas QB / +3 Tennessee DST)", () => {
    const play = { id: 401856704316, gameId: 401856704, offense: "Texas", defense: "Tennessee", scoring: false, playType: "Fumble Recovery (Own)", playText: "(10:16) No Huddle-Shotgun Texas rush middle for 12 yards loss to the TEXAS26 fumbled by Texas at recovered by TEXAS #16 A.Manning at TEXAS26 (#5 D.Hobbs)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 1, firstName: "Arch", lastName: "Manning", position: "QB" }], selectedSchoolPositions: [dst("Tennessee"), qb("Texas")] });
    expect(types(candidates)).toEqual([]);
  });

  it("Tennessee sack-fumble recovered by TENN with no recoverer named: sack stands, no Texas takeaway, no Tennessee fumble lost (was +3 Texas DST / -3 Tennessee QB)", () => {
    const play = { id: 401856704710, gameId: 401856704, offense: "Tennessee", defense: "Texas", scoring: false, playType: "Sack", playText: "(11:03) No Huddle-Shotgun #11 F.Brandon sacked for loss of 8 yards to the TENN16 (#1 C.Simmons), fumble by #11 F.Brandon recovered by TENN  at, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 1, firstName: "Faizon", lastName: "Brandon", position: "QB" }], selectedSchoolPositions: [dst("Texas"), qb("Tennessee")] });
    expect(types(candidates)).toEqual(["Texas:SACK"]);
  });

  it("Arkansas State fumble recovered by ASU, both the final text (team named) and the live text (fumbler blank): no Kennesaw State takeaway", () => {
    const final = { id: 40186993175, gameId: 401869931, offense: "Arkansas State", defense: "Kennesaw State", scoring: false, playType: "Fumble Recovery (Own)", playText: "(07:58) Shotgun Arkansas State rush middle for 6 yards loss to the KSU31 fumbled by Arkansas State at KSU31 recovered by ASU #9 T.Owens at KSU31, End Of Play" };
    const live = { ...final, id: 940186993175, playText: "(07:58) Shotgun  rush for 6 yards loss to the KSU31 fumbled by  at KSU31 recovered by ASU #9 T.Owens at KSU31, End Of Play" };
    for (const play of [final, live]) {
      expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Kennesaw State")] }))).toEqual([]);
    }
  });

  it("Nebraska receiver fumbles, a different Nebraska player (NEB #51) recovers: no FUMBLE_LOST for the Nebraska WR (was -3)", () => {
    const play = { id: 401858464247, gameId: 401858464, offense: "Nebraska", defense: "Michigan State", scoring: false, playType: "Fumble Recovery (Own)", playText: "Shotgun #10 A.Colandrea pass complete short middle to #2 J.Barney Jr. caught at MSU32, for 12 yards to the MSU17 fumbled by #2 J.Barney Jr. at MSU28 forced by #4 C.Brantley recovered by NEB #51 J.Evans at MSU17, End Of Play, 1ST DOWN" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 2, firstName: "Jacory", lastName: "Barney Jr.", position: "WR" }], selectedSchoolPositions: [wr("Nebraska"), dst("Michigan State")] });
    expect(types(candidates)).toEqual([]);
  });

  it("Texas State sack-fumble recovered by TXST: sack only (was -3 Texas State QB)", () => {
    const play = { id: 401860892859, gameId: 401860892, offense: "Texas State", defense: "Incarnate Word", scoring: false, playType: "Sack", playText: "(07:43) No Huddle-Shotgun #17 G.Parkhurst sacked for loss of 7 yards to the TXST20 (#91 L.Johnson), fumble by #17 G.Parkhurst recovered by TXST #58 A.Rhodes at TXST20, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 17, firstName: "Grady", lastName: "Parkhurst", position: "QB" }], selectedSchoolPositions: [qb("Texas State"), dst("Incarnate Word")] });
    expect(types(candidates)).toEqual(["Incarnate Word:SACK"]);
  });

  it("Northwestern fumbles in its own end zone and recovers for a safety: Indiana keeps the safety, loses the phantom +3 recovery", () => {
    const play = { id: 40185846186, gameId: 401858461, offense: "Northwestern", defense: "Indiana", scoring: true, scoringTeam: "Indiana", playType: "Safety", playText: "(07:25) Northwestern rush middle for 1 yard loss to the NW 00 fumbled by Northwestern at NW 00 recovered by NW  #0 A.Chiles at NW 00 (#17 D.Ndukwe). #17 D.Ndukwe SAFETY, clock 07:20" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Indiana")] });
    expect(types(candidates)).toEqual(["Indiana:DEFENSIVE_SAFETY"]);
  });

  it("Washington back fumbles, Washington lineman recovers: no Minnesota takeaway", () => {
    const play = { id: 401858470154, gameId: 401858470, offense: "Washington", defense: "Minnesota", scoring: false, playType: "Rush", playText: "(00:51) Shotgun #22 T.Cooley rush middle for 4 yards gain to the WASH46 fumbled by #22 T.Cooley at WASH44 forced by #1 J.Howard recovered by WASH #76 K.Greene at WASH46, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Minnesota")] }))).toEqual([]);
  });

  it("live text with the rusher blank, recovered by UCLA on a UCLA play: no Maryland takeaway", () => {
    const play = { id: 9401858462445, gameId: 401858462, offense: "UCLA", defense: "Maryland", scoring: false, playType: "Rush", playText: "(13:35) Shotgun  rush for 0 yards to the UCLA34 fumbled by  at UCLA33 recovered by UCLA #74 J.Armella at UCLA34, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Maryland")] }))).toEqual([]);
  });

  it("muffed kickoff recovered by the returning team (TAMU, by the same player): no LSU takeaway - the muff path skipped the jersey check entirely", () => {
    const play = { id: 401856702568, gameId: 401856702, offense: "LSU", defense: "Texas A&M", scoring: false, playType: "Kickoff", playText: "(00:31) #80 S.Starzyk kickoff 64 yards to the TAMU01 muffed by #4 R.Owens II at TAMU01 recovered by TAMU #4 R.Owens II at TAMU01, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("LSU"), dst("Texas A&M")] }))).toEqual([]);
  });

  it("muffed kickoff recovered by TOLEDO with no recoverer named: no San Diego State takeaway (San Diego State DST 3 -> NCAA 0)", () => {
    const play = { id: 40186089361, gameId: 401860893, offense: "San Diego State", defense: "Toledo", scoring: false, playType: "Kickoff", playText: "(11:59) #96 C.DiLeva kickoff 62 yards to the TOLEDO03 muffed by #19 D.Barnett Jr. at TOLEDO03 recovered by TOLEDO  at TOLEDO03, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("San Diego State"), dst("Toledo")] }))).toEqual([]);
  });

  it("muffed punt recovered by the returner's own team (IOWA): no Michigan takeaway", () => {
    const play = { id: 401858463355, gameId: 401858463, offense: "Michigan", defense: "Iowa", scoring: false, playType: "Punt", playText: "(00:42) #33 C.Brown punt 40 yards to the IOWA38 muffed by #8 E.James at IOWA38 recovered by IOWA #8 E.James at IOWA39, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Michigan"), dst("Iowa")] }))).toEqual([]);
  });

  it("interception, then the intercepting player fumbles and his own team (Utah) recovers: one Utah takeaway, no Iowa State fumble lost or second takeaway", () => {
    const play = { id: 401856816856, gameId: 401856816, offense: "Iowa State", defense: "Utah", scoring: false, playType: "Interception", playText: "(00:08) No Huddle-Shotgun #1 J.Raynor pass intercepted by #7 B.Pegan at Utah00 #7 B.Pegan return 5 yards to the Utah05 fumbled by #7 B.Pegan at Utah05 forced by #9 O.Hayes recovered by Utah #7 B.Pegan at Utah05, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 1, firstName: "Josh", lastName: "Raynor", position: "QB" }], selectedSchoolPositions: [dst("Utah"), dst("Iowa State"), qb("Iowa State")] });
    expect(types(candidates)).toEqual(["Iowa State:INTERCEPTION_THROWN", "Utah:DEFENSIVE_TURNOVER"]);
  });
});

describe("genuine takeaways the same week still score", () => {
  it("Tennessee onside kick, Texas return fumbled, recovered by TENN: Tennessee takeaway (NCAA credits it)", () => {
    const play = { id: 401856704914, gameId: 401856704, offense: "Tennessee", defense: "Texas", scoring: false, playType: "Kickoff", playText: "(01:22) #98 J.Ross kickoff 12 yards to the TENN47 Texas return for loss of 2 yards to the TENN49 fumbled by Texas at TENN49 recovered by TENN #7 A.Carter at TENN49, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Tennessee"), dst("Texas")] });
    expect(types(candidates)).toEqual(["Tennessee:DEFENSIVE_TURNOVER"]);
  });

  it("UCLA back fumbles, Maryland (UMD) recovers: Maryland takeaway", () => {
    const play = { id: 401858462766, gameId: 401858462, offense: "UCLA", defense: "Maryland", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "(03:19) Shotgun #33 K.Cox rush left for 10 yards gain to the UMD03 fumbled by #33 K.Cox at UMD07 forced by #35 K.James recovered by UMD #14 S.Johnson at UMD03, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Maryland")] }))).toEqual(["Maryland:DEFENSIVE_TURNOVER"]);
  });

  it("Oklahoma receiver fumbles, recovered by UGA (an abbreviation that fits neither name): Georgia takeaway via the existing path", () => {
    const play = { id: 401856700452, gameId: 401856700, offense: "Oklahoma", defense: "Georgia", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "(08:59) Shotgun #10 J.Mateer pass complete short middle to #81 R.Beers caught at OU 28, for 8 yards to the OU 28 fumbled by #81 R.Beers at OU 28 forced by #14 R.Dinkins recovered by UGA #14 R.Dinkins at OU 28, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Georgia")] }))).toEqual(["Georgia:DEFENSIVE_TURNOVER"]);
  });

  it("Ole Miss sack-fumble recovered by FLA: Florida takeaway and Ole Miss QB fumble lost", () => {
    const play = { id: 401856699589, gameId: 401856699, offense: "Ole Miss", defense: "Florida", scoring: false, playType: "Sack", playText: "(02:47) Shotgun #6 T.Chambliss sacked for loss of 3 yards to the FLA43 (#0 J.Woods), fumble by #6 T.Chambliss recovered by FLA #5 M.Graham at FLA43, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [{ id: 6, firstName: "Trinidad", lastName: "Chambliss", position: "QB" }], selectedSchoolPositions: [dst("Florida"), qb("Ole Miss")] });
    expect(types(candidates)).toEqual(["Florida:DEFENSIVE_TURNOVER", "Florida:SACK", "Ole Miss:FUMBLE_LOST"]);
  });

  it("Rice QB #11 fumbles, Fresno State #11 recovers (same jersey number, other team): Fresno State takeaway - the same-number check alone dismissed this and Fresno State DST came up 3 short of the NCAA book", () => {
    const play = { id: 401860891466, gameId: 401860891, offense: "Rice", defense: "Fresno State", scoring: false, playType: "Sack", playText: "(07:10) Shotgun #11 J.Brown sacked for loss of 15 yards to the RICE19 (#35 T.Khajavi), fumble by #11 J.Brown recovered by FRES #11 D.Hampsten at RICE19, End Of Play" };
    expect(types(mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Fresno State")] }))).toEqual(["Fresno State:DEFENSIVE_TURNOVER", "Fresno State:SACK"]);
  });
});

describe("special-teams touchdown detection (week-4 NCAA audit)", () => {
  it("a passing touchdown whose glued-on text continues into the ensuing kickoff is not a special-teams return touchdown (Georgia DST was credited 12 for Stockton-to-Taylor)", () => {
    const play = { id: 401856700178, gameId: 401856700, offense: "Georgia", defense: "Oklahoma", scoring: true, scoringTeam: "Georgia", playType: "Pass Reception", playText: "(14:27) Shotgun #14 G.Stockton pass complete deep middle to #1 T.Taylor caught at OU 02, for 35 yards to the OU 00 TOUCHDOWN, clock 14:20, 1ST DOWN #91 P.Woodring kick attempt good (H: #14 G.Stockton, LS: #51 W.Snellings) (14:20) #91 P.Woodring kickoff 65 yards to the OU 00, Touchback (14:20) Shotgun #10 J.Mateer pass complete short right to #81 R.Beers caught at OU 31, for 6 yards to the OU 31, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [dst("Georgia"), dst("Oklahoma")] });
    expect(candidates.filter(candidate => candidate.eventType.endsWith("TOUCHDOWN"))).toEqual([]);
  });

  it("a real kickoff return touchdown keeps one stable key whether CFBD has typed it yet or not (Iowa's Jackson 99-yard return was credited twice, 24 points, under two keys)", () => {
    const text = "(01:58) #97 J.Baggett kickoff 64 yards to the IOWA01 #22 B.Jackson return 99 yards to the U-M00 TOUCHDOWN, clock 01:44 #92 C.Buhr kick attempt good";
    const base = { id: 401858463152, gameId: 401858463, offense: "Michigan", defense: "Iowa", scoring: true, scoringTeam: "Iowa", playText: text };
    const untyped = mapLivePlayToCandidates({ play: { ...base, playType: "Kickoff" }, stats: [], roster: [], selectedSchoolPositions: [dst("Iowa")] }).find(candidate => candidate.eventType.endsWith("TOUCHDOWN"));
    const typed = mapLivePlayToCandidates({ play: { ...base, playType: "Kickoff Return Touchdown" }, stats: [], roster: [], selectedSchoolPositions: [dst("Iowa")] }).find(candidate => candidate.eventType.endsWith("TOUCHDOWN"));
    expect(untyped?.eventType).toBe("OTHER_SPECIAL_TEAMS_TOUCHDOWN");
    expect(typed?.eventType).toBe("KICK_RETURN_TOUCHDOWN");
    expect(untyped?.sourceEventKey).toBe("401858463152:SPECIAL_TEAMS_TOUCHDOWN");
    expect(typed?.sourceEventKey).toBe(untyped?.sourceEventKey);
  });
});
