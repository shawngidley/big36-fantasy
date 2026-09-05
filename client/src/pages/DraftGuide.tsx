import type { LucideIcon } from "lucide-react";
import { Download, Shield, ShieldCheck, Swords, Target, Users, Zap } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";

type Guide = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const guides: Guide[] = [
  {
    title: "QB Guide",
    description: "How to value passers under 36 Football scoring, and who to target at every point in the draft.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/qb-guide.pdf",
    icon: Target,
  },
  {
    title: "RB Guide",
    description: "Workload, goal-line role, and receiving work — the signals that separate startable backs from bench pieces.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/rb-guide.pdf",
    icon: Zap,
  },
  {
    title: "WR Guide",
    description: "Target share, route depth, and quarterback context for building out a receiver room.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/wr-guide.pdf",
    icon: Swords,
  },
  {
    title: "TE Guide",
    description: "Where tight end value hides this season and how to weigh it against the rest of the position pool.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/te-guide.pdf",
    icon: Users,
  },
  {
    title: "K Guide",
    description: "Kicker strategy — when to draft it and how much it should actually matter.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/kst-guide.pdf",
    icon: Shield,
  },
  {
    title: "DST Guide",
    description: "Defense and special teams evaluation and matchup planning for 36 Football scoring.",
    href: "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/draft-guides/def-guide.pdf",
    icon: ShieldCheck,
  },
];

function GuideCard({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  return <a href={guide.href} target="_blank" rel="noreferrer" className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
    <div className="flex items-center justify-between gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <Download className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:text-primary" />
    </div>
    <h3 className="mt-4 font-display text-xl font-extrabold tracking-tight">{guide.title}</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide.description}</p>
    <p className="mt-auto pt-5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-foreground/65">Open PDF</p>
  </a>;
}

export default function DraftGuide() {
  return <LeagueShell eyebrow="Draft center · 2026 season">
    <section className="container pt-10 sm:pt-14">
      <div className="relative overflow-hidden rounded-[2rem] border border-primary/20 bg-[#17110c] px-6 py-10 text-[#fff9ef] shadow-xl sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full border-[28px] border-orange-400/10" />
        <div className="pointer-events-none absolute -bottom-28 left-[38%] h-64 w-64 rounded-full border-[24px] border-orange-300/10" />
        <div className="relative max-w-3xl">
          <p className="font-condensed text-xs font-bold uppercase tracking-[.24em] text-orange-200">Draft center · 2026 season</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-[.94] tracking-[-.04em] sm:text-6xl">The draft guide.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-orange-50/75 sm:text-base">Position-by-position draft strategy for 36 Football owners, built around this league's scoring. Six guides, one per position group.</p>
          <div className="mt-7 flex flex-wrap gap-2"><span className="rounded-full border border-orange-100/20 bg-white/10 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-orange-50">6 position guides</span><span className="rounded-full border border-orange-100/20 bg-white/10 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-orange-50">PDF downloads</span></div>
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guides.map(guide => <GuideCard key={guide.title} guide={guide} />)}
      </div>
    </section>
  </LeagueShell>;
}
