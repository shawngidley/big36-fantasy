# Historical Component Source Probe — 2025 FBS

**Captured:** August 19, 2026

The official [NCAA Statistics portal](https://stats.ncaa.org/rankings/change_sport_year_div) exposes Football → 2025–26 → FBS ranking-period snapshots, including dated 2025 snapshots and team-stat categories such as **Blocked Kicks**, **Blocked Punts**, **Defensive TDs**, **Fumbles Recovered**, **Passes Intercepted**, and **Team Sacks**. The public interface presents national rankings rather than a readily exportable first-12-game team-event ledger, so it has not been used to overwrite the catalog.

The portal exposes reproducible FBS team-ranking endpoint identifiers under `academic_year=2026.0`, `division=11.0`, and `sport_code=MFB`: blocked kicks `stat_seq=785.0`, blocked punts `790.0`, defensive touchdowns `926.0`, fumbles recovered `456.0`, passes intercepted `457.0`, and team sacks `466.0`. The remaining work is to map its dated `ranking_period` values to each school’s twelfth completed regular-season game without replacing the catalog from a calendar-date snapshot that includes a different game count.

The official NCAA snapshot for November 29, 2025 (`ranking_period=60.0`) shows Texas with 12 games, **2 blocked kicks**, and **38 team sacks**. Texas’s normalized cfbfastR event ledger and cached CFBD first-12 control each total 36 sacks, while the cfbstats game log totals 39. This three-way disagreement confirms that no existing defensive control can be treated as publication-ready until the NCAA dated snapshots are mapped and reconciled program by program. The NCAA blocked-kick value does agree with the current Texas ESPN-core ledger (2), but a single spot check is insufficient for a catalog-wide release.

The NCAA portal also began returning HTTP 403 responses during automated multi-snapshot collection despite throttling, retry backoff, and on-disk snapshot caching. The source-audit script is retained in read-only, resumable form, but the catalog will not be changed until full official coverage can be collected without bypassing provider controls.

Independent cfbstats team game logs provide per-game component totals but conflict with the existing official CFBD controls. The [Texas sack log](https://cfbstats.com/2025/team/703/sack/gamelog.html) sums to 39 sacks through Texas’s first 12 games, while the cached CFBD first-12 team-box control is 36. The [Texas interception log](https://cfbstats.com/2025/team/703/interception/gamelog.html) shows 13 through the first 12, consistent with that CFBD component. The [Texas Misc. Defense log](https://cfbstats.com/2025/team/703/miscdefense/gamelog.html) lists first-12 blocked-kick component totals separately.

> **Decision:** These sources are retained as evidence probes only. They do not form a complete, agreeing, event-level authority for K/ST blocks, special-teams safeties, or all DEF components, so the related historical totals remain held.
