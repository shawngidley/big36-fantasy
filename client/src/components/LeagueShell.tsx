import { Trophy, Shield, Menu, ChevronRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const publicNav = [
  { label: "Standings", path: "/standings" },
  { label: "Draft Board", path: "/draft" },
  { label: "Leaders", path: "/leaders" },
  { label: "Weekly", path: "/weekly" },
];

function Brand() {
  return <Link href="/" className="group flex items-center gap-3" aria-label="Big 36 home">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform duration-200 group-hover:-rotate-3">
      <Trophy className="h-5 w-5" />
    </span>
    <span className="leading-none">
      <span className="block font-display text-xl font-extrabold tracking-[-0.06em] text-foreground">BIG 36</span>
      <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">College Fantasy</span>
    </span>
  </Link>;
}

export default function LeagueShell({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  const [location] = useLocation();
  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="container flex h-[76px] items-center justify-between gap-6">
        <Brand />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {publicNav.map(item => <Link key={item.path} href={item.path} className={cn("rounded-lg px-3 py-2 text-sm font-semibold transition-colors", location === item.path ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
            {item.label}
          </Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/commissioner"><Button variant="outline" size="sm" className="hidden gap-2 border-primary/20 bg-card text-xs font-bold md:flex"><Shield className="h-3.5 w-3.5" /> Commissioner</Button></Link>
          <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="right" className="w-[290px] px-6"><div className="pt-6"><Brand /></div><nav className="mt-10 grid gap-1">{publicNav.map(item => <Link key={item.path} href={item.path} className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold hover:bg-accent"><span>{item.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}<Link href="/commissioner" className="mt-3 flex items-center justify-between rounded-lg bg-primary px-3 py-3 text-sm font-bold text-primary-foreground"><span>Commissioner</span><Shield className="h-4 w-4" /></Link></nav></SheetContent></Sheet>
        </div>
      </div>
    </header>
    <main>{eyebrow ? <div className="border-b border-border/60 bg-accent/40"><div className="container py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div></div> : null}{children}</main>
    <footer className="mt-16 border-t border-border/70"><div className="container flex flex-col gap-3 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>BIG 36 · 36 teams · 6 divisions · 1 champion.</p><p className="font-medium">Commissioner-managed scoring ledger</p></div></footer>
  </div>;
}
