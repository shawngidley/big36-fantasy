# 2025 Quarterback Stat-Line Certification

**Date:** 2026-08-19  
**Scope:** Every 2025 FBS quarterback unit displayed in the 36 Football research catalog.  
**Window:** Each school’s first 12 completed regular-season games, ordered by scheduled kickoff.

## Certification Result

The visible quarterback stat lines were certified against CollegeFootballData per-game player box scores and published to the research catalog. The update changed 124 of 136 QB cards and then re-read every row from Supabase. The final overlay verification found **136 of 136** public QB stat summaries equal to the certified first-12-game totals.

| Field shown on the public QB card | Certification authority | Published status |
|---|---|---|
| Total touchdowns | Sum of QB passing TD and QB rushing TD in the first 12 CFBD player boxes | Certified for all 136 schools |
| Passing touchdowns | QB passing-TD total in the first 12 CFBD player boxes | Certified for all 136 schools |
| Interceptions | QB passing-INT total in the first 12 CFBD player boxes | Certified for all 136 schools |
| Tiered fantasy points | Touchdown-distance reconciliation | Preserved from the prior catalog pending a separate nine-school event-tier audit |

> The certificate covers the **displayed QB stat line**. It does not claim that every pre-existing tiered fantasy-point total has completed its remaining distance-tier reconciliation.

## Source Hierarchy

CollegeFootballData player box scores are the authority for player ownership of passing touchdowns, rushing touchdowns, and interceptions. ESPN scoring summaries are used only as an event-level cross-check for touchdown descriptions and the scoring-play identifier, which can be joined to CollegeFootballData play records for snap yardline-to-goal. The cross-check reconciled 127 schools exactly; nine schools remain in the tier-only exception queue. These exceptions do not block publication of the certified player stat line.

| Layer | Role | Known boundary |
|---|---|---|
| CFBD player box score | Authoritative QB passing TD, rushing TD, and INT ownership | Does not itself carry the league’s snap yardline-to-goal tier |
| ESPN scoring summary | Cross-checks touchdown scorer/description and scoring-event identifier | Some summaries vary in play labels or postseason/source window handling |
| CFBD play-by-play | Supplies snap yardline-to-goal for tiered scoring | Some historical feeds contain duplicate, nullified, alternate, or incomplete scoring representations |

## Texas Validation

Texas is included in the certified overlay. Its public first-12-game QB card now shows **33 total QB touchdowns, 25 passing touchdowns, and 7 interceptions**. These visible counts are the sum of official first-12-game QB player boxes and exclude the postseason.

## Remaining Tier Audit

Nine schools remain in the non-published touchdowndistance-tier review queue: Arizona, Ball State, Cincinnati, Colorado State, Houston, Tennessee, UCF, UNLV, and Western Kentucky. The research page continues to show the pre-existing tiered point totals for all QB units until that queue is reconciled; no provisional tier recalculation was written.

## References

[1] [CollegeFootballData API — Getting Started](https://api.collegefootballdata.com/getting-started)  
[2] [CollegeFootballData API — Games / Player Statistics](https://api.collegefootballdata.com/games/players)  
[3] [ESPN College Football Game Summary API example](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401754525)
