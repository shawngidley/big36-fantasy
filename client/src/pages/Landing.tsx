import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import JoinLeague from "./JoinLeague";

export default function Landing() {
  const [, navigate] = useLocation();
  const registrationStatus = trpc.league.registrationLanding.useQuery();

  useEffect(() => {
    if (registrationStatus.data && !registrationStatus.data.registrationOpen) navigate("/standings", { replace: true });
  }, [navigate, registrationStatus.data]);

  return <JoinLeague />;
}
