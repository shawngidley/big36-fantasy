import { Shield, Menu, ChevronRight, LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

const publicNav = [
  { label: "Join League", path: "/join" },
  { label: "Standings", path: "/standings" },
  { label: "Scoring", path: "/scoring" },
  { label: "2025 Research", path: "/research" },
  { label: "2026 Guide", path: "/college-football-guide" },
  { label: "Leaders", path: "/leaders" },
  { label: "Weekly", path: "/weekly" },
  { label: "My Team", path: "/my-team" },
  { label: "Prizes", path: "/prizes" },
];

const draftNav = [
  { label: "Lottery", path: "/draft-lottery" },
  { label: "My Draft", path: "/my-draft" },
  { label: "Draft Order", path: "/draft" },
];

function Brand() {
  return <Link href="/" className="group flex items-center gap-3" aria-label="36 Football home">
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#13100d] transition-transform duration-200 group-hover:-rotate-3">
      <img src="/manus-storage/36football-helmet-wordmark-192_f71497b3.png" alt="" className="h-full w-full object-contain" />
    </span>
    <span className="leading-none">
      <span className="block font-display text-xl font-extrabold tracking-[-0.06em] text-[var(--header-foreground)]">36 FOOTBALL</span>
      <span className="mt-1 block font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--header-foreground)]/60">Inaugural season</span>
    </span>
  </Link>;
}

export default function LeagueShell({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  return <div className="min-h-screen bg-background text-foreground">
    <header className="league-header sticky top-0 z-40 backdrop-blur-xl">
      <div className="container flex h-[76px] items-center justify-between gap-6">
        <Brand />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {publicNav.slice(0, 2).map(item => <Link key={item.path} href={item.path} className={cn("league-nav-link rounded-md px-3 py-2 font-condensed text-base font-semibold tracking-wide transition-colors", location === item.path && "league-nav-link-active")}>
            {item.label}
          </Link>)}
          <details className="group relative"><summary className={cn("league-nav-link flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 font-condensed text-base font-semibold tracking-wide transition-colors [&::-webkit-details-marker]:hidden", draftNav.some(item => location === item.path) && "league-nav-link-active")}>Draft <span className="text-[10px] transition-transform group-open:rotate-180">▾</span></summary><div className="absolute left-0 top-full z-50 mt-2 w-44 rounded-xl border border-white/15 bg-[#17110c] p-1.5 shadow-2xl"><p className="px-3 py-2 font-condensed text-[10px] font-bold uppercase tracking-[.2em] text-orange-200/70">Draft center</p>{draftNav.map(item => <Link key={item.path} href={item.path} className={cn("block rounded-lg px-3 py-2.5 font-condensed text-sm font-bold tracking-wide text-white/80 transition-colors hover:bg-white/10 hover:text-white", location === item.path && "bg-orange-400/15 text-orange-100")}>{item.label}</Link>)}</div></details>
          {publicNav.slice(2).map(item => <Link key={item.path} href={item.path} className={cn("league-nav-link rounded-md px-3 py-2 font-condensed text-base font-semibold tracking-wide transition-colors", location === item.path && "league-nav-link-active")}>
            {item.label}
          </Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {user ? <Button variant="outline" size="sm" onClick={() => logout()} className="hidden gap-2 border-white/30 bg-transparent font-condensed text-sm font-bold tracking-wide text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex"><LogOut className="h-3.5 w-3.5" /> Sign out</Button> : <Link href="/join"><Button variant="outline" size="sm" className="hidden gap-2 border-white/30 bg-transparent font-condensed text-sm font-bold tracking-wide text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex"><UserRound className="h-3.5 w-3.5" /> Join</Button></Link>}<Link href="/commissioner"><Button variant="ghost" size="icon" className="hidden text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex" aria-label="Commissioner"><Shield className="h-4 w-4" /></Button></Link>
          <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="right" className="w-[290px] px-6"><div className="pt-6"><Brand /></div><nav className="mt-10 grid gap-1"><Link href="/commissioner" className="mb-2 flex items-center justify-between rounded-lg bg-primary px-3 py-3 text-sm font-bold text-primary-foreground"><span>Commissioner</span><Shield className="h-4 w-4" /></Link>{publicNav.slice(0, 2).map(item => <Link key={item.path} href={item.path} className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold hover:bg-accent"><span>{item.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}<div className="my-2 rounded-xl border border-border bg-accent/30 p-2"><p className="px-2 pb-1 pt-1 font-condensed text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground">Draft</p>{draftNav.map(item => <Link key={item.path} href={item.path} className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm font-semibold hover:bg-background"><span>{item.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}</div>{publicNav.slice(2).map(item => <Link key={item.path} href={item.path} className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold hover:bg-accent"><span>{item.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}</nav></SheetContent></Sheet>
        </div>
      </div>
    </header>
    <main>{eyebrow ? <div className="border-b border-border/60 bg-accent/40"><div className="container py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div></div> : null}{children}</main>
    <footer className="league-footer mt-16"><div className="container flex flex-col gap-4 py-8 font-condensed text-sm tracking-wide sm:flex-row sm:items-center sm:justify-between"><p className="leading-6">© 2026 36 Football. All rights reserved. Website designed and developed by <a href="https://ascend-cx.com" target="_blank" rel="noreferrer" className="font-bold underline decoration-orange-400/70 underline-offset-4 transition-colors hover:text-orange-300">Ascend CX</a>.</p><nav className="flex flex-wrap items-center gap-x-3 gap-y-1 font-bold" aria-label="Legal navigation"><Link href="/terms" className="transition-colors hover:text-orange-300">Terms of Use</Link><span aria-hidden="true" className="opacity-50">|</span><Link href="/privacy" className="transition-colors hover:text-orange-300">Privacy Policy</Link></nav></div></footer>
  </div>;
}
