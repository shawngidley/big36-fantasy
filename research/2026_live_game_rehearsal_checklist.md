# 2026 Live Game Scoring Rehearsal Checklist

**Target event:** TCU vs. North Carolina, August 29, 2026, Aviva Stadium, Dublin. The schools’ published schedules and the NCAA game listing confirm the matchup; the exact kickoff record used by the application must be rechecked in CollegeFootballData before the rehearsal because public schedule displays may use different time zones. [1] [2] [3]

> **Purpose:** This is an operational validation of the deployed CollegeFootballData refresh path, not a reason to manufacture scoring data. The rehearsal must use only official live or final source events, and every observed discrepancy must remain in the audit log.

## Preconditions

| Gate | Required evidence | Pass condition |
| --- | --- | --- |
| Scheduled refresh | Heartbeat task `Ay38KpZYbCDeZsGf4pTGtk` is enabled and points to the deployed callback. | The task is enabled, has a recent successful run, and the callback path remains authenticated cron-only. |
| Provider access | CollegeFootballData scoreboard and live play-by-play endpoints respond for the 2026 season. | The game appears with an authoritative CFBD game identifier before kickoff. |
| Relevant selection | At least one legitimate, commissioner-approved draft slot is assigned to TCU or North Carolina. | The refresh identifies the game as relevant without test data or fabricated selections. |
| Rule deployment | The live build includes the signed reversal correction fix. | A removed negative event would emit a positive offset, and a removed positive event would emit a negative offset. |
| Observer record | Commissioner has this checklist and the public correction ledger open. | Each observation can be timestamped against the provider event. |

## Rehearsal Procedure

| Timing | Commissioner action | Expected system evidence |
| --- | --- | --- |
| T−60 to T−15 minutes | Confirm the CFBD schedule record, game identifier, kickoff status, and that the scheduled job is enabled. Do not make manual scoring entries. | Automation status shows a successful refresh or a clear non-game skip reason. |
| First live refresh | Check the automation status and source-game record after the first active-game poll. | The game is recognized as active when a selected TCU or North Carolina position makes it relevant. |
| First attributable scoring event | Compare the source play, source event key, unit position, yardline-to-goal tier, and displayed point delta. | One idempotent `ENTRY` audit event is present; repeat polls do not duplicate it. |
| First turnover or conversion | Compare QB/receiver and rushing attribution against the official play text. | The event uses the approved two-point and turnover rules and appears in the public ledger with a source key. |
| Halftime | Check standings, weekly summary, and the correction ledger. | Summed event deltas reconcile to the affected program and team totals. |
| Finalization | After CFBD marks the game final, compare all relevant ledger events with the final official play record. | Provisional events become final, unchanged keys are not duplicated, changed keys create signed `CORRECTION` deltas, and removed keys create signed `REVERSAL` deltas. |
| T+30 minutes | Check the Heartbeat execution record and public pages. | Refresh status is `ok`; standings and public audit detail agree with the final ledger. |

## Required Audit Record

Record the following for each observed event in the commissioner log: the CFBD game identifier, source event key, source play text or authoritative reference, poll timestamp, affected school-position unit, expected signed point delta, displayed signed point delta, and whether the event is provisional, corrected, or reversed.

| Outcome | Action |
| --- | --- |
| All checkpoints reconcile | Mark the live refresh verified for this game and retain the audit record. |
| Provider event arrives late or changes | Allow the deployed signed correction/reversal flow to reconcile it; do not edit a live source event in place. |
| Attribution is ambiguous | Hold the affected live event for commissioner review and document the source ambiguity. |
| Scheduler or provider call fails | Preserve the failure record, inspect the scheduled callback logs, and retry only through the normal idempotent refresh path. |

## References

[1] [North Carolina 2026 Football Schedule](https://goheels.com/sports/football/schedule/2026)

[2] [TCU 2026 Football Schedule](https://gofrogs.com/sports/football/schedule)

[3] [NCAA Game Listing: TCU vs. North Carolina](https://www.ncaa.com/game/6604316)
