import { useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import TeamLogo from "@/components/TeamLogo";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const formatTime = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function MessageBoard({ divisionId, divisionName, canPost, isCommissioner }: { divisionId: string; divisionName: string; canPost: boolean; isCommissioner?: boolean }) {
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const messages = trpc.league.divisionMessages.useQuery({ divisionId }, { refetchInterval: 15000 });
  const post = trpc.league.postDivisionMessage.useMutation({ onSuccess: () => { setDraft(""); utils.league.divisionMessages.invalidate({ divisionId }); } });
  const remove = trpc.league.admin.deleteDivisionMessage.useMutation({ onSuccess: () => utils.league.divisionMessages.invalidate({ divisionId }) });

  const submit = () => {
    const body = draft.trim();
    if (!body || post.isPending) return;
    post.mutate({ divisionId, body });
  };

  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="border-b border-border bg-accent/40 px-5 py-4"><p className="section-kicker flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" /> {divisionName}</p><h2 className="mt-1 font-display text-xl font-extrabold tracking-tight">Talk trash</h2></div>
    {canPost ? <div className="flex items-center gap-2 border-b border-border p-4"><input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} maxLength={500} placeholder="Say something to your division..." className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary" /><Button onClick={submit} disabled={!draft.trim() || post.isPending} size="sm">Post</Button></div> : null}
    {messages.data?.length ? <div className="max-h-[420px] divide-y divide-border/70 overflow-y-auto">{messages.data.map(message => <div key={message.id} className="flex items-start gap-3 px-5 py-3.5">
      <TeamLogo logoUrl={message.logoUrl} teamName={message.teamName} size="sm" />
      <div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><p className="truncate text-sm font-bold">{message.teamName}</p><p className="shrink-0 text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</p></div><p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{message.body}</p></div>
      {isCommissioner ? <button onClick={() => remove.mutate({ messageId: message.id })} className="shrink-0 text-muted-foreground transition-colors hover:text-destructive" aria-label="Delete message"><Trash2 className="h-3.5 w-3.5" /></button> : null}
    </div>)}</div> : <div className="p-8 text-sm text-muted-foreground">No messages yet. {canPost ? "Be the first to talk some trash." : ""}</div>}
  </section>;
}
