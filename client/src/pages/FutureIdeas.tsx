import { useState } from "react";
import { Lightbulb, Send } from "lucide-react";
import { toast } from "sonner";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export default function FutureIdeas() {
  const { isAuthenticated } = useAuth();
  const ideas = trpc.league.futureIdeas.useQuery(undefined, { enabled: isAuthenticated });
  const [form, setForm] = useState({ title: "", content: "" });
  const submit = trpc.league.submitFutureIdea.useMutation({
    onSuccess: () => { toast.success("Idea submitted — thanks for the input!"); ideas.refetch(); setForm({ title: "", content: "" }); },
    onError: error => toast.error(error.message),
  });

  if (!isAuthenticated) return <LeagueShell eyebrow="Future of the league"><section className="container pt-10 sm:pt-14"><div className="max-w-2xl"><p className="section-kicker">Future ideas</p><h1 className="display-title mt-3">Sign in to share your ideas</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in as an owner to view and submit ideas for the future of 36 Football.</p></div></section></LeagueShell>;
  if (ideas.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (ideas.error) return <LeagueShell><LeagueError message={ideas.error.message} /></LeagueShell>;

  return <LeagueShell eyebrow="Future of the league"><section className="container pt-10 sm:pt-14">
    <div className="max-w-2xl"><p className="section-kicker">Owner suggestions</p><h1 className="display-title mt-3">Future Ideas</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Got an idea for a rule change, a new scoring category, or anything else for a future season? Drop it here — every owner can see and read what's been suggested.</p></div>

    <section className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <p className="section-kicker">Submit an idea</p>
      <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); submit.mutate(form); }}>
        <Input placeholder="Idea title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
        <Textarea placeholder="Tell us about it — the more detail, the better." value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={5} required maxLength={5000} />
        <Button type="submit" disabled={submit.isPending} className="justify-self-start"><Send className="mr-2 h-4 w-4" /> {submit.isPending ? "Submitting…" : "Submit idea"}</Button>
      </form>
    </section>

    <section className="mt-8">
      <p className="section-kicker">All ideas ({ideas.data?.length ?? 0})</p>
      {ideas.data?.length ? <div className="mt-4 grid gap-4">{ideas.data.map(idea => <div key={idea.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-start gap-3"><Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="font-display text-lg font-extrabold">{idea.title}</p><p className="mt-1 text-xs text-muted-foreground">{idea.submitted_by_team_name ?? "An owner"} · {new Date(idea.created_at).toLocaleDateString()}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{idea.content}</p></div></div></div>)}</div> : <div className="mt-4"><EmptyLedger title="No ideas yet" detail="Be the first to suggest something for a future season." /></div>}
    </section>
  </section></LeagueShell>;
}
