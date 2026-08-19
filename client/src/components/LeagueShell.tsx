import { Shield, Menu, ChevronRight, LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

const publicNav = [
  { label: "Join League", path: "/join" },
  { label: "Standings", path: "/standings" },
  { label: "Draft Board", path: "/draft" },
  { label: "2025 Research", path: "/research" },
  { label: "Leaders", path: "/leaders" },
  { label: "Weekly", path: "/weekly" },
  { label: "My Draft", path: "/my-draft" },
  { label: "Prizes", path: "/prizes" },
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
          {publicNav.map(item => <Link key={item.path} href={item.path} className={cn("league-nav-link rounded-md px-3 py-2 font-condensed text-base font-semibold tracking-wide transition-colors", location === item.path && "league-nav-link-active")}>
            {item.label}
          </Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {user ? <Button variant="outline" size="sm" onClick={() => logout()} className="hidden gap-2 border-white/30 bg-transparent font-condensed text-sm font-bold tracking-wide text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex"><LogOut className="h-3.5 w-3.5" /> Sign out</Button> : <Link href="/join"><Button variant="outline" size="sm" className="hidden gap-2 border-white/30 bg-transparent font-condensed text-sm font-bold tracking-wide text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex"><UserRound className="h-3.5 w-3.5" /> Join</Button></Link>}<Link href="/my-draft"><Button variant="outline" size="sm" className="hidden border-white/30 bg-transparent font-condensed text-sm font-bold tracking-wide text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] xl:flex">My Draft</Button></Link><Link href="/commissioner"><Button variant="ghost" size="icon" className="hidden text-[var(--header-foreground)] hover:bg-white/10 hover:text-[var(--header-foreground)] md:flex" aria-label="Commissioner"><Shield className="h-4 w-4" /></Button></Link>
          <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="right" className="w-[290px] px-6"><div className="pt-6"><Brand /></div><nav className="mt-10 grid gap-1">{publicNav.map(item => <Link key={item.path} href={item.path} className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold hover:bg-accent"><span>{item.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}<Link href="/commissioner" className="mt-3 flex items-center justify-between rounded-lg bg-primary px-3 py-3 text-sm font-bold text-primary-foreground"><span>Commissioner</span><Shield className="h-4 w-4" /></Link></nav></SheetContent></Sheet>
        </div>
      </div>
    </header>
    <main>{eyebrow ? <div className="border-b border-border/60 bg-accent/40"><div className="container py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div></div> : null}{children}</main>
    <footer className="league-footer mt-16"><div className="container flex flex-col gap-3 py-8 font-condensed text-sm tracking-wide sm:flex-row sm:items-center sm:justify-between"><p>36 Football · 36 programs · 6 conferences · 1 national champion.</p><p className="font-medium">Official live scoring ledger</p></div></footer>
  </div>;
}
