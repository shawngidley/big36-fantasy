import { useState } from "react";
import { Newspaper, Pencil, Plus, Trash2 } from "lucide-react";
import { useRoute } from "wouter";
import { toast } from "sonner";
import LeagueShell from "@/components/LeagueShell";
import { LeagueLoading } from "@/components/LeagueState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const columnLabel: Record<string, string> = { monday_recap: "Monday Recap", wednesday_mike_drop: "Mike Drop", friday_preview: "Friday Preview" };

export default function PressBoxWrite() {
  const [, params] = useRoute("/press-box/write/:code");
  const code = params?.code ?? "";
  const writer = trpc.league.verifyPressBoxWriter.useQuery({ passphrase: code }, { enabled: code.length > 0 });
  const articles = trpc.league.pressBoxArticles.useQuery();
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "" });

  const submit = trpc.league.submitPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Published!"); articles.refetch(); setComposing(false); setForm({ title: "", content: "" }); }, onError: error => toast.error(error.message) });
  const update = trpc.league.updateOwnPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Updated!"); articles.refetch(); setEditingId(null); setForm({ title: "", content: "" }); }, onError: error => toast.error(error.message) });
  const remove = trpc.league.deleteOwnPressBoxArticle.useMutation({ onSuccess: () => { toast.success("Removed."); articles.refetch(); }, onError: error => toast.error(error.message) });

  if (writer.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (!writer.data) return <LeagueShell eyebrow="Press Box"><section className="container max-w-md pt-16"><p className="text-sm text-muted-foreground">This link isn't recognized. Double-check it with your commissioner.</p></section></LeagueShell>;

  const own = (articles.data ?? []).filter(article => article.column_type === writer.data!.columnType);

  return <LeagueShell eyebrow="Press Box"><section className="container max-w-2xl pt-12">
    <p className="section-kicker flex items-center gap-2"><Newspaper className="h-3.5 w-3.5" /> {columnLabel[writer.data.columnType]}</p>
    <h1 className="display-title mt-3">Welcome, {writer.data.writerName}</h1>
    <p className="mt-2 text-sm text-muted-foreground">Bookmark this page — it's your permanent link, works on any device, no password needed.</p>

    {!composing ? <Button className="mt-6" onClick={() => { setComposing(true); setEditingId(null); setForm({ title: "", content: "" }); }}><Plus className="mr-2 h-4 w-4" /> New column</Button> : <form className="mt-6 grid gap-3" onSubmit={event => { event.preventDefault(); submit.mutate({ passphrase: code, title: form.title, content: form.content }); }}>
      <Input placeholder="Column title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
      <Textarea placeholder="Write your column here..." value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={14} required maxLength={50000} />
      <div className="flex gap-2"><Button type="submit" disabled={submit.isPending}>{submit.isPending ? "Publishing…" : "Publish"}</Button><Button type="button" variant="outline" onClick={() => setComposing(false)}>Cancel</Button></div>
    </form>}

    <h2 className="mt-10 font-display text-lg font-extrabold">Your past columns</h2>
    <div className="mt-4 grid gap-4">{own.length ? own.map(article => <div key={article.id} className="scoreboard-card p-5">
      {editingId === article.id ? <form className="grid gap-3" onSubmit={event => { event.preventDefault(); update.mutate({ passphrase: code, id: article.id, title: form.title, content: form.content }); }}>
        <Input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
        <Textarea value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={10} required maxLength={50000} />
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button></div>
      </form> : <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{article.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{new Date(article.created_at).toLocaleDateString()}</p></div><div className="flex shrink-0 gap-1.5"><Button size="sm" variant="outline" onClick={() => { setEditingId(article.id); setComposing(false); setForm({ title: article.title, content: article.content }); }}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => { if (window.confirm(`Delete "${article.title}"? This cannot be undone.`)) remove.mutate({ passphrase: code, id: article.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>}
    </div>) : <p className="text-sm text-muted-foreground">Nothing published yet.</p>}</div>
  </section></LeagueShell>;
}
