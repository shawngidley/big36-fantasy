import { Award, Crown, Medal, Trophy } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";

const awards = [
  { icon: Crown, title: "National champion", detail: "The season-long overall standings leader.", amount: "$1,200" },
  { icon: Trophy, title: "Conference champions", detail: "One winner from each of the six conference races.", amount: "$200 each", total: "$1,200 total" },
  { icon: Medal, title: "Position champions", detail: "One leader for each of QB, RB, WR, TE, K/ST, and DEF.", amount: "$200 each", total: "$1,200 total" },
];

export default function Prizes() {
  return <LeagueShell eyebrow="Inaugural season · Prize structure"><section className="container py-10 sm:py-14"><header className="max-w-3xl"><p className="section-kicker">The hardware</p><h1 className="mt-2 display-title">Built to reward every race.</h1><p className="mt-4 text-base leading-7 text-muted-foreground">The inaugural prize structure recognizes the national leaderboard, six conference races, and every position-group championship.</p></header><div className="mt-9 grid gap-5 lg:grid-cols-3">{awards.map(award => <article key={award.title} className="feature-card"><award.icon className="h-6 w-6 text-primary" /><p className="mt-7 font-condensed text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">{award.title}</p><p className="mt-2 font-display text-4xl font-extrabold tracking-tight">{award.amount}</p>{award.total ? <p className="mt-1 font-condensed text-sm font-bold uppercase tracking-wide text-primary">{award.total}</p> : null}<p className="mt-5 text-sm leading-6 text-muted-foreground">{award.detail}</p></article>)}</div><div className="mt-7 rounded-xl border border-border bg-accent/40 p-6"><div className="flex gap-3"><Award className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 className="font-display text-xl font-extrabold">Tie policy</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">If a championship finishes tied, the applicable prize pool is divided equally among the tied winners. Prize outcomes remain tied to the official event ledger and final standings.</p></div></div></div></section></LeagueShell>;
}
