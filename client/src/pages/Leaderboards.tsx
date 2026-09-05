import { Crown } from "lucide-react";
import { Link } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import TeamLogo from "@/components/TeamLogo";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export default function Leaderboards() {
  const league = trpc.league.snapshot.useQuery();
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;
  const globalPickBySlotId = new Map(league.data.draftTurns.filter(turn => turn.draftSlotId).map(turn => [turn.draftSlotId as string, turn.globalPick]));
  return <LeagueShell eyebrow="School-position group leaders"><section className="container pt-10 sm:pt-14"><p className="section-kicker">Season pace</p><h1 className="display-title mt-3">Position leaders</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Each leaderboard tracks an individual school-position group selected in the 36 Football serpentine draft.</p><div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">{league.data.leaderboard.map(board => {
    const positionDraftOrder = [...board.entries].sort((a, b) => (globalPickBySlotId.get(a.id) ?? Infinity) - (globalPickBySlotId.get(b.id) ?? Infinity));
    const positionOrderRank = new Map(positionDraftOrder.map((entry, index) => [entry.id, index + 1]));
    return <section key={board.position} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border bg-accent/35 px-5 py-4"><h2 className="font-display text-xl font-extrabold tracking-tight">{board.label}</h2><Badge variant="outline">{board.entries.length} groups</Badge></div>{board.entries.length ? <div className="divide-y divide-border/70">{board.entries.slice(0, 10).map((entry, index) => <Link key={entry.id} href={`/leaders/${board.position}/${encodeURIComponent(entry.schoolName)}`} className="grid grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/30"><span className={index === 0 ? "text-primary" : "text-muted-foreground"}>{index === 0 ? <Crown className="h-4 w-4" /> : <span className="text-xs font-bold">{index + 1}</span>}</span><TeamLogo logoUrl={entry.logoUrl} teamName={entry.teamName} size="sm" /><div className="min-w-0"><p className="truncate font-bold">{entry.schoolName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.teamName} · {board.label}{positionOrderRank.get(entry.id)}{globalPickBySlotId.has(entry.id) ? ` · Pick ${globalPickBySlotId.get(entry.id)} overall` : ""}</p></div><div className="text-right"><p className="font-display text-lg font-extrabold tabular-nums">{entry.totalPoints.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">{entry.averagePoints.toFixed(2)} avg · {entry.gamesPlayed}g</p></div></Link>)}</div> : <div className="p-5"><EmptyLedger title="No drafted groups yet" detail="Leaders will be listed once draft picks are entered." /></div>}</section>;
  })}</div></section></LeagueShell>;
}
