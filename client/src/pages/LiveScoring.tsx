import { useState } from "react";
import { Activity, ArrowDown, ArrowUp, Radio } from "lucide-react";
import { Link } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import MessageBoard from "@/components/MessageBoard";
import RealScoresStrip from "@/components/RealScoresStrip";
import TeamLogo from "@/components/TeamLogo";
import { LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const label = (position: string) => position;
const positions = ["QB", "RB", "WR", "TE", "K", "DST"] as const;

// Competition-style ranking: entries tied on points share the same rank number (shown as "T"),
// and the next distinct value skips ahead by the number tied — never determined by school name.
function tieAwareRank(entries: Array<{ id: string; totalPoints: number }>, targetId: string) {
  const sorted = [...entries].sort((a, b) => b.totalPoints - a.totalPoints);
  const target = sorted.find(entry => entry.id === targetId);
  if (!target) return null;
  const rank = sorted.findIndex(entry => entry.totalPoints === target.totalPoints) + 1;
  const tied = sorted.filter(entry => entry.totalPoints === target.totalPoints).length > 1;
  return { rank, tied };
}

const formatKickoff = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function LiveScoring() {
  const { isAuthenticated } = useAuth();
  const [view, setView] = useState<"mine" | "league">("mine");
  const league = trpc.league.snapshot.useQuery(undefined, { refetchInterval: 20000 });
  const profile = trpc.league.myProfile.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 20000 });
  const scores = trpc.league.liveScores.useQuery({ scope: "league" }, { refetchInterval: 20000 });

  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;

  const currentWeek = [...league.data.weeks].reverse().find(week => week.status !== "UPCOMING") ?? league.data.weeks[0];
  const myOwnerId = profile.data?.registration.ownerId;
  const myTeam = myOwnerId ? league.data.owners.find(owner => owner.id === myOwnerId) : undefined;
  const showMine = view === "mine" && isAuthenticated && myTeam;
  const weekSummary = currentWeek ? league.data.weeklySummaries.find(w => w.id === currentWeek.id) : undefined;
  const myRank = myTeam ? league.data.overallStandings.findIndex(owner => owner.id === myTeam.id) + 1 : null;
  const myDivision = myTeam ? league.data.divisions.find(division => division.owners.some(owner => owner.id === myTeam.id)) : undefined;
  const recentEvents = [...league.data.events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const supersededEventIds = new Set(recentEvents.filter(event => event.auditAction === "REVERSAL" && event.correctionOfEventId).map(event => event.correctionOfEventId));
  const myEvents = myTeam ? recentEvents.filter(event => event.teamName === myTeam.teamName && event.auditAction !== "REVERSAL" && !supersededEventIds.has(event.id) && !event.note?.includes("Manual correction: restores points wrongly auto-reversed")) : [];

  return <LeagueShell eyebrow="Watching your program"><section className="container pt-8 sm:pt-12">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="section-kicker flex items-center gap-2"><Radio className="h-3.5 w-3.5 animate-pulse text-primary" /> Live scoring</p><h1 className="display-title mt-3">{currentWeek ? `Week ${currentWeek.weekNumber}` : "Season overview"}</h1><p className="mt-2 text-sm text-muted-foreground">Updates automatically as scoring events are recorded. No lineups, no waivers — just watch your program move.</p></div>
    {isAuthenticated && myTeam ? <div className="flex rounded-xl border border-border bg-card p-1 shadow-sm"><button onClick={() => setView("mine")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${view === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>My program</button><button onClick={() => setView("league")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${view === "league" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>League-wide</button></div> : null}</div>

    {showMine && myTeam ? <>
      <div className="mt-8 flex flex-col gap-5 rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><TeamLogo logoUrl={myTeam.logoUrl} teamName={myTeam.teamName} size="lg" /><div><Link href={`/team/${myTeam.id}`} className="font-display text-2xl font-extrabold hover:text-primary">{myTeam.teamName}</Link><p className="mt-1 text-sm text-muted-foreground">Overall rank #{myRank} of {league.data.owners.length}</p></div></div><div className="flex gap-6"><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Season total</p><p className="mt-1 font-display text-3xl font-extrabold tabular-nums text-primary">{myTeam.totalPoints.toFixed(2)}</p></div>{weekSummary ? <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">This week</p><p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{(weekSummary.teams.find(t => t.ownerId === myTeam.id)?.points ?? 0).toFixed(2)}</p></div> : null}</div></div>

      <div className="mt-6 flex flex-col gap-4">{positions.map(position => {
        const pick = myTeam.picks.find(item => item.position === position);
        const positionEntries = league.data!.leaderboard.find(board => board.position === position)?.entries ?? [];
        const rank = pick ? tieAwareRank(positionEntries, pick.id) : null;
        const thisWeekPoints = pick && currentWeek ? pick.weeklyPoints.find(w => w.weekId === currentWeek.id)?.points ?? 0 : 0;
        const game = pick ? scores.data?.games.find(g => g.homeTeam.toLowerCase() === pick.schoolName.toLowerCase() || g.awayTeam.toLowerCase() === pick.schoolName.toLowerCase()) : undefined;
        const card = <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em]">{label(position)}</span><div><p className="font-display text-lg font-extrabold leading-tight">{pick?.schoolName ?? "Not drafted"}</p>{game ? <p className="text-[11px] text-muted-foreground">{game.status === "in_progress" ? <span className="font-bold text-primary">{game.period ? `Q${game.period}` : "Live"} · {game.clock ?? ""}</span> : game.status === "completed" ? "Final" : formatKickoff(game.startDate)}</p> : null}</div></div>{rank ? <span className="shrink-0 text-xs font-bold text-muted-foreground">{rank.tied ? "T" : ""}{rank.rank} of {positionEntries.length}</span> : null}</div>;
        const stats = pick ? <div className="mt-3 flex items-end justify-between border-t border-border/70 pt-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Season</p><p className="font-display text-2xl font-extrabold tabular-nums">{pick.seasonPoints.toFixed(2)}</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">This week</p><p className="font-display text-lg font-extrabold tabular-nums text-primary">{thisWeekPoints > 0 ? "+" : ""}{thisWeekPoints.toFixed(2)}</p></div></div> : null;
        return pick ? <Link key={position} href={`/leaders/${position}/${encodeURIComponent(pick.schoolName)}`} className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/20">{card}{stats}</Link> : <div key={position} className="rounded-2xl border border-border bg-card p-5 shadow-sm">{card}{stats}</div>;
      })}</div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">Your event feed</p><h2 className="mt-1 font-display text-xl font-extrabold">Recent scoring for {myTeam.teamName}</h2></div>{myEvents.length ? <div className="max-h-[500px] divide-y divide-border/70 overflow-y-auto">{myEvents.slice(0, 40).map(event => <div key={event.id} className="flex items-center justify-between gap-4 px-5 py-3.5"><div className="min-w-0"><div className="flex items-center gap-2"><Badge variant="secondary" className="text-[10px]">{event.positionLabel}</Badge><span className="truncate text-sm font-semibold">{event.schoolName}</span></div><p className="mt-1 text-xs text-muted-foreground">{event.eventType.replaceAll("_", " ")} · {new Date(event.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><div className="shrink-0 text-right"><p className={`font-display text-lg font-extrabold tabular-nums ${event.computedPoints >= 0 ? "text-primary" : "text-destructive"}`}>{event.computedPoints > 0 ? "+" : ""}{event.computedPoints.toFixed(2)}</p></div></div>)}</div> : <div className="p-8 text-sm text-muted-foreground">No scoring events yet for your program this season.</div>}</section>

      <div className="mt-8"><RealScoresStrip compact ownerId={myTeam.id} /></div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">League-wide</p><h2 className="mt-1 font-display text-xl font-extrabold">Top 10 overall</h2></div><div className="divide-y divide-border/70">{league.data.overallStandings.slice(0, 10).map((owner, index) => <Link key={owner.id} href={`/team/${owner.id}`} className={`grid grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/30 ${owner.id === myTeam.id ? "bg-primary/5" : ""}`}><span className="text-xs font-extrabold text-muted-foreground">{index + 1}</span><TeamLogo logoUrl={owner.logoUrl} teamName={owner.teamName} size="sm" /><span className="truncate font-bold">{owner.teamName}</span><span className="font-display text-base font-extrabold tabular-nums">{owner.totalPoints.toFixed(2)}</span></Link>)}</div></section>

        {myDivision ? <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">Your group</p><h2 className="mt-1 font-display text-xl font-extrabold">{myDivision.name}</h2></div><div className="divide-y divide-border/70">{myDivision.owners.map((owner, index) => <Link key={owner.id} href={`/team/${owner.id}`} className={`grid grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/30 ${owner.id === myTeam.id ? "bg-primary/5" : ""}`}><span className="text-xs font-extrabold text-muted-foreground">{index + 1}</span><TeamLogo logoUrl={owner.logoUrl} teamName={owner.teamName} size="sm" /><span className="truncate font-bold">{owner.teamName}</span><span className="font-display text-base font-extrabold tabular-nums">{owner.totalPoints.toFixed(2)}</span></Link>)}</div></section> : null}
      </div>

      {myDivision ? <div className="mt-8"><MessageBoard divisionId={myDivision.id} divisionName={myDivision.name} canPost isCommissioner={myTeam.isCommissioner} /></div> : null}
    </> : <>
      <div className="mt-8"><RealScoresStrip compact /></div>

      {weekSummary ? <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border bg-accent/40 px-5 py-4"><div><p className="font-display text-xl font-extrabold">Week {weekSummary.weekNumber} scoreboard</p><p className="mt-0.5 text-xs text-muted-foreground">{weekSummary.label}</p></div><Badge variant={weekSummary.status === "FINAL" ? "default" : "secondary"}>{weekSummary.status.toLowerCase()}</Badge></div><div className="divide-y divide-border/70">{weekSummary.teams.slice(0, 15).map((team, index) => { const owner = league.data!.owners.find(o => o.id === team.ownerId); return <Link key={team.ownerId} href={`/team/${team.ownerId}`} className="scoreboard-row grid grid-cols-[32px_auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 transition-colors hover:text-primary"><span className="text-xs font-extrabold text-muted-foreground">{index + 1}</span><TeamLogo logoUrl={owner?.logoUrl} teamName={team.teamName} size="sm" /><span className="truncate font-bold">{team.teamName}</span><span className="font-display text-lg font-extrabold tabular-nums">{team.points.toFixed(2)}</span></Link>; })}</div></div> : null}

      <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker flex items-center gap-2"><Activity className="h-3.5 w-3.5" /> League-wide feed</p><h2 className="mt-1 font-display text-xl font-extrabold">Every scoring event, as it happens</h2></div>{recentEvents.length ? <div className="max-h-[600px] divide-y divide-border/70 overflow-y-auto">{recentEvents.slice(0, 60).map(event => <div key={event.id} className="flex items-center justify-between gap-4 px-5 py-3.5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="text-[10px]">{event.positionLabel}</Badge><span className="truncate text-sm font-semibold">{event.schoolName}</span><span className="text-xs text-muted-foreground">· {event.teamName}</span></div><p className="mt-1 text-xs text-muted-foreground">{event.eventType.replaceAll("_", " ")} · {new Date(event.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><div className="shrink-0 text-right"><p className={`font-display text-lg font-extrabold tabular-nums ${event.computedPoints >= 0 ? "text-primary" : "text-destructive"}`}>{event.computedPoints > 0 ? "+" : ""}{event.computedPoints.toFixed(2)}</p><p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">{event.overallRankAfter < event.overallRankBefore ? <ArrowUp className="h-3 w-3 text-primary" /> : event.overallRankAfter > event.overallRankBefore ? <ArrowDown className="h-3 w-3 text-destructive" /> : null}#{event.overallRankBefore} → #{event.overallRankAfter}</p></div></div>)}</div> : <div className="p-8 text-sm text-muted-foreground">The live feed will appear as scoring events are recorded.</div>}</section>
    </>}
  </section></LeagueShell>;
}
