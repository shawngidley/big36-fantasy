# Historical Play-by-Play Source Evaluation

## Purpose

The visible first-12-game 2025 statistics are certified from official CFBD player and team boxes. The remaining certification task is narrower: recover the **snap yardline-to-goal** for every historical touchdown, plus definitive special-teams and defensive event ownership, before tiered point totals are changed.

## Evidence hierarchy

| Priority | Source | Role in the 36 Football audit | Status |
|---|---|---|---|
| 1 | CFBD per-game player and team boxes | Authoritative first-12-game player and unit totals | Already in use for published visible statistics |
| 2 | cfbfastR v2 play-by-play | Reprocessed CFBD data with penalty enforcement, player attribution, play text, and `yards_to_goal` fields | Recommended first reconstruction pass |
| 3 | Public ESPN core play feed | Scoring-event ownership, normalized player participants, and snap `yardsToEndzone` recovery | Validated across all 879 first-12-game FBS contests; use as the immediate reconstruction source |
| 4 | CFBS/Tracking Football advanced data | Commercial every-play historical data for FBS teams | Recommended escalation when the no-new-cost reconstruction still lacks an event |
| 5 | Sportradar NCAA historical feeds | Commercial historical NCAA data source | Alternative provider if CFBS coverage or commercial terms do not fit |

## Findings

cfbfastR documents a version-two play feed with offensive and defensive team attribution, penalty enforcement resolution, player-name columns, free-text play descriptions, and a `yards_to_goal` field. Its public data introduction also describes season-level play-by-play loading from the cfbfastR data repository and identifies ESPN, CFBD, and that repository as the package's game-data surfaces. Those fields are directly relevant to the league's snap-distance touchdown tiers. [1] [4]

SportsDataverse's Python documentation confirms a Python-facing college-football surface for ESPN play-by-play, schedules, teams, and box scores. The cfbfastR 2.3.0 change log further documents 2025-verified ESPN game play-by-play, game player-box, participant, and team-attribution wrappers, including handling for penalty enforcement and special-teams team flips. [5] [6]

The audit cached ESPN core play feeds for all 879 unique 2025 first-12-game FBS contests. It recovered usable distance evidence for all 49 previously held QB touchdown events and all 10 initially identified CFBD scoring-distance gaps. The core feed also exposes structured per-play participants, scoring type, penalty state, start yards-to-endzone, and team participation. These results supersede the earlier concern that public ESPN scoring summaries alone would be insufficient.

The normalized cfbfastR feed marks successful two-point conversions, but some records retain the preceding touchdown as the primary `pass_td` or `rush_td` payload and place the conversion only in the appended clause. Historical reconstruction must therefore treat the conversion as a separate +4 event and must not count the same record twice as a touchdown. The league rule is now explicit: passing conversions credit both the QB and receiver unit, while rushing conversions credit only the scorer.

As of the current controlled reconciliation run, all retained offensive touchdowns have a usable normalized pre-snap distance. The structured ledger exactly matches the first-12-game control for 78 QB, 93 RB, 99 WR, and 118 TE units. The remaining ownership exceptions are bounded to 34 events after excluding defensive scoring rows; they primarily involve archived roster-name gaps, clearly identified trick plays, and incomplete conversion clauses. These exceptions remain held rather than inferred.

K/ST and DEF were separately tested against the same first-12-game CFBD team-box controls. Normalized scoring records reliably expose many made field goals, PATs, blocked punts, safeties, and defensive returns, but their structured field-goal distance is absent for a material alternate text format and their event totals do not universally reconcile to official team totals. Textual field-goal parsing improves evidence coverage but does not resolve every field-goal, PAT, or return discrepancy. Cached CFBD play-stat records also do not fully reconcile to the official DEF sack and interception controls. Consequently, K/ST and DEF historical point totals remain held; no partial special-teams or defensive total will be presented as complete.

The cached ESPN core feed materially improved K/ST evidence. It supports made-field-goal distances, successful PAT clauses, ordinary kickoff/punt return touchdowns, blocks, and blocked-punt safeties. The expanded normalized cfbfastR candidate feed independently matched 139 of 140 ESPN core block events and both special-teams safety events, providing useful corroboration but not an authoritative first-12-game component control. Therefore, every K/ST total containing a block or special-teams safety remains held; 34 units with fully reconciled made-kick and ordinary-return components are certified, while 102 K/ST totals remain explicitly held.

A follow-up first-12-game cfbstats Misc. Defense Game Log audit retrieved blocked-kick controls for 132 FBS units. Only 92 of those controls agreed with the ESPN-core block ledger; 40 differed, including programs with a source-recorded block absent from the event feed. The disagreement confirms that corroboration alone cannot close the block component. The catalog therefore continues to hold every block- or special-teams-safety-dependent K/ST total pending a complete authoritative component source.

The ESPN core DEF reconstruction did not produce a publishable defensive total. It recovered many defensive return distances, but none of the 136 units reconciled simultaneously to CFBD first-12-game box controls for sacks, interceptions, defensive touchdowns, and shutouts. A follow-on cfbfastR defensive-possession reconstruction resolved several sack and interception ownership gaps and reached 10 visible-control matches, but it still lacks complete fumble-recovery and defensive-touchdown component controls. All DEF historical point totals therefore remain explicitly held; the available sources are retained only as an audit trail pending a complete defensive event feed or independent component controls.

CFBS states that its advanced and complete packages include detailed every-play data for all FBS teams, with historical coverage available in the complete package. That makes it a practical escalation source for games where the public CFBD or ESPN evidence is incomplete. [2]

Sportradar documents historical NCAA football availability from 2013 onward and season-year-accessible feeds. It is a commercial alternative that can be evaluated if a broader vendor relationship is preferred. [3]

## Recommendation

The next pass should use the cached ESPN core feed as the primary distance and participant reconstruction layer, while retaining CFBD player and team boxes as the stat-line authority. cfbfastR remains a useful normalization check for difficult penalty, defensive, or special-teams scenarios. Any event still lacking complete evidence should remain held. If neither public source can fill the event, the league should obtain a complete historical play-by-play package from CFBS/Tracking Football or evaluate Sportradar, then reconcile the retained source event before a point total is released.

> **Accuracy rule:** A certified player or team statistic may be published. A tiered point value may not be inferred from a season total, scoreboard result, or incomplete scoring description.

## References

[1]: https://cfbfastr.sportsdataverse.org/reference/cfbd_pbp_data.html "cfbfastR play-by-play data reference"

[2]: https://cfbstats.com/ "CFBStats and Tracking Football data packages"

[3]: https://developer.sportradar.com/football/docs/ncaafb-ig-historical-data "Sportradar NCAA football historical data"

[4]: https://cfbfastr.sportsdataverse.org/articles/intro.html "Introduction to cfbfastR"

[5]: https://sportsdataverse-py.sportsdataverse.org/ "SportsDataverse Python documentation"

[6]: https://cfbfastr.sportsdataverse.org/news/index.html "cfbfastR change log"
