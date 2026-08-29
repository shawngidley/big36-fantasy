import { useState } from "react";
import { Link } from "wouter";
import { Crown, Medal, Trophy } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import TeamLogo from "@/components/TeamLogo";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { trpc } from "@/lib/trpc";

const placement = (rank: number) => rank === 1 ? "bg-primary text-primary-foreground" : rank === 2 ? "bg-amber-100 text-amber-950" : rank === 3 ? "bg-orange-100 text-orange-950" : "bg-accent text-muted-foreground";

// Championship and prize reporting remains available to league administration, not the public standings page.
export default function Standings() {
  const league = trpc.league.snapshot.useQuery();
  const [metric, setMetric] = useState<"total" | "average">("total");
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;

  const { overallStandings, divisions, leaderboard } = league.data;
  const metricValue = (owner: { totalPoints: number; averagePoints: number }) => metric === "total" ? owner.totalPoints : owner.averagePoints;
  const rankedDivisions = divisions.map(division => ({ ...division, owners: metric === "total" ? division.owners : [...division.owners].sort((a, b) => b.averagePoints - a.averagePoints || a.teamName.localeCompare(b.teamName)).map((owner, index) => ({ ...owner, divisionRank: index + 1 })) }));
  const rankedOverall = metric === "total" ? overallStandings : [...overallStandings].sort((a, b) => b.averagePoints - a.averagePoints || a.teamName.localeCompare(b.teamName)).map((owner, index) => ({ ...owner, overallRank: index + 1 }));
  const topTen = rankedOverall.slice(0, 10);

  const MetricToggle = () => <div className="flex rounded-xl border border-border bg-card p-1 shadow-sm"><button onClick={() => setMetric("total")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${metric === "total" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Total points</button><button onClick={() => setMetric("average")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${metric === "average" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Average points</button></div>;

  return <LeagueShell eyebrow="Season standings"><section className="container pt-10 sm:pt-14">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="section-kicker">National race</p>
        <h1 className="display-title mt-3">Overall standings</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{metric === "average" ? "Ranked by average points per game — a fairer look while schedules are uneven." : "Ranked by total points accumulated so far this season."}</p>
      </div>
      <div className="flex flex-col items-end gap-3"><div className="stat-pill"><Trophy className="h-4 w-4" /> {league.data.totals.ownerCount}/36 programs active</div><MetricToggle /></div>
    </div>

    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="scoreboard-card overflow-hidden">{topTen.length ? <div className="divide-y divide-border/70">{topTen.map(row => <Link key={row.id} href={`/team/${row.id}`} className="scoreboard-row group grid grid-cols-[40px_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-colors sm:px-5"><span className={`grid h-8 w-8 place-items-center rounded-md text-xs font-extrabold ${placement(row.overallRank)}`}>{row.overallRank}</span><TeamLogo logoUrl={row.logoUrl} teamName={row.teamName} size="md" /><div className="min-w-0"><p className="truncate font-bold group-hover:text-primary">{row.teamName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.displayName} · {divisions.find(d => d.id === row.divisionId)?.name ?? "No division"}</p></div><div className="text-right"><p className="font-display text-lg font-extrabold tabular-nums">{metricValue(row).toFixed(2)}</p><p className="text-[10px] text-muted-foreground">{metric === "total" ? `${row.averagePoints.toFixed(2)} avg` : `${row.totalPoints.toFixed(2)} total`}</p></div></Link>)}</div> : <div className="p-6"><EmptyLedger title="Standings will appear here" detail="Add teams and record scoring events in the commissioner workspace to establish the table." /></div>}</div>

      <div className="scoreboard-card overflow-hidden"><div className="flex items-center gap-2 border-b border-border bg-accent/40 px-5 py-4"><Crown className="h-4 w-4 text-primary" /><p className="section-kicker">Position leaders</p></div><div className="divide-y divide-border/70">{leaderboard.map(board => { const leader = board.entries[0]; return <Link key={board.position} href="/leaders" className="scoreboard-row flex items-center gap-3 px-5 py-3.5 transition-colors hover:text-primary"><span className="w-11 shrink-0 rounded-full border border-border bg-background px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[.1em]">{board.label}</span>{leader ? <><TeamLogo logoUrl={leader.logoUrl} teamName={leader.teamName} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{leader.schoolName}</p><p className="truncate text-xs text-muted-foreground">{leader.teamName}</p></div><p className="shrink-0 font-display text-sm font-extrabold tabular-nums">{leader.totalPoints.toFixed(1)}</p></> : <p className="flex-1 text-xs text-muted-foreground">Not yet drafted</p>}</Link>; })}</div></div>
    </div>

    <div className="mt-14">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="section-kicker">The 36 Football race</p><div className="mt-2 flex items-center gap-3"><Medal className="h-5 w-5 text-primary" /><h2 className="font-display text-2xl font-extrabold tracking-tight">Conference races</h2></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Six conference races within the larger national chase.</p></div>
        <div className="stat-pill"><Medal className="h-4 w-4" /> {league.data.totals.divisionCount}/6 conferences active</div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">{rankedDivisions.map(division => <section key={division.id} className="scoreboard-card p-5">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg font-extrabold tracking-tight">{division.name}</h3><span className="text-xs font-bold text-muted-foreground">{division.owners.length}/6</span></div>
        <div className="mt-4 divide-y divide-border/70">{division.owners.length ? division.owners.map(owner => <Link key={owner.id} href={`/team/${owner.id}`} className="scoreboard-row grid grid-cols-[26px_auto_minmax(0,1fr)_auto] items-center gap-2 py-3 text-sm transition-colors hover:text-primary"><span className="font-condensed text-base font-bold text-muted-foreground">{owner.divisionRank}</span><TeamLogo logoUrl={owner.logoUrl} teamName={owner.teamName} size="sm" /><span className="truncate font-semibold">{owner.teamName}</span><span className="font-bold tabular-nums">{metricValue(owner).toFixed(2)}</span></Link>) : <p className="py-5 text-sm text-muted-foreground">Awaiting program assignments.</p>}</div>
      </section>)}</div>
    </div>

  </section></LeagueShell>;
}
