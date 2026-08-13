import { CalendarDays } from "lucide-react";
import { useState } from "react";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export default function Weekly() {
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const league = trpc.league.snapshot.useQuery();
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;
  const summary = league.data.weeklySummaries.find(item => item.id === (selectedWeekId ?? league.data.weeks[0]?.id));
  return <LeagueShell eyebrow="Week-by-week results"><section className="container pt-10 sm:pt-14"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="section-kicker">Scoreboard</p><h1 className="display-title mt-3">Weekly scoring</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A complete snapshot of every team’s weekly total from the commissioner’s event ledger.</p></div>{league.data.weeks.length ? <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold shadow-sm"><CalendarDays className="h-4 w-4 text-primary" /><span className="sr-only">Choose week</span><select className="bg-transparent outline-none" value={selectedWeekId ?? league.data.weeks[0]?.id} onChange={event => setSelectedWeekId(Number(event.target.value))}>{league.data.weeks.map(week => <option key={week.id} value={week.id}>Week {week.weekNumber} · {week.label}</option>)}</select></label> : null}</div>
    {summary ? <div className="mt-9 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border bg-accent/40 px-5 py-4"><div><p className="font-display text-xl font-extrabold tracking-tight">Week {summary.weekNumber}</p><p className="mt-0.5 text-xs text-muted-foreground">{summary.label}</p></div><Badge variant={summary.status === "FINAL" ? "default" : "secondary"}>{summary.status.toLowerCase()}</Badge></div><div className="divide-y divide-border/70">{summary.teams.map((team, index) => <div key={team.ownerId} className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4"><span className="text-xs font-extrabold text-muted-foreground">{index + 1}</span><span className="truncate font-bold">{team.teamName}</span><span className="font-display text-lg font-extrabold tabular-nums">{team.points.toFixed(2)}</span></div>)}</div></div> : <div className="mt-10"><EmptyLedger title="No scoring week is open" detail="The commissioner can create each week before entering the event-level scoring ledger." /></div>}</section></LeagueShell>;
}
