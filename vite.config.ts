import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, type ViteDevServer } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readFile } from "node:fs/promises";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "vinext/server/app-router-entry",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      {
        name: "private-local-reference",
        apply: "serve",
        configureServer(server: ViteDevServer) {
          server.middlewares.use(
            "/__local-reference.json",
            async (req, res) => {
              // Dev-only, loopback-only. No private data is included in builds.
              const address = req.socket.remoteAddress;
              if (
                !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
                  address || "",
                )
              ) {
                res.statusCode = 403;
                res.end();
                return;
              }
              try {
                const json = await readFile(
                  new URL("./work/reference.json", import.meta.url),
                  "utf8",
                );
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(req.method === "HEAD" ? undefined : json);
              } catch {
                res.statusCode = 404;
                res.end();
              }
            },
          );
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
