import { useState } from "react";
import { Newspaper, Send } from "lucide-react";
import { toast } from "sonner";
import LeagueShell from "@/components/LeagueShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const columnLabel: Record<string, string> = { monday_recap: "Monday Recap", wednesday_mike_drop: "Mike Drop", friday_preview: "Friday Preview" };

export default function PressBoxWrite() {
  const [passphrase, setPassphrase] = useState("");
  const [checked, setChecked] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });
  const verify = trpc.league.verifyPressBoxWriter.useQuery({ passphrase }, { enabled: checked && passphrase.length > 0 });
  const submit = trpc.league.submitPressBoxArticle.useMutation({
    onSuccess: () => { toast.success("Published! Your column is live on the Press Box."); setForm({ title: "", content: "" }); },
    onError: error => toast.error(error.message),
  });

  if (!checked || !verify.data) {
    return <LeagueShell eyebrow="Press Box writer access"><section className="container max-w-md pt-16"><p className="section-kicker flex items-center gap-2"><Newspaper className="h-3.5 w-3.5" /> Press Box</p><h1 className="display-title mt-3">Writer sign-in</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Enter your access code to publish your column.</p>
      <form className="mt-6 grid gap-3" onSubmit={event => { event.preventDefault(); setChecked(true); }}>
        <Input type="password" placeholder="Access code" value={passphrase} onChange={event => { setPassphrase(event.target.value); setChecked(false); }} autoFocus />
        <Button type="submit" disabled={!passphrase}>Continue</Button>
        {checked && !verify.isLoading && !verify.data ? <p className="text-sm text-destructive">That code isn't recognized. Double-check it and try again.</p> : null}
      </form>
    </section></LeagueShell>;
  }

  return <LeagueShell eyebrow="Press Box writer access"><section className="container max-w-2xl pt-16">
    <p className="section-kicker flex items-center gap-2"><Newspaper className="h-3.5 w-3.5" /> Press Box</p>
    <h1 className="display-title mt-3">Welcome, {verify.data.writerName}</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Publishing to <strong>{columnLabel[verify.data.columnType] ?? verify.data.columnType}</strong>. This goes live immediately once you hit publish.</p>
    <form className="mt-6 grid gap-3" onSubmit={event => { event.preventDefault(); submit.mutate({ passphrase, title: form.title, content: form.content }); }}>
      <Input placeholder="Column title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={200} />
      <Textarea placeholder="Write your column here..." value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} rows={16} required maxLength={50000} />
      <Button type="submit" disabled={submit.isPending} className="justify-self-start"><Send className="mr-2 h-4 w-4" /> {submit.isPending ? "Publishing…" : "Publish column"}</Button>
    </form>
  </section></LeagueShell>;
}
