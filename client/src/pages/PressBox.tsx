import { useState } from "react";
import { Newspaper } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const columnLabel: Record<string, string> = { monday_recap: "Monday Recap", wednesday_mike_drop: "Mike Drop", friday_preview: "Friday Preview" };
const columns = [{ value: "all", label: "All Columns" }, { value: "monday_recap", label: "Monday Recap" }, { value: "wednesday_mike_drop", label: "Mike Drop" }, { value: "friday_preview", label: "Friday Preview" }];

export default function PressBox() {
  const articles = trpc.league.pressBoxArticles.useQuery();
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  if (articles.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (articles.error) return <LeagueShell><LeagueError message={articles.error.message} /></LeagueShell>;

  const filtered = filter === "all" ? articles.data ?? [] : (articles.data ?? []).filter(article => article.column_type === filter);

  return <LeagueShell eyebrow="36 Football media"><section className="container pt-10 sm:pt-14">
    <p className="section-kicker flex items-center gap-2"><Newspaper className="h-3.5 w-3.5" /> The Press Box</p>
    <h1 className="display-title mt-3">Weekly columns from around the league</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Fresh writing every Monday, Wednesday, and Friday — recaps, rankings, and previews from the 36 Football universe.</p>

    <div className="mt-6 flex flex-wrap gap-2">{columns.map(item => <button key={item.value} onClick={() => setFilter(item.value)} className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${filter === item.value ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-primary/10"}`}>{item.label}</button>)}</div>

    <div className="mt-8 grid gap-5">{filtered.length ? filtered.map(article => <article key={article.id} className="scoreboard-card p-6">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{columnLabel[article.column_type] ?? article.column_type}</Badge><span className="text-xs text-muted-foreground">{article.author_name} · {new Date(article.created_at).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>
      <button onClick={() => setOpenId(openId === article.id ? null : article.id)} className="mt-3 text-left"><h2 className="font-display text-2xl font-extrabold tracking-tight hover:text-primary">{article.title}</h2></button>
      {openId === article.id ? <div className="mt-4 whitespace-pre-wrap text-sm leading-7">{article.content}</div> : <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{article.content}</p>}
      <button onClick={() => setOpenId(openId === article.id ? null : article.id)} className="mt-3 text-xs font-bold text-primary hover:underline">{openId === article.id ? "Show less ↑" : "Read full column →"}</button>
    </article>) : <EmptyLedger title="No columns yet" detail="Check back soon — fresh writing drops every Monday, Wednesday, and Friday." />}</div>
  </section></LeagueShell>;
}
