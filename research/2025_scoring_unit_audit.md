# 2025 36 Football Scoring and Unit-Stat Audit

## Scope and source

This audit reconciled the published **2025 school-position research catalog** with the authoritative Year 1 rules, the live event mapper, and cached CollegeFootballData game, play, play-stat, and roster responses. CollegeFootballData provides the REST API used for game and player information in the league workflow.[1]

The audit preserved the approved scoring model: offensive touchdown tiers of **6 / 8 / 10 / 12** points at 1–9, 10–29, 30–59, and 60+ yards; dual QB-plus-scorer credit on passing touchdowns; separate K/ST and DEF groups; and the existing field-goal, block, turnover, safety, defensive-return, and shutout rules.

## Verified findings

The prior research build relied too heavily on CFBD player-stat rows for offensive attribution. Across the cached 2025 FBS passing and rushing touchdown plays, **542 of 4,893 plays (11.0%)** carried player-stat rows. The remaining plays still had official play type, play text, field-position, and roster information, so the catalog had materially undercounted many QB, RB, WR, and TE units.

A second verification, prompted by the Texas QB card, found that official CFBD play text frequently abbreviates athletes as forms such as **A. Manning**. The fallback matcher initially recognized only full names, which omitted valid touchdowns even after the player-stat coverage repair. The corrected matcher now accepts both normalized full names and first-initial-plus-surname forms while continuing to require a roster-position match.

The Texas review also identified two missing quarterback interception events where CFBD provided an official interception play but no player-stat row. A third apparent interception was a reversed placeholder: the same Texas drive immediately continued at the same game clock, confirming that possession did not change. The corrected scorer now attributes named quarterback interception plays from official text, while excluding that narrow same-drive continuation pattern.

The audit also verified two duplicate-risk paths. Passing touchdowns could be entered twice for QB in the prior historical build, and made field goals or PATs could be generated both from player-stat and play-text paths. Field-goal distance was additionally inconsistent between paths. CFBD play records expose the made-kick distance in `yardsGained` for the audited examples, so the corrected scorer uses that canonical value rather than a derived estimate.

| Unit group | Corrected attribution path | Published-catalog impact |
|---|---|---|
| **QB** | Canonical passing/rushing touchdown play types, official player stats when present, and full-name or initial-surname roster fallback from official play text | 136 units changed; +19,748 official points in aggregate |
| **RB** | Canonical rushing/passing touchdown attribution with full-name or initial-surname roster fallback | 135 units changed; +12,038 points |
| **WR** | Canonical passing-touchdown scorer attribution with per-play deduplication and abbreviated-name fallback | 135 units changed; +13,262 points |
| **TE** | Canonical passing-touchdown scorer attribution with per-play deduplication and abbreviated-name fallback | 122 units changed; +3,614 points |
| **K/ST** | One made-FG event per play using `yardsGained`; one PAT event per play | 86 units changed; +312 points |
| **DEF** | Existing 2025 historical calculation retained; live workflow now adds final-score shutout reconciliation | No historical catalog-total change |

## Corrections applied

The historical builder now creates one offensive touchdown event per credited position and uses roster-name fallback only where player-stat attribution is absent. The fallback accepts an official full name or a first-initial-plus-surname that resolves uniquely to an eligible roster position. Passing two-point conversions credit both the quarterback and scorer when an official successful conversion play can be resolved; rushing conversions credit the scorer. Failed conversion descriptions are excluded.

The live mapper now uses the same canonical event logic, deduplicates every source event by a stable play-position key, and uses `yardsGained` for made field-goal tiers. Final completed games now emit a DEF shutout event only for a selected defense that held its opponent scoreless. This keeps the live flow aligned with the historical catalog while retaining source-event corrections and reversals.

## Rebuild verification

The corrected builder recalculated all **816** school-position units and persisted them to Supabase. A post-rebuild comparison found **0 mismatches** between the recalculated totals and the stored catalog rows. For Texas, the first 12 regular-season games now correctly produce **25 QB-unit passing touchdowns, 33 total QB-unit touchdowns, seven interceptions, and 235 official points**. The public research view renders the refreshed unit data.

## Remaining live-validation boundary

The historical catalog and deterministic event mapping have been reconciled against the cached 2025 CFBD source records. The remaining launch validation is an **active FBS game rehearsal**: it must confirm the Tier 4 live scoreboard and live play-by-play payloads arrive during an actual game and that final correction/reversal behavior completes end to end. That is a live-provider availability validation, not a remaining known historical-calculation discrepancy.

## References

[1] [CollegeFootballData REST API: Getting Started](https://api.collegefootballdata.com/getting-started)
