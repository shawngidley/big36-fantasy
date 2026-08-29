import { useState } from "react";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

const statusLabel = (status: string, period: number | null, clock: string | null) => {
  if (status === "in_progress") return period && clock ? `Q${period} · ${clock}` : "Live";
  if (status === "completed") return "Final";
  return "Scheduled";
};

const formatKickoff = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function RealScoresStrip({ compact = false, scope = "league", ownerId }: { compact?: boolean; scope?: "league" | "all"; ownerId?: string }) {
  const [week, setWeek] = useState<number | undefined>(undefined);
  const scores = trpc.league.liveScores.useQuery({ scope, week, ownerId }, { refetchInterval: 20000 });
  const activeWeek = week ?? scores.data?.currentWeek;
  const games = compact ? (scores.data?.games ?? []).slice(0, 6) : (scores.data?.games ?? []);

  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accent/40 px-5 py-4">
      <p className="section-kicker flex items-center gap-2"><Radio className="h-3.5 w-3.5 animate-pulse text-primary" /> {ownerId ? "Your games" : "Real scores"}</p>
      {compact ? <Link href="/scores" className="text-xs font-bold text-primary hover:underline">See all →</Link> : scores.data?.availableWeeks.length ? <div className="flex items-center gap-2"><button disabled={activeWeek === scores.data.availableWeeks[0]} onClick={() => setWeek(Math.max(scores.data!.availableWeeks[0], (activeWeek ?? scores.data!.currentWeek) - 1))} className="rounded-lg border border-border p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span className="font-display text-sm font-extrabold">Week {activeWeek}{activeWeek === scores.data.currentWeek ? " · Current" : ""}</span><button disabled={activeWeek === scores.data.availableWeeks[scores.data.availableWeeks.length - 1]} onClick={() => setWeek(Math.min(scores.data!.availableWeeks[scores.data!.availableWeeks.length - 1], (activeWeek ?? scores.data!.currentWeek) + 1))} className="rounded-lg border border-border p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div> : null}
    </div>
    {!compact && scores.data?.availableWeeks.length ? <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-background/50 px-5 py-3">{scores.data.availableWeeks.map(item => <button key={item} onClick={() => setWeek(item)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${item === activeWeek ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-primary/10"}`}>Wk {item}</button>)}</div> : null}
    {games.length ? <div className={compact ? "grid gap-px bg-border sm:grid-cols-2" : "grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3"}>
      {games.map(game => <Link key={game.id} href={`/scores/${game.week}/${game.id}`} className="block bg-card p-4 transition-colors hover:bg-accent/30">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground"><span className={game.status === "in_progress" ? "text-primary" : ""}>{statusLabel(game.status, game.period, game.clock)}</span><span>{formatKickoff(game.startDate)}</span></div>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between"><span className="truncate text-sm font-bold">{game.awayTeam}</span><span className="font-display text-lg font-extrabold tabular-nums">{game.awayPoints}</span></div>
          <div className="flex items-center justify-between"><span className="truncate text-sm font-bold">{game.homeTeam}</span><span className="font-display text-lg font-extrabold tabular-nums">{game.homePoints}</span></div>
        </div>
        {(game.homeOwners.length || game.awayOwners.length) ? <div className="mt-2.5 space-y-0.5">{game.awayOwners.map((o, i) => <p key={`away-${i}`} className="text-[11px] text-muted-foreground">{game.awayTeam} ({o.position}) - {o.teamName}</p>)}{game.homeOwners.map((o, i) => <p key={`home-${i}`} className="text-[11px] text-muted-foreground">{game.homeTeam} ({o.position}) - {o.teamName}</p>)}</div> : null}
        {game.status === "in_progress" || game.status === "completed" ? <p className="mt-2 text-[11px] font-bold text-primary">View play-by-play →</p> : null}
      </Link>)}
    </div> : <div className="p-8 text-center text-sm text-muted-foreground">{ownerId ? "None of your drafted units are playing this week." : scope === "all" ? "No FBS games scheduled this week." : "No games involving drafted schools this week."}</div>}
  </section>;
}
