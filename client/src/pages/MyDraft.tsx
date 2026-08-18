import { useState } from "react";
import { CheckCircle2, CircleDashed, LockKeyhole, LogIn, Send, TimerReset } from "lucide-react";
import LeagueShell from "@/components/LeagueShell";
import { EmptyLedger, LeagueError, LeagueLoading } from "@/components/LeagueState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const positions = ["QB", "RB", "WR", "TE", "K_ST", "DEF"] as const;
const labelFor = (position: string) => position === "K_ST" ? "K/ST" : position;

export default function MyDraft() {
  const { user, loading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.league.myDraft.useQuery(undefined, { enabled: isAuthenticated });
  const [schoolName, setSchoolName] = useState("");
  const [position, setPosition] = useState<(typeof positions)[number]>("QB");
  const pick = trpc.league.submitMyPick.useMutation({
    onSuccess: result => { toast.success(`Your selection was recorded at pick ${result?.draftPosition}.`); utils.league.myDraft.invalidate(); utils.league.snapshot.invalidate(); setSchoolName(""); },
    onError: error => toast.error(error.message),
  });

  if (loading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (!isAuthenticated) return <LeagueShell eyebrow="Owner draft portal"><section className="container py-14 sm:py-20"><div className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm"><LockKeyhole className="mx-auto h-7 w-7 text-primary" /><p className="section-kicker mt-5">Programs only</p><h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Draft your six.</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Sign in with the email the commissioner used for your 36 Football program. Your account will be matched automatically.</p><Button className="mt-7" onClick={() => startLogin()}><LogIn className="mr-2 h-4 w-4" /> Sign in to draft</Button></div></section></LeagueShell>;
  if (mine.isLoading) return <LeagueShell><LeagueLoading /></LeagueShell>;
  if (mine.error || !mine.data) return <LeagueShell><LeagueError message={mine.error?.message} /></LeagueShell>;
  const data = mine.data;
  if (!data.owner) return <LeagueShell eyebrow="Owner draft portal"><section className="container py-14"><EmptyLedger title="Your program is not linked yet" detail={`Ask the commissioner to add ${user?.email ?? "your sign-in email"} to your owner record. Once it matches, your draft card unlocks automatically.`} /></section></LeagueShell>;
  const owner = data.owner;
  const currentTurn = data.draftState.currentTurn;
  const available = data.availablePositions.length ? data.availablePositions : positions.filter(item => !owner.picks.some(pick => pick.position === item));
  const selectedPosition = available.includes(position) ? position : available[0] ?? "QB";
  const deadline = currentTurn?.expiresAt ? new Date(currentTurn.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return <LeagueShell eyebrow="Owner draft portal"><section className="container py-9 sm:py-12"><div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between"><div><p className="section-kicker">Your 36 Football program</p><h1 className="display-title mt-3">{owner.teamName}</h1><p className="mt-2 text-sm text-muted-foreground">{owner.displayName} · Draft one school-position group on each of your six turns.</p></div><div className="rounded-2xl border border-primary/15 bg-primary/5 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Current pick</p><p className="mt-1 font-display text-xl font-extrabold">{currentTurn ? `#${currentTurn.draftPosition} · Round ${currentTurn.roundNumber}` : "Awaiting start"}</p><p className="mt-1 text-xs text-muted-foreground">{data.draftState.status}</p></div></div><div className="mt-8 grid gap-6 lg:grid-cols-[.9fr_1.1fr]"><section className={data.canPick ? "rounded-2xl border border-primary/25 bg-primary/5 p-6" : "rounded-2xl border border-border bg-card p-6"}><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">Your turn status</p><h2 className="mt-2 font-display text-2xl font-extrabold">{data.canPick ? data.skippedTurns.length ? "Make an available selection" : "You are on the clock" : "Waiting for your turn"}</h2></div>{data.canPick ? <TimerReset className="h-6 w-6 text-primary" /> : <CircleDashed className="h-6 w-6 text-muted-foreground" />}</div>{data.canPick && available.length ? <form className="mt-6 grid gap-3" onSubmit={event => { event.preventDefault(); pick.mutate({ position: selectedPosition, schoolName }); }}><Label>Roster group</Label><Select value={selectedPosition} onValueChange={value => setPosition(value as typeof position)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{available.map(item => <SelectItem key={item} value={item}>{labelFor(item)}</SelectItem>)}</SelectContent></Select><Label>Your {labelFor(selectedPosition)} school</Label><Input autoFocus placeholder="e.g., Ohio State" value={schoolName} onChange={event => setSchoolName(event.target.value)} required /><Button type="submit" disabled={pick.isPending}><Send className="mr-2 h-4 w-4" /> Submit selection</Button><p className="text-xs leading-5 text-muted-foreground">{data.skippedTurns.length ? `You have ${data.skippedTurns.length} missed selection${data.skippedTurns.length === 1 ? "" : "s"} available. You may use one now without stopping the active clock.` : `Your ten-minute clock ends at ${deadline ?? "the configured deadline"}.`}</p></form> : <div className="mt-6 rounded-xl border border-border bg-background/60 p-4 text-sm leading-6 text-muted-foreground">{data.draftState.status !== "OPEN" ? "The commissioner has not opened the serpentine draft yet." : `${currentTurn?.teamName ?? "Another program"} is currently on the clock${deadline ? ` until ${deadline}` : ""}.`}</div>}</section><section className="rounded-2xl border border-border bg-card p-6"><p className="section-kicker">Your six roster groups</p><h2 className="mt-2 font-display text-2xl font-extrabold">Draft card</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{positions.map(item => { const selection = owner.picks.find(pick => pick.position === item); return <div key={item} className="flex items-center justify-between rounded-xl border border-border px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{labelFor(item)}</p><p className="mt-1 font-semibold">{selection?.schoolName ?? "Available"}</p></div><div className="text-right">{selection ? <CheckCircle2 className="ml-auto h-4 w-4 text-primary" /> : null}<p className="mt-1 text-xs text-muted-foreground">{selection ? `Pick ${selection.draftPosition}` : "Unfilled"}</p></div></div>})}</div></section></div></section></LeagueShell>;
}
