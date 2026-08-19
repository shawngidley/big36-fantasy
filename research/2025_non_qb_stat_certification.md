# 2025 Non-QB Unit Stat Certification

## Scope and published outcome

This certification covers every **RB, WR, TE, K/ST, and DEF** research card in the 2025 archive: **680 school-position units** across 136 FBS schools. Each unit uses its first 12 completed regular-season games. The public research cards now display certified visible statistics from official CollegeFootballData per-game player and team box scores. The writeback verifier compared all 680 stored rows against those controls and returned **0 mismatches**.

| Position | Certified visible controls | Units |
|---|---|---:|
| RB | Position-group touchdowns; fumbles lost | 136 |
| WR | Position-group touchdowns; fumbles lost | 136 |
| TE | Position-group touchdowns; fumbles lost | 136 |
| K/ST | Field goals made; extra points; kickoff-return TDs; punt-return TDs | 136 |
| DEF | Sacks; interceptions; defensive TDs; shutouts | 136 |

## Source hierarchy

The certification uses the official CFBD `games/players` data for each school and game in the selected window. Player-box categories provide offensive touchdowns, fumbles lost, kicking makes, and individual defensive production. Team-level aggregation provides the K/ST and DEF unit values. The regular-season game list determines each school’s first-12-game cutoff. [1]

## Historical scoring-point boundary

The visible statistics are certified, but the historical 2025 point totals are **not being silently re-tiered**. Tiered touchdown scoring requires the snap yardline-to-goal for every touchdown, and K/ST or DEF points additionally require complete event ownership for returns, blocks, safeties, and recoveries. Where those event-level source records remain incomplete or ambiguous, the public card explicitly states that its historical tiered points are held pending full validation.

> This is an accuracy-first release. Certified statistics are published; unsupported historical point-tier assumptions are not.

## Verification result

The guarded publisher updated all 680 non-QB stat summaries with a `non_qb_stat_line_certified` marker and a tier-points hold marker. The independent readback verifier confirmed the same controls in Supabase for every RB, WR, TE, K/ST, and DEF row.

## Reference

[1]: https://api.collegefootballdata.com/getting-started "CollegeFootballData API documentation"
