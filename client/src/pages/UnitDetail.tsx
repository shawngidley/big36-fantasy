import { ArrowLeft } from "lucide-react";
import { Link, useRoute } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import TeamLogo from "@/components/TeamLogo";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { useGoBack } from "@/hooks/useGoBack";
import { trpc } from "@/lib/trpc";

export default function UnitDetail() {
  const [, params] = useRoute("/leaders/:position/:school");
  const position = params?.position ?? "";
  const school = params ? decodeURIComponent(params.school) : "";
  const goBack = useGoBack("/leaders");
  const league = trpc.league.snapshot.useQuery();
  if (league.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (league.error || !league.data) return <LeagueShell><LeagueError message={league.error?.message} /></LeagueShell>;

  const owner = league.data.owners.find(item => item.picks.some(pick => pick.position === position && pick.schoolName === school));
  const pick = owner?.picks.find(item => item.position === position && item.schoolName === school);

  if (!pick || !owner) return <LeagueShell eyebrow="Position leaders"><section className="container pt-10 sm:pt-14">
    <Link href="/leaders" onClick={goBack} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to leaders</Link>
    <div className="mt-6"><EmptyLedger title="Unit not found" detail="This school-position group hasn't been drafted, or the link is out of date." /></div>
  </section></LeagueShell>;

  const weeks = league.data.weeks.map(week => ({ ...week, points: pick.weeklyPoints.find(item => item.weekId === week.id)?.points ?? 0 }));

  return <LeagueShell eyebrow="Position leaders"><section className="container pt-10 sm:pt-14">
    <Link href="/leaders" onClick={goBack} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to leaders</Link>
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <TeamLogo logoUrl={owner.logoUrl} teamName={school} size="lg" />
      <div><p className="section-kicker">{pick.positionLabel}</p><h1 className="display-title mt-1">{school}</h1><p className="mt-1 text-sm text-muted-foreground">{owner.teamName} · Pick {pick.draftPosition ?? "—"}</p></div>
    </div>
    <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-md">
      <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Total</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{pick.seasonPoints.toFixed(2)}</p></div>
      <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Avg</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{pick.averagePoints.toFixed(2)}</p></div>
      <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Games</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{pick.gamesPlayed}</p></div>
    </div>
    <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">Week by week</p><h2 className="mt-1 font-display text-xl font-extrabold tracking-tight">Weekly points</h2></div>
      {weeks.length ? <div className="divide-y divide-border/70">{weeks.map(week => <Link key={week.id} href={`/leaders/${position}/${encodeURIComponent(school)}/${week.weekNumber}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-accent/30">
        <div><p className="font-bold">{week.label}</p><Badge variant="outline" className="mt-1 text-[10px]">{week.status}</Badge></div>
        <p className="font-display text-lg font-extrabold tabular-nums">{week.points.toFixed(2)}</p>
      </Link>)}</div> : <div className="p-5"><EmptyLedger title="No weeks yet" detail="Weekly scoring periods will appear here once the season starts." /></div>}
    </div>
  </section></LeagueShell>;
}
