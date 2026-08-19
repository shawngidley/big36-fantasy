import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OwnerSignInForm({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const utils = trpc.useUtils();
  const login = trpc.auth.ownerLogin.useMutation({ onSuccess: async () => { await utils.auth.me.invalidate(); navigate("/my-draft"); } });
  const submit = (event: FormEvent) => { event.preventDefault(); login.mutate({ email, pin }); };
  return <form onSubmit={submit} className={compact ? "space-y-4" : "mt-7 space-y-4"}><div className="space-y-2"><Label htmlFor="owner-login-email">Email</Label><Input id="owner-login-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="owner-login-pin">Your 36 Football PIN</Label><Input id="owner-login-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={event => setPin(event.target.value)} required /></div>{login.error ? <p className="text-sm font-medium text-destructive">The email, PIN, or approved program is not recognized.</p> : null}<Button className="w-full" type="submit" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in to your program"}</Button></form>;
}
