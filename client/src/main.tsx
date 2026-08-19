import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { startLogin } from "./const";
import "./index.css";

const queryClient = new QueryClient();

function suppressRuntimeAttributionBadge(root: ParentNode = document) {
  const hostingWatermark = document.querySelector("manus-content-root")?.shadowRoot?.querySelector<HTMLElement>("footer-watermark");
  if (hostingWatermark) {
    hostingWatermark.style.setProperty("display", "none", "important");
    hostingWatermark.style.setProperty("visibility", "hidden", "important");
    hostingWatermark.setAttribute("aria-hidden", "true");
  }
  const roots: ParentNode[] = [root];
  for (let index = 0; index < roots.length; index += 1) {
    const currentRoot = roots[index];
    const candidates = currentRoot instanceof Element ? [currentRoot, ...Array.from(currentRoot.querySelectorAll<HTMLElement>("*"))] : Array.from(currentRoot.querySelectorAll<HTMLElement>("*"));
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element.textContent?.trim().toLowerCase() !== "made with manus") continue;
      let target: HTMLElement = element;
      for (let depth = 0; depth < 4 && target.parentElement; depth += 1) {
        if (getComputedStyle(target).position === "fixed") break;
        target = target.parentElement;
      }
      target.style.setProperty("display", "none", "important");
      target.style.setProperty("visibility", "hidden", "important");
      target.setAttribute("aria-hidden", "true");
    }
  }
}

if (typeof window !== "undefined") {
  const observedRoots = new WeakSet<Node>();
  let observeRuntimeBadgeRoots: (root: ParentNode) => void;
  const observer = new MutationObserver(() => {
    suppressRuntimeAttributionBadge();
    observeRuntimeBadgeRoots(document);
  });
  observeRuntimeBadgeRoots = (root: ParentNode) => {
    if (!observedRoots.has(root)) {
      observedRoots.add(root);
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    }
    const descendants = root.querySelectorAll<HTMLElement>("*");
    descendants.forEach(element => { if (element.shadowRoot) observeRuntimeBadgeRoots(element.shadowRoot); });
  };
  suppressRuntimeAttributionBadge();
  observeRuntimeBadgeRoots(document);
  const retryId = window.setInterval(() => suppressRuntimeAttributionBadge(), 250);
  window.setTimeout(() => window.clearInterval(retryId), 10_000);
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;
  if (window.location.pathname.startsWith("/commissioner")) return;

  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Preview auto-login fallback: when the browser blocks iframe cookies
        // (Safari ITP / private browsing / WebView), the runtime mirrors the
        // session into sessionStorage so we can forward it as a Bearer token.
        // The regular OAuth cookie flow keeps working and takes priority server-side.
        try {
          const raw = sessionStorage.getItem("manus-cookie");
          if (raw) {
            const prefix = `${COOKIE_NAME}=`;
            const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
            const token = pair?.trim().slice(prefix.length);
            if (token) {
              return { Authorization: `Bearer ${token}` };
            }
          }
        } catch {
          // sessionStorage unavailable
        }
        return {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
