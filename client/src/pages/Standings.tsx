import { Link } from "wouter";
import { Medal, Trophy } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const placement = (rank: number) => rank === 1 ? "bg-primary text-primary-foreground" : rank === 2 ? "bg-amber-100 text-amber-950" : rank === 3 ? "bg-orange-100 text-orange-950" : "bg-accent text-muted-foreground";

// Championship and prize reporting remains available to league administration, not the public standings page.
export default function Standings() {
  const league = trpc.league.snapshot.useQuery();
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;

  const { overallStandings, divisions } = league.data;
  const topTen = overallStandings.slice(0, 10);

  return <LeagueShell eyebrow="Season standings"><section className="container pt-10 sm:pt-14">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="section-kicker">The 36 Football race</p>
        <h1 className="display-title mt-3">Conference standings</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Six conference races lead the way. The national top 10 follows below as the season takes shape.</p>
      </div>
      <div className="stat-pill"><Medal className="h-4 w-4" /> {league.data.totals.divisionCount}/6 conferences active</div>
    </div>

    <div className="mt-9">
      <div className="flex items-center gap-3"><Medal className="h-5 w-5 text-primary" /><h2 className="font-display text-2xl font-extrabold tracking-tight">Conference races</h2></div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">{divisions.map(division => <section key={division.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg font-extrabold tracking-tight">{division.name}</h3><Badge variant="outline">{division.owners.length}/6</Badge></div>
        <div className="mt-4 divide-y divide-border/70">{division.owners.length ? division.owners.map(owner => <Link key={owner.id} href={`/team/${owner.id}`} className="grid grid-cols-[26px_minmax(0,1fr)_auto] gap-2 py-3 text-sm hover:text-primary"><span className="font-bold text-muted-foreground">{owner.divisionRank}</span><span className="truncate font-semibold">{owner.teamName}</span><span className="font-bold tabular-nums">{owner.totalPoints.toFixed(2)}</span></Link>) : <p className="py-5 text-sm text-muted-foreground">Awaiting program assignments.</p>}</div>
      </section>)}</div>
    </div>

    <div className="mt-14">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="section-kicker">National race</p><div className="mt-2 flex items-center gap-3"><Trophy className="h-5 w-5 text-primary" /><h2 className="font-display text-2xl font-extrabold tracking-tight">Overall top 10</h2></div><p className="mt-2 text-sm leading-6 text-muted-foreground">The leading 10 programs in the national standings.</p></div>
        <div className="stat-pill"><Trophy className="h-4 w-4" /> {league.data.totals.ownerCount}/36 programs active</div>
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{topTen.length ? <div className="divide-y divide-border/70">{topTen.map(row => <Link key={row.id} href={`/team/${row.id}`} className="group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-colors hover:bg-accent/40 sm:grid-cols-[56px_minmax(0,1fr)_140px_100px] sm:px-6"><span className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-extrabold ${placement(row.overallRank)}`}>{row.overallRank}</span><div className="min-w-0"><p className="truncate font-bold group-hover:text-primary">{row.teamName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.displayName} · {divisions.find(d => d.id === row.divisionId)?.name ?? "No division"}</p></div><Badge variant="secondary" className="hidden justify-self-start sm:inline-flex">{row.picks.length}/6 selections</Badge><p className="font-display text-lg font-extrabold tabular-nums">{row.totalPoints.toFixed(2)}</p></Link>)}</div> : <div className="p-6"><EmptyLedger title="Standings will appear here" detail="Add teams and record scoring events in the commissioner workspace to establish the table." /></div>}</div>
    </div>

  </section></LeagueShell>;
}
