import { ArrowDown, ArrowUp, Goal, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";

const touchdownBands = [
  { band: "1–9 yards", points: "+6" },
  { band: "10–29 yards", points: "+8" },
  { band: "30–59 yards", points: "+10" },
  { band: "60+ yards", points: "+12" },
];

const kickerRows = [
  ["Made PAT", "+1"],
  ["Field goal · 10–29 yards", "+3"],
  ["Field goal · 30–39 yards", "+6"],
  ["Field goal · 40–49 yards", "+9"],
  ["Field goal · 50+ yards", "+12"],
  ["Blocked field goal or punt", "+3"],
  ["Special-teams safety", "+6"],
  ["Any special-teams touchdown", "+12"],
];

const defenseRows = [
  ["Sack", "+1"],
  ["Turnover", "+3"],
  ["Safety", "+6"],
  ["Defensive touchdown return · 1–19 yards", "+9"],
  ["Defensive touchdown return · 20–59 yards", "+12"],
  ["Defensive touchdown return · 60+ yards", "+15"],
  ["Shutout", "+15"],
];

function ScoreTable({ rows }: { rows: string[][] }) {
  return <div className="overflow-hidden rounded-xl border border-border"><table className="w-full text-left text-sm"><tbody>{rows.map(([play, points]) => <tr key={play} className="border-b border-border last:border-b-0"><td className="px-4 py-3 font-medium">{play}</td><td className="w-20 px-4 py-3 text-right font-condensed text-base font-extrabold text-primary">{points}</td></tr>)}</tbody></table></div>;
}

export default function Scoring() {
  return <LeagueShell eyebrow="Official scoring · Year 1"><div className="container py-10 sm:py-14">
    <section className="relative overflow-hidden rounded-[2rem] border border-[#a85b23]/30 bg-[#1a130e] px-6 py-10 text-[#fff9ed] shadow-[0_28px_60px_-42px_rgba(43,22,7,.85)] sm:px-10 sm:py-14">
      <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full border border-[#d6924c]/20" /><div className="absolute -right-4 -top-12 h-48 w-48 rounded-full border border-[#d6924c]/20" />
      <div className="relative max-w-3xl"><p className="section-kicker text-[#e98845]">The official ledger</p><h1 className="mt-3 font-display text-4xl font-extrabold leading-none tracking-tight sm:text-6xl">How every point is earned.</h1><p className="mt-5 max-w-2xl text-base leading-7 text-[#fff9ed]/75 sm:text-lg">36 Football rewards impact plays. Touchdowns scale by scoring-play distance, while the league’s special-teams and defensive units carry their own distinct ledger.</p><div className="mt-8 flex flex-wrap gap-3"><span className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-condensed text-sm font-bold tracking-wide">First 12 regular-season games</span><span className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-condensed text-sm font-bold tracking-wide">Official Year 1 rules</span></div></div>
    </section>

    <section className="mt-10 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
      <article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Goal className="h-5 w-5" /></span><div><p className="section-kicker">QB · RB · WR</p><h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Offensive touchdowns</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Quarterbacks, running backs, and wide receivers use the same touchdown ladder. The value is determined by the scoring play’s yard band.</p></div></div><div className="mt-6 overflow-hidden rounded-xl border border-border"><table className="w-full text-left"><thead className="bg-accent/40 text-xs uppercase tracking-[.14em] text-muted-foreground"><tr><th className="px-4 py-3 font-bold">Scoring-play distance</th><th className="px-4 py-3 text-right font-bold">Points</th></tr></thead><tbody>{touchdownBands.map(row => <tr key={row.band} className="border-t border-border"><td className="px-4 py-3 font-medium">{row.band}</td><td className="px-4 py-3 text-right font-condensed text-lg font-extrabold text-primary">{row.points}</td></tr>)}</tbody></table></div></article>

      <article className="rounded-2xl border border-[#d6924c]/35 bg-[#fff8eb] p-6 shadow-sm sm:p-8"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#d86d22]/15 text-[#a94810]"><Sparkles className="h-5 w-5" /></span><div><p className="section-kicker text-[#a94810]">Tight end exception</p><h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Every TE touchdown</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Tight ends are the Year 1 exception: every TE touchdown is worth the same premium value, regardless of distance.</p></div></div><div className="mt-7 rounded-xl border border-[#d6924c]/35 bg-white/70 p-5"><p className="font-condensed text-sm font-bold uppercase tracking-[.16em] text-[#a94810]">Any touchdown distance</p><p className="mt-1 font-display text-5xl font-extrabold text-[#a94810]">+12</p><p className="mt-3 text-sm leading-6 text-muted-foreground">On a QB-to-TE touchdown, the quarterback still receives the normal QB yard-band value. The TE receives +12.</p></div></article>
    </section>

    <section className="mt-6 grid gap-6 lg:grid-cols-2"><article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"><p className="section-kicker">Conversions & turnovers</p><h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight">The finishing plays</h2><div className="mt-6 space-y-4"><div className="flex gap-3"><span className="mt-0.5 text-primary"><ArrowUp className="h-5 w-5" /></span><p className="text-sm leading-6"><strong>Passing two-point conversion:</strong> the QB gets +4 and the receiving RB, WR, or TE gets +4.</p></div><div className="flex gap-3"><span className="mt-0.5 text-primary"><ArrowUp className="h-5 w-5" /></span><p className="text-sm leading-6"><strong>Rushing two-point conversion:</strong> only the player who scores gets +4.</p></div><div className="flex gap-3"><span className="mt-0.5 text-destructive"><ArrowDown className="h-5 w-5" /></span><p className="text-sm leading-6"><strong>Interception thrown:</strong> QB −3.</p></div><div className="flex gap-3"><span className="mt-0.5 text-destructive"><ArrowDown className="h-5 w-5" /></span><p className="text-sm leading-6"><strong>Fumble lost:</strong> QB, RB, WR, or TE −3.</p></div></div></article>
      <article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span><div><p className="section-kicker">K/ST</p><h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Special teams</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Kickers and special teams operate as one combined unit.</p></div></div><div className="mt-6"><ScoreTable rows={kickerRows} /></div></article>
    </section>

    <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"><div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]"><div><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></span><div><p className="section-kicker">DEF</p><h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Defense</h2></div></div><p className="mt-5 text-sm leading-6 text-muted-foreground">Defensive touchdowns are scored by return distance, while the complete unit is rewarded for pressure, takeaways, safeties, and shutouts.</p><div className="mt-5 rounded-xl border border-border bg-accent/30 p-4 text-sm leading-6"><strong>Shutout note:</strong> a shutout is worth +15 in addition to the defensive events recorded during the game.</div></div><ScoreTable rows={defenseRows} /></div>
    </section>

    <section className="mt-8 rounded-2xl border border-border bg-accent/25 p-6 sm:p-8"><p className="section-kicker">At a glance</p><h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight">A few important scoring reminders</h2><div className="mt-5 grid gap-4 md:grid-cols-3"><p className="rounded-xl bg-background/70 p-4 text-sm leading-6"><strong>Both sides of a passing TD count.</strong> The QB and receiving position group each receive their applicable touchdown value.</p><p className="rounded-xl bg-background/70 p-4 text-sm leading-6"><strong>Only the scorer earns a rushing TD.</strong> There is no separate passing credit on a rushing touchdown.</p><p className="rounded-xl bg-background/70 p-4 text-sm leading-6"><strong>Research and live scoring use this same ruleset.</strong> The public ledger records the event-level calculation behind every result.</p></div></section>
  </div></LeagueShell>;
}
