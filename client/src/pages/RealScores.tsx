import { useState } from "react";
import { Radio } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import RealScoresStrip from "@/components/RealScoresStrip";
import { LeagueError, LeagueLoading } from "@/components/LeagueState";
import { trpc } from "@/lib/trpc";

export default function RealScores() {
  const [scope, setScope] = useState<"league" | "all">("league");
  const scores = trpc.league.liveScores.useQuery({ scope }, { refetchInterval: 20000 });
  if (scores.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (scores.error) return <LeagueShell><LeagueError message={scores.error.message} /></LeagueShell>;

  return <LeagueShell eyebrow="Real college football"><section className="container pt-8 sm:pt-12">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="section-kicker flex items-center gap-2"><Radio className="h-3.5 w-3.5 animate-pulse text-primary" /> Real scores</p><h1 className="display-title mt-3">{scope === "all" ? "Every FBS game today" : "Every game that matters to 36 Football"}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{scope === "all" ? "The full FBS scoreboard, updating automatically." : "Actual college football scores for every school drafted this season. Shows which 36 Football programs each result affects."}</p></div>
    <div className="flex rounded-xl border border-border bg-card p-1 shadow-sm"><button onClick={() => setScope("league")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${scope === "league" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>My league</button><button onClick={() => setScope("all")} className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${scope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>All games</button></div></div>
    <div className="mt-8"><RealScoresStrip scope={scope} /></div>
  </section></LeagueShell>;
}
