import { Link } from "wouter";
import LeagueShell from "@/components/LeagueShell";
import { OwnerSignInForm } from "@/components/OwnerSignInForm";
import { Button } from "@/components/ui/button";

export default function OwnerSignIn() {
  return <LeagueShell eyebrow="Owner access · inaugural season"><section className="container py-14 sm:py-20"><div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.05fr_.95fr]"><div className="rounded-3xl bg-[#17120e] p-8 text-[#f6f0e7] shadow-xl sm:p-10"><p className="section-kicker text-primary">36 Football owner access</p><h1 className="mt-4 font-display text-5xl font-extrabold tracking-tight">Welcome back to your program.</h1><p className="mt-5 max-w-xl text-sm leading-7 text-[#f6f0e7]/75">Sign in with the email and PIN from your approved 36 Football registration. Your secure league session stays active on this device, so you do not need to enter your PIN each visit.</p></div><div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"><p className="section-kicker">Sign in</p><h2 className="mt-3 font-display text-3xl font-extrabold">Your team is waiting.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Your program must be approved and assigned by a commissioner before owner access opens.</p><OwnerSignInForm /><div className="mt-6 border-t border-border pt-5"><p className="text-sm text-muted-foreground">New to the league?</p><Link href="/join"><Button variant="outline" className="mt-3">Create your program</Button></Link></div></div></div></section></LeagueShell>;
}
