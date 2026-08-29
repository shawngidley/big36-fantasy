import { Radio } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

const statusLabel = (status: string, period: number | null, clock: string | null) => {
  if (status === "in_progress") return period && clock ? `Q${period} · ${clock}` : "Live";
  if (status === "completed") return "Final";
  return "Scheduled";
};

export default function RealScoresStrip({ compact = false }: { compact?: boolean }) {
  const scores = trpc.league.liveScores.useQuery(undefined, { refetchInterval: 20000 });
  if (!scores.data?.length) return null;
  const games = compact ? scores.data.slice(0, 6) : scores.data;

  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex items-center justify-between border-b border-border bg-accent/40 px-5 py-4">
      <p className="section-kicker flex items-center gap-2"><Radio className="h-3.5 w-3.5 animate-pulse text-primary" /> Real scores</p>
      {compact ? <Link href="/scores" className="text-xs font-bold text-primary hover:underline">See all →</Link> : null}
    </div>
    <div className={compact ? "grid gap-px bg-border sm:grid-cols-2" : "grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3"}>
      {games.map(game => <div key={game.id} className="bg-card p-4">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground"><span className={game.status === "in_progress" ? "text-primary" : ""}>{statusLabel(game.status, game.period, game.clock)}</span></div>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between"><span className="truncate text-sm font-bold">{game.awayTeam}</span><span className="font-display text-lg font-extrabold tabular-nums">{game.awayPoints}</span></div>
          <div className="flex items-center justify-between"><span className="truncate text-sm font-bold">{game.homeTeam}</span><span className="font-display text-lg font-extrabold tabular-nums">{game.homePoints}</span></div>
        </div>
        {(game.homeOwners.length || game.awayOwners.length) ? <p className="mt-2.5 truncate text-[11px] text-muted-foreground">{[...game.awayOwners, ...game.homeOwners].map(o => `${o.teamName} (${o.position})`).join(" · ")}</p> : null}
      </div>)}
    </div>
  </section>;
}
