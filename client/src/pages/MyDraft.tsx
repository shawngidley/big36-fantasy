import { useState } from "react";
import { CheckCircle2, CircleDashed, LockKeyhole, LogIn, Send, TimerReset } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const labelFor = (position: string) => position === "DEF_ST" ? "DEF/ST" : position;

export default function MyDraft() {
  const { user, loading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.league.myDraft.useQuery(undefined, { enabled: isAuthenticated });
  const [schoolName, setSchoolName] = useState("");
  const pick = trpc.league.submitMyPick.useMutation({
    onSuccess: result => {
      toast.success(`Your selection was recorded at draft position ${result?.draftPosition}.`);
      utils.league.myDraft.invalidate();
      utils.league.snapshot.invalidate();
      setSchoolName("");
    },
    onError: error => toast.error(error.message),
  });

  if (loading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (!isAuthenticated) return <LeagueShell eyebrow="Owner draft portal"><section className="container py-14 sm:py-20"><div className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm"><LockKeyhole className="mx-auto h-7 w-7 text-primary" /><p className="section-kicker mt-5">Owners only</p><h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Make your own selection.</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Sign in with the same email the commissioner used when creating your Big 36 team. Your account will be matched to that team automatically.</p><Button className="mt-7" onClick={() => startLogin()}><LogIn className="mr-2 h-4 w-4" /> Sign in to draft</Button></div></section></LeagueShell>;
  if (mine.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (mine.error || !mine.data) return <LeagueShell><LeagueError message={mine.error?.message} /></LeagueShell>;
  const data = mine.data;
  if (!data.owner) return <LeagueShell eyebrow="Owner draft portal"><section className="container py-14"><EmptyLedger title="Your team is not linked yet" detail={`Ask the commissioner to add ${user?.email ?? "your sign-in email"} to your owner record. Once the email matches, your Big 36 draft page unlocks automatically.`} /></section></LeagueShell>;
  const owner = data.owner;
  const activeLabel = data.draftState.activePosition ? labelFor(data.draftState.activePosition) : "No position";

  return <LeagueShell eyebrow="Owner draft portal"><section className="container py-9 sm:py-12"><div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between"><div><p className="section-kicker">Your Big 36 team</p><h1 className="display-title mt-3">{owner.teamName}</h1><p className="mt-2 text-sm text-muted-foreground">{owner.displayName} · Draft your school-position groups when your turn arrives.</p></div><div className="rounded-2xl border border-primary/15 bg-primary/5 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Live round</p><p className="mt-1 font-display text-xl font-extrabold">{activeLabel}</p><p className="mt-1 text-xs text-muted-foreground">{data.draftState.status}</p></div></div><div className="mt-8 grid gap-6 lg:grid-cols-[.9fr_1.1fr]"><section className={data.canPick ? "rounded-2xl border border-primary/25 bg-primary/5 p-6" : "rounded-2xl border border-border bg-card p-6"}><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">Your turn status</p><h2 className="mt-2 font-display text-2xl font-extrabold">{data.canPick ? "You are on the clock" : "Waiting for your turn"}</h2></div>{data.canPick ? <TimerReset className="h-6 w-6 text-primary" /> : <CircleDashed className="h-6 w-6 text-muted-foreground" />}</div>{data.canPick && data.draftState.activePosition ? <form className="mt-6 grid gap-3" onSubmit={event => { event.preventDefault(); pick.mutate({ position: data.draftState.activePosition!, schoolName }); }}><label className="text-sm font-bold">Your {activeLabel} school</label><Input autoFocus placeholder="e.g., Ohio State" value={schoolName} onChange={event => setSchoolName(event.target.value)} required /><Button type="submit" disabled={pick.isPending}><Send className="mr-2 h-4 w-4" /> Submit my selection</Button><p className="text-xs leading-5 text-muted-foreground">This commits the school-position group to your team and makes it unavailable to everyone else.</p></form> : <div className="mt-6 rounded-xl border border-border bg-background/60 p-4 text-sm leading-6 text-muted-foreground">{data.draftState.status !== "OPEN" ? "The commissioner has not opened a draft round yet." : `${data.draftState.currentTurn?.teamName ?? "Another team"} holds the current ${activeLabel} selection.`}</div>}</section><section className="rounded-2xl border border-border bg-card p-6"><p className="section-kicker">Your six slots</p><h2 className="mt-2 font-display text-2xl font-extrabold">Draft card</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{["QB", "RB", "WR", "TE", "DEF_ST", "FLEX"].map(position => { const assignment = owner.assignments.find(slot => slot.position === position); const selection = owner.picks.find(pick => pick.position === position); return <div key={position} className="flex items-center justify-between rounded-xl border border-border px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{labelFor(position)}</p><p className="mt-1 font-semibold">{selection?.schoolName ?? "Awaiting selection"}</p></div><div className="text-right">{selection ? <CheckCircle2 className="ml-auto h-4 w-4 text-primary" /> : null}<p className="mt-1 text-xs text-muted-foreground">Slot {assignment?.draftPosition ?? "—"}</p></div></div>})}</div></section></div></section></LeagueShell>;
}
