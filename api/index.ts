import type { IncomingMessage, ServerResponse } from "http";

// `dist/index.js` is the esbuild-bundled server (built by `pnpm build`, which
// Vercel's buildCommand runs before this function is packaged). Importing the
// bundle instead of the TS source avoids Vercel's per-file Node function
// builder trying to resolve this repo's extensionless relative imports under
// strict Node ESM resolution.
let appPromise: Promise<{ app: (req: IncomingMessage, res: ServerResponse) => void }> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = import("../dist/index.js").then((mod: any) => mod.createApp());
  }
  const { app } = await appPromise;
  app(req, res);
}
