import { useMemo, useState } from "react";
import { BookOpenText, Search, Trophy } from "lucide-react";
import { LeagueError, LeagueLoading } from "@/components/LeagueState";
import LeagueShell from "@/components/LeagueShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const positions = ["QB", "RB", "WR", "TE", "K_ST", "DEF"] as const;
const label = (position: string) => position === "K_ST" ? "K/ST" : position;
const statLabel = (key: string) => key.replaceAll("_", " ");

export default function DraftResearch() {
  const [position, setPosition] = useState<(typeof positions)[number]>("QB");
  const [search, setSearch] = useState("");
  const queryInput = useMemo(() => ({ position }), [position]);
  const catalog = trpc.league.research.useQuery(queryInput);
  if (catalog.isLoading) return <LeagueShell eyebrow="2025 official archive"><LeagueLoading /></LeagueShell>;
  if (catalog.error || !catalog.data) return <LeagueShell eyebrow="2025 official archive"><LeagueError message={catalog.error?.message} /></LeagueShell>;
	  const units = catalog.data.filter(unit => unit.schoolName.toLowerCase().includes(search.toLowerCase())).sort((left, right) => {
	    const status = (unit: (typeof catalog.data)[number]) => {
	      const summary = unit.statSummary as Record<string, unknown>;
	      return summary.historical_points_certified === true ? 2 : summary.historical_points_provisional === true ? 1 : 0;
	    };
	    const leftStatus = status(left);
	    const rightStatus = status(right);
	    if (leftStatus !== rightStatus) return rightStatus - leftStatus;
	    return leftStatus > 0 ? (right.normalizedPoints ?? 0) - (left.normalizedPoints ?? 0) : left.schoolName.localeCompare(right.schoolName);
	  });
  return <LeagueShell eyebrow="2025 official archive"><section className="container pt-10 sm:pt-14"><div className="max-w-3xl"><p className="section-kicker">Draft research</p><h1 className="display-title mt-3">Every available unit, scored your way.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Compare all 136 FBS school-position units using their 2025 regular-season output under the official 36 Football rules. Scores use the first 12 eligible regular-season games and the live scoring model.</p></div><div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2">{positions.map(item => <button key={item} type="button" onClick={() => setPosition(item)} className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition-colors ${position === item ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-primary/10"}`}>{label(item)}</button>)}</div><div className="relative min-w-0 sm:w-60"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter schools" className="pl-9" /></div></div><div className="mt-5 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><BookOpenText className="h-4 w-4 text-primary" /> {units.length} 2025 {label(position)} units · refresh calculation: {new Date(catalog.data[0]?.calculatedAt ?? Date.now()).toLocaleDateString()}</div><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{units.map((unit, index) => {
    const statSummary = unit.statSummary as Record<string, unknown>;
    const certifiedQbStatLine = unit.position === "QB" && statSummary.qb_stat_line_certified === true;
    const certifiedNonQbStatLine = unit.position !== "QB" && statSummary.non_qb_stat_line_certified === true;
    const qbTierPointHold = certifiedQbStatLine && statSummary.qb_tier_point_hold === true;
    const nonQbTierPointHold = certifiedNonQbStatLine && statSummary.non_qb_tier_point_hold === true;
	    const historicalPointsCertified = statSummary.historical_points_certified === true;
	    const historicalPointsProvisional = statSummary.historical_points_provisional === true;
	    const historicalPointsHeld = statSummary.historical_points_hold === true || qbTierPointHold || nonQbTierPointHold;
	    const neutralTierCount = Number(statSummary.provisional_def_estimated_td_count ?? 0);
	    const normalizedPoints = unit.normalizedPoints ?? 0;
    const officialPoints = unit.officialPoints ?? 0;
	    const visibleStats = Object.entries(statSummary).filter(([key, value]) => value && !key.startsWith("qb_stat_line_") && !key.startsWith("non_qb_") && !key.startsWith("historical_points_") && !key.startsWith("provisional_def_"));
	    const disclosure = historicalPointsCertified
	      ? "Certified first-12-game total: normalized scoring plays reconcile touchdown tiers and conversions to official CFBD turnover controls."
	      : historicalPointsProvisional
	        ? "Provisional DEF estimate: official first-12-game sack, interception, defensive-touchdown-count, and shutout controls are combined with role-normalized ESPN recoveries, safeties, and known touchdown distances. Missing defensive touchdown distances use a neutral 12-point tier; this is not a certified total."
	      : historicalPointsHeld
        ? "Official first-12-game stat line is certified. Historical tiered points are held pending complete touchdown-distance or event-ownership reconciliation; no unsupported point total is displayed."
        : Object.entries(unit.eventCounts).filter(([, value]) => value).map(([key, value]) => `${value} ${statLabel(key)}`).join(" · ") || "No scoring events recorded in the verified archive.";
	    return <article key={`${unit.schoolName}-${unit.position}`} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-primary">{historicalPointsCertified ? `#${index + 1} · ` : historicalPointsProvisional ? `Estimate · ` : "Held · "}{label(unit.position)}</p><h2 className="mt-1 font-display text-xl font-extrabold tracking-tight">{unit.schoolName}</h2></div><div className="text-right">{historicalPointsCertified || historicalPointsProvisional ? <><p className="font-display text-3xl font-extrabold text-primary">{normalizedPoints.toFixed(0)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{historicalPointsCertified ? "certified 12-game points" : "provisional 12-game estimate"}</p><p className="mt-1 text-[10px] text-muted-foreground">{officialPoints.toFixed(0)} raw · {unit.eligibleGames} games</p></> : <><p className="font-display text-xl font-extrabold uppercase tracking-wide text-muted-foreground">Held</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">historical total</p></>}</div></div><div className="mt-5 flex flex-wrap gap-2">{visibleStats.map(([key, value]) => <Badge key={key} variant="secondary" className="capitalize">{String(value)} {statLabel(key)}</Badge>)}{historicalPointsProvisional && neutralTierCount > 0 ? <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary">{neutralTierCount} neutral TD {neutralTierCount === 1 ? "tier" : "tiers"}</Badge> : null}</div><div className="mt-4 border-t border-border pt-3"><p className="text-xs leading-5 text-muted-foreground">{disclosure}</p></div></article>;
  })}</div>{!units.length ? <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><Trophy className="mx-auto mb-3 h-6 w-6 text-primary" />No matching 2025 units were found.</div> : null}</section></LeagueShell>;
}
