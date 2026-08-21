import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  CalendarDays,
  Database,
  GraduationCap,
  Layers3,
  ShieldCheck,
  Telescope,
  UserRoundSearch,
} from "lucide-react";
import LeagueShell from "@/components/LeagueShell";

type Resource = {
  title: string;
  description: string;
  href: string;
  source: string;
  tag: string;
};

type ResourceGroup = {
  title: string;
  description: string;
  icon: LucideIcon;
  resources: Resource[];
};

const resourceGroups: ResourceGroup[] = [
  {
    title: "Stats & player history",
    description: "Start with production, then use game logs and context to decide whether it can carry forward.",
    icon: BarChart3,
    resources: [
      {
        title: "NCAA FBS Statistics",
        description: "National individual and team leaderboards across passing, rushing, receiving, kicking, defense, and more.",
        href: "https://www.ncaa.com/stats/football/fbs",
        source: "NCAA.com",
        tag: "Official stats",
      },
      {
        title: "College Football Reference",
        description: "Player and school pages with seasons, game logs, splits, schedules, rosters, and historical leaders.",
        href: "https://www.sports-reference.com/cfb/",
        source: "Sports Reference",
        tag: "History & game logs",
      },
      {
        title: "36 Football 2025 Archive",
        description: "The league’s own first-12-game research catalog, calculated with 36 Football scoring rules.",
        href: "/research",
        source: "36 Football",
        tag: "League research",
      },
    ],
  },
  {
    title: "Depth charts & roster movement",
    description: "Confirm who is actually in line for snaps before trusting last season’s production.",
    icon: UserRoundSearch,
    resources: [
      {
        title: "Ourlads FBS Depth Charts",
        description: "2026 depth charts and rosters across FBS, including transfer and true-freshman markers.",
        href: "https://www.ourlads.com/ncaa-football-depth-charts/",
        source: "Ourlads",
        tag: "Depth charts",
      },
      {
        title: "247Sports Transfer Portal",
        description: "Track portal entries, destinations, positions, and school movement throughout the 2026 cycle.",
        href: "https://247sports.com/season/2026-football/transferportal/",
        source: "247Sports",
        tag: "Transfers",
      },
      {
        title: "247Sports Composite Recruiting",
        description: "Compare 2026 recruiting classes, commit quality, and roster-building context by school.",
        href: "https://247sports.com/season/2026-football/compositeteamrankings/",
        source: "247Sports",
        tag: "Recruiting",
      },
    ],
  },
  {
    title: "Schedule, projections & analytics",
    description: "Use opponent quality, schedule shape, and team outlook to frame each unit’s ceiling and risk.",
    icon: Telescope,
    resources: [
      {
        title: "FBSchedules",
        description: "A clean national reference for regular-season schedules, matchups, and bowl calendars.",
        href: "https://fbschedules.com/college-football-schedule/",
        source: "FBSchedules",
        tag: "Schedules",
      },
      {
        title: "ESPN FPI",
        description: "Team-strength ratings, projected records, and season-outlook context across the FBS field.",
        href: "https://www.espn.com/college-football/fpi",
        source: "ESPN",
        tag: "Projections",
      },
      {
        title: "College Football Data",
        description: "Schedules, data tools, exports, API documentation, and deeper college-football analytics workflows.",
        href: "https://collegefootballdata.com/",
        source: "CollegeFootballData",
        tag: "Analytics",
      },
    ],
  },
  {
    title: "Season orientation",
    description: "Use these sources to understand the national race, postseason context, and major 2026 developments.",
    icon: GraduationCap,
    resources: [
      {
        title: "College Football Playoff",
        description: "Official playoff news, rankings, format information, and postseason schedule resources.",
        href: "https://collegefootballplayoff.com/",
        source: "CFP",
        tag: "Postseason",
      },
      {
        title: "NCAA College Football",
        description: "NCAA coverage for FBS news, scores, standings, rankings, and season features.",
        href: "https://www.ncaa.com/news/football",
        source: "NCAA.com",
        tag: "News & context",
      },
    ],
  },
];

function ResourceLink({ resource }: { resource: Resource }) {
  const external = resource.href.startsWith("http");
  const className = "group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md";
  const body = <>
    <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-primary">{resource.tag}</p>{external ? <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /> : <BookOpenText className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />}</div>
    <h3 className="mt-3 font-display text-xl font-extrabold tracking-tight">{resource.title}</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{resource.description}</p>
    <p className="mt-auto pt-5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-foreground/65">{external ? `Open ${resource.source}` : "Open league archive"}</p>
  </>;
  return external
    ? <a href={resource.href} target="_blank" rel="noreferrer" className={className}>{body}</a>
    : <a href={resource.href} className={className}>{body}</a>;
}

export default function CollegeFootballGuide() {
  return <LeagueShell eyebrow="2026 field guide">
    <section className="container pt-10 sm:pt-14">
      <div className="relative overflow-hidden rounded-[2rem] border border-primary/20 bg-[#17110c] px-6 py-10 text-[#fff9ef] shadow-xl sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full border-[28px] border-orange-400/10" />
        <div className="pointer-events-none absolute -bottom-28 left-[38%] h-64 w-64 rounded-full border-[24px] border-orange-300/10" />
        <div className="relative max-w-3xl">
          <p className="font-condensed text-xs font-bold uppercase tracking-[.24em] text-orange-200">Research desk · 2026 season</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-[.94] tracking-[-.04em] sm:text-6xl">The college football<br />field guide.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-orange-50/75 sm:text-base">A curated starting desk for 36 Football owners. Follow the snaps, the movement, the schedule, and the production before you make your pick.</p>
          <div className="mt-7 flex flex-wrap gap-2"><span className="rounded-full border border-orange-100/20 bg-white/10 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-orange-50">10 vetted resources</span><span className="rounded-full border border-orange-100/20 bg-white/10 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-orange-50">FBS focused</span><span className="rounded-full border border-orange-100/20 bg-white/10 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[.13em] text-orange-50">Updated sources</span></div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Layers3 className="h-5 w-5" /></span><div><p className="section-kicker">Drafting discipline</p><h2 className="font-display text-2xl font-extrabold tracking-tight">Build a player case, not a hunch.</h2></div></div><p className="mt-4 text-sm leading-6 text-muted-foreground">Use the sequence below whenever you are comparing school-position units. It keeps current opportunity separate from prior production and protects against stale assumptions.</p></div>
        <ol className="grid gap-3 sm:grid-cols-2"><li className="rounded-2xl border border-border bg-accent/40 p-5"><span className="font-display text-2xl font-extrabold text-primary">01</span><p className="mt-2 font-semibold">Confirm the depth chart</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Who is projected to take meaningful snaps right now?</p></li><li className="rounded-2xl border border-border bg-accent/40 p-5"><span className="font-display text-2xl font-extrabold text-primary">02</span><p className="mt-2 font-semibold">Check movement</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Transfers, recruits, and new teammates can change the role.</p></li><li className="rounded-2xl border border-border bg-accent/40 p-5"><span className="font-display text-2xl font-extrabold text-primary">03</span><p className="mt-2 font-semibold">Study production</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Use game logs and the 36 Football research archive as the baseline.</p></li><li className="rounded-2xl border border-border bg-accent/40 p-5"><span className="font-display text-2xl font-extrabold text-primary">04</span><p className="mt-2 font-semibold">Frame the schedule</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Team strength and opponents help define range of outcomes.</p></li></ol>
      </div>

      <div className="mt-12 space-y-10">
        {resourceGroups.map(group => {
          const Icon = group.icon;
          return <section key={group.title}>
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><div><p className="section-kicker">2026 resource lane</p><h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{group.title}</h2></div></div><p className="hidden max-w-sm text-right text-sm leading-5 text-muted-foreground lg:block">{group.description}</p></div>
            <p className="mb-4 text-sm leading-6 text-muted-foreground lg:hidden">{group.description}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{group.resources.map(resource => <ResourceLink key={resource.title} resource={resource} />)}</div>
          </section>;
        })}
      </div>

      <aside className="mt-12 rounded-2xl border border-primary/25 bg-primary/5 p-6 sm:p-8"><div className="flex items-start gap-4"><ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" /><div><p className="section-kicker">Research standard</p><h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight">Use the links as inputs, not promises.</h2><p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">Depth charts can lag coach announcements. Player movement changes quickly. Projections describe context, not certainty. For a consequential draft decision, cross-check at least two sources, then use the 36 Football archive and scoring rules to translate the football information into this league’s format.</p></div></div></aside>
    </section>
  </LeagueShell>;
}
