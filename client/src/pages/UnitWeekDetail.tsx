import { ArrowLeft } from "lucide-react";
import { Link, useRoute } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { useGoBack } from "@/hooks/useGoBack";
import { trpc } from "@/lib/trpc";

const formatDate = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function UnitWeekDetail() {
  const [, params] = useRoute("/leaders/:position/:school/:week");
  const position = params?.position ?? "";
  const school = params ? decodeURIComponent(params.school) : "";
  const weekNumber = Number(params?.week);
  const goBack = useGoBack(`/leaders/${position}/${encodeURIComponent(school)}`);
  const league = trpc.league.snapshot.useQuery();
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;

  const week = league.data.weeks.find(item => item.weekNumber === weekNumber);
  // Same convention as the league event feed elsewhere: a reversal row and the original entry it
  // cancels are both hidden, leaving only what's currently net-active for this unit this week.
  const allEvents = league.data.events;
  const supersededEventIds = new Set(allEvents.filter(event => event.auditAction === "REVERSAL" && event.correctionOfEventId).map(event => event.correctionOfEventId));
  const events = allEvents
    .filter(event => event.schoolName === school && event.position === position && event.weekNumber === weekNumber && event.auditAction !== "REVERSAL" && !supersededEventIds.has(event.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const totalPoints = Number(events.reduce((sum, event) => sum + event.computedPoints, 0).toFixed(2));

  return <LeagueShell eyebrow="Position leaders"><section className="container pt-10 sm:pt-14">
    <Link href={`/leaders/${position}/${encodeURIComponent(school)}`} onClick={goBack} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to {school}</Link>
    <div className="mt-6"><p className="section-kicker">{week?.label ?? `Week ${weekNumber}`}</p><h1 className="display-title mt-1">{school} · {position}</h1><p className="mt-2 font-display text-2xl font-extrabold tabular-nums">{totalPoints.toFixed(2)} pts</p></div>
    <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">Play by play</p><h2 className="mt-1 font-display text-xl font-extrabold tracking-tight">Scoring plays</h2></div>
      {events.length ? <div className="divide-y divide-border/70">{events.map(event => <div key={event.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0"><p className="font-bold">{event.eventType.replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{event.note ?? formatDate(event.createdAt)}</p></div>
        <p className={`shrink-0 font-display text-lg font-extrabold tabular-nums ${event.computedPoints < 0 ? "text-destructive" : ""}`}>{event.computedPoints > 0 ? "+" : ""}{event.computedPoints.toFixed(2)}</p>
      </div>)}</div> : <div className="p-5"><EmptyLedger title="No scoring plays" detail="This unit didn't score in this week." /></div>}
    </div>
  </section></LeagueShell>;
}
