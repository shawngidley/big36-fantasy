import { useEffect, useMemo, useState } from "react";
import { Radio, ShieldCheck, Sparkles, Timer, Trophy } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import { trpc } from "@/lib/trpc";

const pad = (value: number) => String(Math.max(0, value)).padStart(2, "0");

type LotteryView = {
  status: "READY" | "RUNNING" | "PAUSED" | "COMPLETE" | "ABORTED";
  orderCommitment: string;
  revealIntervalSeconds: number;
  revealedCount: number;
  startedAt: string | null;
  elapsedMsBeforePause: number;
  reveals: Array<{ revealIndex: number; draftPosition: number; revealedAt: string; owner: { id: string; teamName: string; displayName: string; nickname?: string | null } }>;
};

function Countdown({ lottery, now }: { lottery: LotteryView; now: number }) {
  if (lottery.status !== "RUNNING" || !lottery.startedAt || lottery.revealedCount >= 36) return null;
  const elapsed = lottery.elapsedMsBeforePause + Math.max(0, now - new Date(lottery.startedAt).getTime());
  const dueAt = (lottery.revealedCount + 1) * lottery.revealIntervalSeconds * 1_000;
  const remainingSeconds = Math.ceil(Math.max(0, dueAt - elapsed) / 1_000);
  return <div className="rounded-full border border-white/15 bg-white/10 px-5 py-2 font-mono text-2xl font-bold tracking-[0.15em] text-white tabular-nums">00:{pad(remainingSeconds)}</div>;
}

export default function DraftLottery() {
  const lottery = trpc.league.draftLottery.useQuery(undefined, { refetchInterval: query => query.state.data?.status === "RUNNING" ? 4_000 : false });
  const schedule = trpc.league.draftLotterySchedule.useQuery();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);
  const data = lottery.data as LotteryView | null | undefined;
  const latest = data?.reveals[data.reveals.length - 1];
  const nextPosition = data ? 36 - data.revealedCount : 36;
  const revealProgress = data ? `${data.revealedCount} / 36 revealed` : "36 programs awaiting draw";
  const completedRows = useMemo(() => data?.reveals ?? [], [data?.reveals]);
  const scheduledLabel = schedule.data?.scheduledFor ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(schedule.data.scheduledFor)) : "Sunday, August 23 at 9:00 PM ET";

  return <LeagueShell eyebrow="Inaugural draft lottery"><div className="relative overflow-hidden bg-[#100d0a] text-white"><div className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_50%_-20%,rgba(194,93,28,.55),transparent_35%),linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:auto,36px_36px,36px_36px]" /><div className="relative container py-10 sm:py-16"><header className="mx-auto max-w-4xl text-center"><div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-orange-300/30 bg-orange-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[.22em] text-orange-200"><Radio className="h-3.5 w-3.5 animate-pulse" />Live order reveal</div><p className="mt-8 font-condensed text-sm font-bold uppercase tracking-[.3em] text-orange-300">36 Football · Inaugural Draft</p><h1 className="mt-3 font-display text-5xl font-extrabold tracking-tight text-white sm:text-7xl">The Lottery</h1><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-stone-300">Thirty-six programs. One locked draw. Draft positions reveal in reverse, from 36 to 1.</p></header>

      {!data ? <section className="mx-auto mt-12 max-w-4xl rounded-3xl border border-white/15 bg-white/[.06] px-6 py-16 text-center shadow-2xl backdrop-blur"><Timer className="mx-auto h-10 w-10 text-orange-300" /><p className="mt-5 font-condensed text-sm font-bold uppercase tracking-[.22em] text-orange-200">Scheduled lottery</p><h2 className="mt-3 font-display text-3xl font-extrabold">{scheduledLabel}</h2><p className="mx-auto mt-4 max-w-lg leading-7 text-stone-300">The field is set, but the draw stays in standby until a commissioner explicitly starts the locked lottery. Once approved, a new position reveals every 20 seconds.</p></section> : <><section className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-[1fr_1.8fr_1fr]"><div className="order-2 rounded-2xl border border-white/10 bg-black/20 p-6 text-center lg:order-1"><p className="font-condensed text-xs font-bold uppercase tracking-[.2em] text-stone-400">Reveal pace</p><p className="mt-3 font-display text-3xl font-extrabold">20 sec</p><p className="mt-2 text-sm leading-6 text-stone-400">Automatic positions<br />{revealProgress}</p></div><div className="relative order-1 overflow-hidden rounded-3xl border border-orange-300/30 bg-gradient-to-b from-[#3a1a0a] via-[#1c120d] to-[#0e0b09] px-6 py-10 text-center shadow-[0_30px_80px_rgba(0,0,0,.55)] lg:order-2 sm:px-12"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-300 to-transparent" /><div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[.2em] text-orange-200"><Sparkles className="h-3.5 w-3.5" />{data.status === "RUNNING" ? `Next: Position ${nextPosition}` : data.status === "PAUSED" ? "Lottery paused" : "Official order complete"}</div>{data.status === "RUNNING" ? <div className="mt-7 flex justify-center"><Countdown lottery={data} now={now} /></div> : null}<p className="mt-7 font-condensed text-sm font-bold uppercase tracking-[.22em] text-stone-400">{latest ? `Draft Position ${latest.draftPosition}` : "First reveal incoming"}</p><h2 className="mt-3 min-h-14 font-display text-4xl font-extrabold sm:text-6xl">{latest?.owner.teamName ?? "Stand by"}</h2><p className="mt-3 text-sm text-stone-300">{latest?.owner.nickname ? `${latest.owner.nickname} · ` : ""}{latest ? latest.owner.displayName : "The draw is locked before any result is shown."}</p>{latest ? <p className="mt-7 text-xs font-bold uppercase tracking-[.16em] text-orange-200">Revealed at {new Date(latest.revealedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</p> : null}</div><div className="order-3 rounded-2xl border border-white/10 bg-black/20 p-6 text-center"><p className="font-condensed text-xs font-bold uppercase tracking-[.2em] text-stone-400">Draw integrity</p><ShieldCheck className="mx-auto mt-3 h-7 w-7 text-orange-300" /><p className="mt-3 text-sm leading-6 text-stone-300">The complete order was locked before the first reveal.</p><p className="mt-3 font-mono text-[10px] tracking-wider text-stone-500">{data.orderCommitment.slice(0, 18)}…</p></div></section>

      <section className="mx-auto mt-10 max-w-6xl rounded-2xl border border-white/10 bg-black/25 p-5 sm:p-7"><div className="flex flex-col justify-between gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end"><div><p className="font-condensed text-xs font-bold uppercase tracking-[.22em] text-orange-300">Official reveal board</p><h2 className="mt-1 font-display text-2xl font-extrabold">Draft positions revealed</h2></div><div className="flex items-center gap-2 text-sm text-stone-300"><Trophy className="h-4 w-4 text-orange-300" />Pick 1 is revealed last</div></div>{completedRows.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{completedRows.map(reveal => <article key={reveal.revealIndex} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[.035] p-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-orange-300/30 bg-orange-400/10 font-display text-lg font-extrabold text-orange-200">{reveal.draftPosition}</div><div className="min-w-0"><p className="truncate font-bold text-white">{reveal.owner.teamName}</p><p className="truncate text-xs text-stone-400">{reveal.owner.nickname ?? reveal.owner.displayName}</p></div></article>)}</div> : <p className="py-8 text-center text-sm text-stone-400">The first program will appear here when Position 36 is revealed.</p>}</section></>}</div></div></LeagueShell>;
}
