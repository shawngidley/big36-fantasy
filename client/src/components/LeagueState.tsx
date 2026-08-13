import { CircleAlert, LoaderCircle } from "lucide-react";

export function LeagueLoading() {
  return <div className="container grid min-h-[44vh] place-items-center"><div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading the league ledger</div></div>;
}

export function LeagueError({ message }: { message?: string }) {
  return <div className="container"><div className="my-12 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{message ?? "The league data could not be loaded. Please try again."}</p></div></div>;
}

export function EmptyLedger({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"><p className="font-display text-lg font-bold tracking-tight">{title}</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p></div>;
}
