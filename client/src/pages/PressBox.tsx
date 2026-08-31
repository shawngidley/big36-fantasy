import { useEffect, useState } from "react";
import { Newspaper, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const columnLabel: Record<string, string> = { monday_recap: "Monday Recap", wednesday_mike_drop: "Mike Drop", friday_preview: "Friday Preview" };
const columnSubtitle: Record<string, string> = { monday_recap: "The weekend recap, every Monday.", wednesday_mike_drop: "Weekly rankings, in a different famous Mike's voice each time.", friday_preview: "The week-ahead preview, every Friday." };
const columns = [{ value: "all", label: "All Columns" }, { value: "monday_recap", label: "Monday Recap" }, { value: "wednesday_mike_drop", label: "Mike Drop" }, { value: "friday_preview", label: "Friday Preview" }];
const UNLOCK_STORAGE_KEY = "b36-press-box-writer-unlocked";

export default function PressBox() {
  const { user } = useAuth();
  const articles = trpc.league.pressBoxArticles.useQuery();
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // The unlock box is hidden from regular owners by default. It only shows for the commissioner,
  // for someone visiting via a private "?write=1" link shared individually with a writer, or on a
  // browser that's already successfully unlocked once before (remembered locally).
  const [showUnlockBox, setShowUnlockBox] = useState(false);
  useEffect(() => {
    const alreadyUnlocked = typeof window !== "undefined" && window.localStorage.getItem(UNLOCK_STORAGE_KEY) === "true";
    const viaPrivateLink = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("write") === "1";
    setShowUnlockBox(user?.role === "admin" || alreadyUnlocked || viaPrivateLink);
  }, [user?.role]);

  const [passphrase, setPassphrase] = useState("");
  const [checkedPassphrase, setCheckedPassphrase] = useState("");
  const writer = trpc.league.verifyPressBoxWriter.useQuery({ passphrase: checkedPassphrase }, { enabled: checkedPassphrase.length > 0 });
  useEffect(() => { if (writer.data && typeof window !== "undefined") window.localStorage.setItem(UNLOCK_STORAGE_KEY, "true"); }, [writer.data]);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "" });

  const submit = trpc.league.submitPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Published!"); articles.refetch(); setComposing(false); setForm({ title: "", content: "" }); }, onError: error => toast.error(error.message) });
  const update = trpc.league.updateOwnPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Updated!"); articles.refetch(); setEditingId(null); setForm({ title: "", content: "" }); }, onError: error => toast.error(error.message) });
  const remove = trpc.league.deleteOwnPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Removed."); articles.refetch(); }, onError: error => toast.error(error.message) });

  if (articles.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (articles.error) return <LeagueShell><LeagueError message={articles.error.message} /></LeagueShell>;

  const filtered = filter === "all" ? articles.data ?? [] : (articles.data ?? []).filter(article => article.column_type === filter);
  const isOwn = (columnType: string) => writer.data?.columnType === columnType;

  return <LeagueShell eyebrow="36 Football media"><section className="container pt-10 sm:pt-14">
    <p className="section-kicker flex items-center gap-2"><Newspaper className="h-3.5 w-3.5" /> The Press Box</p>
    <h1 className="display-title mt-3">{filter === "all" ? "Weekly columns from around the league" : columnLabel[filter]}</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{filter === "all" ? "Fresh writing every Monday, Wednesday, and Friday — recaps, rankings, and previews from the 36 Football universe." : columnSubtitle[filter]}</p>

    <div className="mt-6 flex flex-wrap gap-2">{columns.map(item => <button key={item.value} onClick={() => setFilter(item.value)} className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${filter === item.value ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-primary/10"}`}>{item.label}</button>)}</div>

    {showUnlockBox ? <div className="mt-6 rounded-2xl border border-dashed border-border p-4">
      {!writer.data ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setCheckedPassphrase(passphrase); }}><span className="text-xs font-bold text-muted-foreground">Writer? </span><Input type="password" placeholder="Access code" value={passphrase} onChange={event => { setPassphrase(event.target.value); setCheckedPassphrase(""); }} className="h-8 w-40 text-sm" /><Button type="submit" size="sm" variant="outline" disabled={!passphrase}>Unlock</Button>{checkedPassphrase && !writer.isLoading && !writer.data ? <span className="text-xs text-destructive">Code not recognized.</span> : null}</form>
        : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold text-primary">Signed in as {writer.data.writerName} · {columnLabel[writer.data.columnType]}</p>{!composing ? <Button size="sm" onClick={() => { setComposing(true); setEditingId(null); setForm({ title: "", content: "" }); }}><Plus className="mr-1.5 h-3.5 w-3.5" /> New column</Button> : null}</div>}
      {composing && writer.data ? <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); submit.mutate({ passphrase: checkedPassphrase, title: form.title, content: form.content }); }}>
        <Input placeholder="Column title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
        <Textarea placeholder="Write your column here..." value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={10} required maxLength={50000} />
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={submit.isPending}>{submit.isPending ? "Publishing…" : "Publish"}</Button><Button type="button" size="sm" variant="outline" onClick={() => setComposing(false)}>Cancel</Button></div>
      </form> : null}
    </div> : null}

    <div className="mt-8 grid gap-5">{filtered.length ? filtered.map(article => <article key={article.id} className="scoreboard-card p-6">
      {editingId === article.id ? <form className="grid gap-3" onSubmit={event => { event.preventDefault(); update.mutate({ passphrase: checkedPassphrase, id: article.id, title: form.title, content: form.content }); }}>
        <Input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
        <Textarea value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={10} required maxLength={50000} />
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button></div>
      </form> : <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><button onClick={() => setOpenId(openId === article.id ? null : article.id)} className="text-left"><h2 className="font-display text-2xl font-extrabold tracking-tight hover:text-primary">{article.title}</h2></button><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{columnLabel[article.column_type] ?? article.column_type}</Badge><span className="text-xs font-semibold text-muted-foreground">By {article.author_name}</span><span className="text-xs text-muted-foreground">·</span><span className="text-xs font-bold text-primary">{new Date(article.created_at).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div></div>
          {isOwn(article.column_type) ? <div className="flex shrink-0 gap-1.5"><Button size="sm" variant="outline" onClick={() => { setEditingId(article.id); setComposing(false); setForm({ title: article.title, content: article.content }); }}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => { if (window.confirm(`Delete "${article.title}"? This cannot be undone.`)) remove.mutate({ passphrase: checkedPassphrase, id: article.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div> : null}
        </div>
        {openId === article.id ? <div className="mt-4 whitespace-pre-wrap text-sm leading-7">{article.content}</div> : <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{article.content}</p>}
        <button onClick={() => setOpenId(openId === article.id ? null : article.id)} className="mt-3 text-xs font-bold text-primary hover:underline">{openId === article.id ? "Show less ↑" : "Read full column →"}</button>
      </>}
    </article>) : <EmptyLedger title="No columns yet" detail="Check back soon — fresh writing drops every Monday, Wednesday, and Friday." />}</div>
  </section></LeagueShell>;
}
