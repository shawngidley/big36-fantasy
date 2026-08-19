# Public-Source DEF Reconciliation Pilot

## Eastern Michigan pilot

The no-cost reconciliation pass is using cached ESPN core events as the event ledger and public collegiate game publications as independent controls.

The initial ledger audit exposed a source-normalization defect: ESPN's `play.team` field may represent the offense on a sack. The builder now reads the explicit `teamParticipants` roles, crediting `SACK` events to the role-labelled defense instead.

Eastern Michigan is a near-match pilot candidate. The role-normalized ESPN ledger has 12 sacks, 7 interceptions, zero defensive touchdowns, and zero shutouts against first-12-game controls of 13, 7, zero, and zero respectively. Its unresolved gap is therefore a single sack.

Eastern Michigan's official 2025 cumulative-statistics publication and its associated official PDF provide a useful public control source, but their displayed overall totals must still be normalized to the league's first-12 regular-season game window before they can override or supplement the ledger. No DEF total has been published from this pilot.

The official Eastern Michigan PDF identifies a 12-game 2025 sample and lists seven defensive interceptions in its interception-return table, independently corroborating the seven-interception first-12-game control used by the ledger. The remaining unresolved pilot component is therefore the one-sack difference, not interceptions or defensive touchdowns.

The same official PDF's defensive-leaders table displays a team sack total that differs from the 13-sack CFBD first-12-game control and from the 12-sack role-normalized ESPN ledger. This three-way public-source disagreement confirms that the pilot cannot be certified by substituting an aggregate total; the specific event-level difference must be explained from the original game evidence before publication.

The extracted official table reports 14.0 sacks, 7 interceptions, and two recovered fumbles for Eastern Michigan's displayed 12-game sample. That remains inconsistent with the 13-sack CFBD first-12-game control and the current ESPN event reconstruction, which has 13 sacks after the verified Texas State supplement and one recovered fumble. The pilot therefore remains held: the public evidence validates several components but has not established a single authoritative component basis for the complete 36 Football DEF score.

The pilot now includes the official Eastern Michigan–Texas State game-book PDF for the first regular-season game: `https://dxbhsrqyrr690.cloudfront.net/sidearm.nextgen.sites/emueagles.com/stats/football/2025/pdf/20250830104119-41229.pdf`. It is an authoritative public source for checking whether the missing sack occurred in that game; its evidence will be recorded only after direct event-level comparison.

## Current decision rule

An additional DEF total may be published only after the public event ledger and the authoritative first-12-game control agree on sacks, turnovers, defensive touchdowns, and shutouts. A public game log or season total alone is not sufficient evidence for a tiered defensive touchdown total.

## Louisiana Tech follow-up

Louisiana Tech is the highest current provisional DEF touchdown-tier uncertainty, with nine defensive touchdowns receiving a neutral provisional tier in the 2025 estimate. Its official cumulative-statistics page is available at https://latechsports.com/sports/football/stats/2025 and links the program’s official cumulative-statistics PDF. The page reports a completed 13-game season, so its aggregate controls must be reduced to the league’s first 12 eligible regular-season games before they can amend a research estimate or support certification.

Direct PDF review confirms that the official cumulative report is labeled as a 13-game overall record and includes an individual interception-return table. It lists 22 Louisiana Tech defensive interceptions in the full report, while identifying each credited returner. This is valuable primary evidence for a per-game reconstruction, but it cannot directly replace the league’s first-12-game control without excluding the thirteenth contest.

## Remaining explicit-distance limit

After parsing all available ESPN return, fumble-return, interception-return, and recovery-return distance formats, six defensive-touchdown records still lack a stated return distance in the public text. They affect Air Force, Kansas State, Miami (OH), North Texas, Stanford, and Troy. Those events remain on the neutral provisional tier unless a corresponding official game book supplies the return distance. They are not eligible for certified publication from the current public event record.

## Official game-book follow-up

The official North Texas–Lamar box score identifies Ethan Wesloski’s score as a **0-yard fumble recovery** at 00:27. Source: <https://meangreensports.com/sports/football/stats/2025/lamar/boxscore/6743>. As with the verified Miami (OH) zero-yard recovery, this is a short defensive-touchdown tier for the provisional ledger and does not make the overall DEF total certified.

The official ACC Stanford–California box score identifies Darrius Davis’s score as a **17-yard fumble recovery** at 00:58 of the second quarter. Source: <https://theacc.com/boxscore.aspx?id=7ltyipP022aUJKmSgYVs3wXi7up73ghniwD5ElWyd07J7BNseBaMQePf0fY%2F3yUPMUbhWrVYP5TfIUpNsYa2ssf0yTPOhagwpaDLF49CwjACWH6biNTTkY3jWoHnqdhLMP7kuKdKDTTuDsu53B7yJ45m7o%2Be4BPQP4gJTRQj2uI%3D&path=football>. This is a verified short defensive-touchdown tier for the provisional ledger; it does not certify the overall Stanford DEF total.

The final open public event was initially mapped to the wrong Troy game because the ESPN play text abbreviated the recovering team inconsistently. The official American Conference Troy–Memphis box score identifies **Taleeq Robbins’s 15-yard fumble recovery** for Troy. Source: <https://theamerican.org/boxscore.aspx?id=7ltyipP022aUJKmSgYVs3wXi7up73ghniwD5ElWyd07J7BNseBaMQePf0fY%2F3yUPYisLZcn5VgSLeeDJL1GqKQmkZ%2BtXTiHWNgO7jpx6OVuvaRBeww%2Bq41twCDfkcyIrAonKqfNidaDkZM4FmJ5fjlzNId1cTU0X8h49OvyWB8I%3D&path=football>. This is a verified short defensive-touchdown tier for the provisional ledger and resolves the final explicit-distance gap; it does not certify Troy’s overall DEF total.

Louisiana Tech’s official 2025 cumulative-statistics publication provides a useful full-season defensive-leader table and overall team schedule, but it is a **13-game** aggregate and does not provide an event-level or first-12-game component split sufficient to replace the provisional controls. Sources: <https://latechsports.com/sports/football/stats/2025> and its official PDF at <https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/latechsports.com/stats/football/2025/pdf/cume.pdf>. It therefore corroborates that a public primary source exists but does not justify changing Louisiana Tech’s provisional DEF total without a game-by-game reconstruction.
