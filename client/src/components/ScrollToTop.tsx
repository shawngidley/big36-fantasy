import { useEffect } from "react";
import { useLocation } from "wouter";

export type ScrollWindow = Pick<Window, "scrollTo">;

export function resetPageScroll(target: ScrollWindow) {
  target.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    resetPageScroll(window);
  }, [location]);

  return null;
}
