# Big 36 Live-Stats Provider Research

## Required capabilities

Big 36 needs FBS schedules, active team/player rosters and positions, real-time player and defensive events, scoring-play distance, game status, stat corrections, and a stable event ID so corrections can reverse and recompute the audit ledger without creating duplicate points.

## Verified candidates

| Provider | Verified coverage | Delivery | Cost visibility | Fit |
|---|---|---|---|---|
| Sportradar NCAA Football API | 100% Division I coverage, realtime FBS play-by-play, team/player stats, rosters, game statistics, expected latency, and daily change log. | REST, plus Realtime-only HTTP chunked Push Events and Push Statistics feeds. | Enterprise sales quote; Push is an add-on. | Recommended production source for exact play-level scoring and correction handling. |
| SportsDataIO College Football API | Every D1 FBS game; live game state; live player/team stats typically 15-20 seconds behind TV; rosters; live/final box scores; scoring-play records. | REST polling / delta-style feeds documented. | Sales quote. | Strong alternative; a trial must prove raw live scoring-play attribution and touchdown-distance fields for every Big 36 rule before production use. |
| CollegeFootballData | Live scoreboard in Tier 1; live play-by-play from Tier 2; GraphQL marked as available from Tier 3. | API calls; public pricing. | Tier 2: $5/month and 30k calls; Tier 3: $10/month and 75k calls. | Lowest-cost pilot; must be benchmarked for update delay, event corrections, and call volume before relying on it for a paid league. |

## Operations

For seconds-level live scoring, operate a persistent stream consumer: normalize each vendor event, upsert by vendor event ID, recompute the affected selected school-position group, and write an idempotent audit record. Schedule a postgame reconciliation with the vendor's final box score and change log. A minute-level polling fallback can run without an always-on process but will not match push latency.

## CollegeFootballData Tier 3 validation

Tier 3 provides GraphQL access and subscriptions, but the provider's GraphQL materials label the API experimental and note that drive/play and basic game/player statistics were not part of its initial GraphQL coverage. The Big 36 implementation must therefore treat GraphQL subscriptions as optional for game-status display only. Its scoring authority should be the Tier 2+ live REST play-by-play feed, using each play identifier as the idempotency key, plus final player/game-stat reconciliation.

The published play-by-play data model supports the required raw ingredients: a unique play ID, touchdown and offensive/defensive scoring flags, passing/rushing/receiving yardage and player fields, sacks, interceptions, forced/recovered fumbles, return yardage, blocked-kick fields, field-goal fields, and play-level score information. Roster/athlete position is queryable independently. A paid-key rehearsal must still confirm the live REST response includes stable player identifiers (rather than names only) for every selected FBS game.

Two league definitions still need to be locked before code can calculate all points deterministically: whether passing-touchdown points are awarded to QB in addition to the receiving/rushing scorer, and which yardage defines a passing-touchdown tier. The recommended convention is to award the passing QB and the scoring receiver/rusher separately, using the play's recorded passing/rushing/receiving yardage by scoring role.

The current REST v2 documentation confirms that `GET /plays` can retrieve an entire week of historical plays in one request and that `GET /plays/stats` returns player/play-stat associations with both `playId` and `athleteId`. The distinct `GET /live/plays?gameId=` endpoint returns a live game snapshot including drives and plays, but its documented nested live-play schema does not show player attribution or play-stat associations. Therefore, use `/live/plays` only to identify in-progress games; use `/plays` plus `/plays/stats` to create the official Big 36 scoring events. This means Tier 3 can automate the majority of the rules, but we must test a paid live game to prove the live availability and correction timing of player-attributed play stats.

The API documentation shows the key raw fields needed for automation: stable play ID; offense/defense; yardage; scoring flag; play type/text; player-attributed play stats; and current status/drives. Independent CFBD material documents derived player attribution for rush/pass/receive, sacks, interceptions, fumbles/recoveries, kick/punt/field-goal returns and blocks, plus offensive and defensive scoring flags. Treat that material as supporting evidence only until a Tier 3 live-key sample validates the raw REST event payload.

## Validated Tier 3 key sample — 2025 FBS data

The supplied Tier 3 key successfully authenticated against `GET /teams/fbs?year=2026`. A completed 2025 regular-season game sample from `GET /games?year=2025&week=1&seasonType=regular` verified the game identity, `seasonType: "regular"`, `completed`, `homeClassification`/`awayClassification`, team names, start date, and final scores required to enforce the pilot’s first-12-regular-season-game limit.

The documented `GET /plays` endpoint rejected a `gameId` filter for the tested API version but accepted the week-and-team filter: `GET /plays?year=2025&week=1&seasonType=regular&team=Iowa%20State`. Its play records included a stable `id`, `gameId`, `offense`, `defense`, `yardsToGoal`, `yardsGained`, `scoring`, `playType`, and `playText`. A passing-touchdown example had `yardsToGoal: 4` at snap, confirming the field needed for the commissioner’s confirmed TD-tier convention.

`GET /plays/stats?year=2025&week=1&seasonType=regular&team=Iowa%20State` returned player-attributed rows keyed by the same `playId`, including `athleteId`, athlete name, team, `statType`, stat, and `yardsToGoal`. A verified passing-touchdown play joined to a QB `Touchdown` stat and a receiver `Reception` stat under the shared play ID. The `GET /roster?team=Iowa%20State&year=2025` response supplied athlete IDs and official `position` values. This confirms the planned role mapping: use roster position—not play action—to credit each drafted school-position group, while creating a second QB scoring event for a passing touchdown under the confirmed double-credit rule.

The provider sample supports the planned score engine but must still be rehearsed during a live game to measure refresh timing and correction behavior. For automatic ingestion, use weekly/season REST filters rather than the unsupported per-game play filter observed in the sample.

## Sources

1. https://developer.sportradar.com/football/reference/ncaafb-overview
2. https://developer.sportradar.com/football/docs/ncaafb-ig-push
3. https://developer.sportradar.com/football/reference/ncaafb-play-by-play
4. https://sportsdata.io/developers/workflow-guide/ncaa-football
5. https://sportsdata.io/developers/data-dictionary/ncaa-football
6. https://collegefootballdata.com/api-tiers
7. https://graphqldocs.collegefootballdata.com/
8. https://radsportsanalytics.com/blog/building-dynamic-queries-and-data-subscriptions-with-the-new-cfbd-graphql-api/
9. https://cfbfastr.sportsdataverse.org/reference/cfbd_pbp_data.html
10. https://api.collegefootballdata.com/api/plays
11. https://radsportsanalytics.com/blog/api-v2-is-now-in-general-availability/
