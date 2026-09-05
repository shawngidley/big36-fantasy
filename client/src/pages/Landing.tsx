import { useEffect } from "react";
import { useLocation } from "wouter";
import OwnerSignIn from "./OwnerSignIn";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export default function Landing() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const profile = trpc.league.myProfile.useQuery(undefined, { enabled: isAuthenticated, retry: false });

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    if (profile.data?.registration.ownerId) navigate("/live");
  }, [loading, isAuthenticated, profile.data, navigate]);

  return <OwnerSignIn />;
}
