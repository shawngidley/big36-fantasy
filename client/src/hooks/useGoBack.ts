import { useCallback } from "react";
import { useLocation } from "wouter";

// "Back" should always return to wherever the person actually came from, not a hardcoded
// destination — but if the page was opened directly (a shared link, a new tab), there's no history
// to go back to, so it falls back to a sensible default destination instead.
export function useGoBack(fallback: string) {
  const [, navigate] = useLocation();
  return useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate(fallback);
  }, [fallback, navigate]);
}
