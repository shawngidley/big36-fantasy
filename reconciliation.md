# Big 36 Year 1 Blueprint Reconciliation

**Reviewed:** Original Big 36 blueprint supplied by the commissioner, plus later confirmed decisions: owners draft their own teams through the site; the data layer is Supabase; CollegeFootballData Tier 3 is the intended live-data source; QB and touchdown scorer both receive passing-touchdown tier credit; touchdown tier uses snap yardline-to-goal; and Year 1 scoring is limited to touchdown/conversion, kicker, and DEF/ST rules.

## Executive conclusion

**Everything required for the original Year 1 league can be built.** The current application already supplies the core owner accounts, commissioner workspace, owner draft flow, public standings pages, weekly views, team pages, position leaderboards, Supabase persistence, and score-event audit design. However, the app must be corrected from an earlier, incorrect FLEX/yardage configuration to the original **K** and touchdown-only rules before it should be used for the pilot.

The automated data source is selected but not connected: CollegeFootballData Tier 3 must be subscribed to, its key added, and its live output validated during an actual FBS game. The live integration must enforce the original 12-game regular-season cap and exclude championship, bowl, and playoff games.

## Format and league operations

| Original blueprint requirement | Current status | Reconciliation |
|---|---|---|
| 36 owners in six divisions of six | **Built** | The commissioner can create six editable divisions and assign owners. Server guards now reject a seventh owner in any division and reject a thirty-seventh league owner. |
| $100 entry / $3,600 pool | **Operational policy** | No payment collection or payout tracking is built. This is appropriate for a private Year 1 league; the commissioner can collect and distribute funds outside the site. |
| Three $1,200 prize pools: division champions, six position champions, Big 36 champion | **View support; payout ledger not built** | Division and position standings support identifying winners. A commissioner payout screen is not yet present. |
| No trades, waivers, or weekly lineup decisions | **Built by omission** | The application has no roster transaction, waiver, trade, or lineup system. Owners draft once and follow the results. |
| 136 FBS programs available | **Planned safeguard** | Picks are presently typed as school names. The live-data integration should load and validate the official current FBS school list before the draft so non-FBS, misspelled, or duplicate school-position selections cannot be entered. |
| First 12 regular-season games only; no conference championships, bowls, or playoff games | **Not yet built** | This must be enforced by the automated schedule/import layer. The system should only score the first 12 completed regular-season games per selected school and ignore all later/postseason games. |

## Six position groups

| Original blueprint | Current application | Required correction |
|---|---|---|
| QB, RB, WR, TE, **K**, DEF/ST | QB, RB, WR, TE, **FLEX**, DEF/ST | Replace FLEX with **K** in the database enum, owner draft card, commissioner plan, active rounds, duplicate lock, public draft board, team page, and leaderboards. |
| A school's group receives production from athletes rostered at that position, regardless of how they score | Planned live mapping | The CFBD integration must map each player event to the player’s official roster position, then credit the drafted school-position group. This applies, for example, when a WR scores on a rushing play. |
| DEF/ST combined for Year 1 | Present | Retain a single combined DEF/ST group. |

## Original Year 1 scoring — authoritative specification

> **No accumulated yardage points.** The original document makes Year 1 intentionally simple.

| Group | Official Year 1 scoring | Current state |
|---|---|---|
| QB / RB / WR | TD at 0–29 yards: 6; 30–59: 9; 60+: 12; successful two-point conversion: 3 | Needs rule replacement. The current generic engine still exposes accumulated-yardage event types. |
| TE | TD at 0–9 yards: 6; 10–59: 9; 60+: 12; successful two-point conversion: 3 | Needs rule replacement. |
| K | Extra point: 3; field goal at 49 yards or less: 6; field goal at 50+: 12; no negative points for misses | Not built because the current sixth slot is FLEX. |
| DEF/ST | Interception: 3; fumble recovery: 3; defensive TD: 12; punt-return TD: 12; kickoff-return TD: 12; shutout: 12 | The generic event model can support it, but must be limited to these exact values. |

### Confirmed interpretation added after the original document

For a passing touchdown, the **QB** receives the applicable touchdown tier and the scoring receiver/rusher also receives that tier. The tier uses **yardline-to-goal at the snap**. This is a confirmed additional rule and should be shown in the commissioner rulebook.

## Draft format

| Original blueprint requirement | Current status | Reconciliation |
|---|---|---|
| Six separate 36-pick drafts: QB, RB, WR, TE, K, DEF/ST | **Built structurally; K correction required** | The commissioner opens an active position round and only the eligible signed-in owner can submit the next pick. Change FLEX to K. |
| Owners can draft their own selections | **Built** | Owners sign in with the email attached to their owner record and can only submit their assigned, active pick. |
| School-position combination locks after selection | **Built** | Supabase constraint and server validation prevent another owner from selecting the same school at the same position. |
| Six slots total exactly 111 | **Built** | Commissioner plan validation blocks an owner’s six-position draft plan unless it totals 111. |
| Early QB/RB/WR positions distributed fairly | **Partially built** | The system validates 111 but does not yet generate or validate premium-position balancing. Add a pre-draft planner that creates 36 auditable, balanced six-slot combinations. |
| One position per day / around 9:00 AM start | **Operationally supported** | Commissioner opens each round manually. Calendar scheduling, automatic open/close times, and GroupMe alerts are not built. |
| Pilot may use GroupMe | **Optional outside workflow** | The site can replace the manual pick board; GroupMe can remain a social/chat channel. No GroupMe integration is needed for Year 1. |

## Website and data experience

| Original website need | Current status | Reconciliation |
|---|---|---|
| Big 36 overall standings | **Built** | Public read-only standings view is present. |
| Six division standings | **Built** | Public division view is present once owners/divisions are configured. |
| Each team’s six selections and scoring | **Built structurally; K correction required** | Team pages show selections and scoring once data is loaded. |
| QB/RB/WR/TE/K/DEF-ST leaderboards | **Built structurally; K correction required** | Position leaderboards exist; FLEX must be replaced by K. |
| Weekly and season scoring | **Built structurally; automation pending** | Weekly views, audit events, and season totals exist. Live source integration will automate entries. |
| Simple Year 1 public-facing site | **Built** | The landing page, standings, draft board, and team views fit the pilot scope. |

## Live-data automation

| Requirement | Status | Implementation rule |
|---|---|---|
| CollegeFootballData Tier 3 | **Selected; key not yet connected** | The commissioner subscribes and supplies a server-only CFBD key. |
| Owner-facing live results | **Planned** | Use live game status to refresh affected school-position totals and public standings. |
| Deterministic audit trail | **Designed** | Persist each vendor play ID and derived scoring event, then upsert/reverse/recompute on updates or corrections. |
| Final reconciliation | **Planned** | Reconcile every selected school’s first 12 regular-season games against final play and player-stat data after each game. |
| Provider-proof fallback | **Required** | If a live feed cannot expose a needed attribution field in real time, mark that game provisional and reconcile to final data before weekly results are finalized. |

## Required corrections before launch

1. Load the original Year 1 point values and the confirmed passing-touchdown double-credit rule.
2. Add official FBS school validation and an automatic first-12 regular-season game cap.
3. Add a premium-position balance generator/checker for draft plans.
4. Add the CFBD Tier 3 key, run a live-game rehearsal, and validate raw live event attribution before the first paid game counts.

## Intentionally deferred from Year 1

Dynasty formats, multi-selection rosters, additional positions/categories, transactions, waivers, trade review, weekly lineups, payment processing, automated payouts, and future multi-league onboarding are not needed for the pilot and remain out of scope.
