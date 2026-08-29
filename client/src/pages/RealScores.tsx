import { Radio } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import RealScoresStrip from "@/components/RealScoresStrip";
import { LeagueError, LeagueLoading } from "@/components/LeagueState";
import { trpc } from "@/lib/trpc";

export default function RealScores() {
  const scores = trpc.league.liveScores.useQuery(undefined, { refetchInterval: 20000 });
  if (scores.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (scores.error) return <LeagueShell><LeagueError message={scores.error.message} /></LeagueShell>;

  return <LeagueShell eyebrow="Real college football"><section className="container pt-8 sm:pt-12">
    <p className="section-kicker flex items-center gap-2"><Radio className="h-3.5 w-3.5 animate-pulse text-primary" /> Real scores</p>
    <h1 className="display-title mt-3">Every game that matters to 36 Football</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Actual college football scores for every school drafted this season, updating automatically. Shows which 36 Football programs each result affects.</p>
    <div className="mt-8">{scores.data?.length ? <RealScoresStrip /> : <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No games involving drafted schools are scheduled or in progress right now.</div>}</div>
  </section></LeagueShell>;
}
