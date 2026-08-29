import { ArrowLeft, Flame } from "lucide-react";
import { Link, useRoute } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export default function GameDetail() {
  const [, params] = useRoute("/scores/:week/:gameId");
  const week = Number(params?.week);
  const gameId = Number(params?.gameId);
  const scores = trpc.league.liveScores.useQuery({ scope: "all", week }, { enabled: Number.isFinite(week) });
  const plays = trpc.league.gameDetail.useQuery({ gameId, week }, { enabled: Number.isFinite(week) && Number.isFinite(gameId), refetchInterval: 15000 });
  const game = scores.data?.games.find(item => item.id === gameId);

  if (scores.isLoading || plays.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (scores.error) return <LeagueShell><LeagueError message={scores.error.message} /></LeagueShell>;

  return <LeagueShell eyebrow="Play-by-play"><section className="container pt-8 sm:pt-12">
    <Link href="/scores" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-muted-foreground hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Real scores</Link>
    {game ? <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-6"><div className="flex items-center justify-between"><Badge variant={game.status === "in_progress" ? "default" : "secondary"}>{game.status === "in_progress" ? `Q${game.period ?? ""} · ${game.clock ?? "Live"}` : game.status === "completed" ? "Final" : "Scheduled"}</Badge><p className="text-xs text-muted-foreground">{new Date(game.startDate).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>
      <div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-sm font-bold">{game.awayTeam}</p><p className="mt-1 font-display text-4xl font-extrabold tabular-nums">{game.awayPoints}</p></div><div><p className="text-sm font-bold">{game.homeTeam}</p><p className="mt-1 font-display text-4xl font-extrabold tabular-nums">{game.homePoints}</p></div></div>
      {(game.homeOwners.length || game.awayOwners.length) ? <div className="mt-4 space-y-0.5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Affects</p>{game.awayOwners.map((o, i) => <p key={`away-${i}`} className="text-xs text-muted-foreground">{game.awayTeam} ({o.position}) - {o.teamName}</p>)}{game.homeOwners.map((o, i) => <p key={`home-${i}`} className="text-xs text-muted-foreground">{game.homeTeam} ({o.position}) - {o.teamName}</p>)}</div> : null}
    </div> : null}

    <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker">Play-by-play</p><h2 className="mt-1 font-display text-xl font-extrabold">Every play in this game</h2></div>
      {plays.data?.length ? <div className="max-h-[650px] divide-y divide-border/70 overflow-y-auto">{[...plays.data].reverse().map(play => <div key={play.id} className={`px-5 py-3.5 ${play.scoring ? "bg-primary/5" : ""}`}>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{play.scoring ? <Flame className="h-3 w-3 text-primary" /> : null}<span>{play.period ? `Q${play.period}` : ""} {play.clock ?? ""}</span><span>·</span><span>{play.offense} ball</span></div>
        <p className={`mt-1 text-sm ${play.scoring ? "font-bold text-primary" : ""}`}>{play.playText}</p>
        {(play.offenseOwners.length || play.defenseOwners.length) ? <div className="mt-1 space-y-0.5">{play.offenseOwners.map((o, i) => <p key={`off-${i}`} className="text-[11px] text-muted-foreground">{play.offense} ({o.position}) - {o.teamName}</p>)}{play.defenseOwners.map((o, i) => <p key={`def-${i}`} className="text-[11px] text-muted-foreground">{play.defense} ({o.position}) - {o.teamName}</p>)}</div> : null}
      </div>)}</div> : <div className="p-8"><EmptyLedger title="No plays recorded yet" detail="Play-by-play will appear here once the game is underway." /></div>}
    </section>
  </section></LeagueShell>;
}
