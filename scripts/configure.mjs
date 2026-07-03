import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...readDotEnv(resolve(root, ".env")), ...process.env };

const publicBaseUrl = withoutTrailingSlash(required("PUBLIC_BASE_URL"));
const larkAppId = required("LARK_APP_ID");
const d1DatabaseId = required("D1_DATABASE_ID");
const workerName = env.WORKER_NAME || "reading-block-api";
const d1DatabaseName = env.D1_DATABASE_NAME || "reading-block-prod";
const defaultTimeZone = env.DEFAULT_TIME_ZONE || "Asia/Shanghai";
const defaultScopes =
  "offline_access base:app:create base:table:create base:record:create base:record:update base:record:retrieve calendar:calendar:readonly calendar:calendar.free_busy:read calendar:calendar.event:create";

if (!/^https:\/\//i.test(publicBaseUrl)) {
  throw new Error("PUBLIC_BASE_URL must start with https://");
}

const wrangler = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: workerName,
  main: "worker/src/index.js",
  compatibility_date: "2026-07-03",
  workers_dev: true,
  vars: {
    APP_ENV: "production",
    PUBLIC_BASE_URL: publicBaseUrl,
    LARK_APP_ID: larkAppId,
    LARK_OAUTH_SCOPES: env.LARK_OAUTH_SCOPES || defaultScopes,
    DEFAULT_TIME_ZONE: defaultTimeZone,
    ...(env.LARK_OPEN_API_BASE ? { LARK_OPEN_API_BASE: env.LARK_OPEN_API_BASE } : {}),
    ...(env.LARK_AUTH_URL ? { LARK_AUTH_URL: env.LARK_AUTH_URL } : {}),
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
      migrations_dir: "worker/migrations",
    },
  ],
};

if (env.R2_BUCKET_NAME) {
  wrangler.r2_buckets = [{ binding: "DOWNLOADS", bucket_name: env.R2_BUCKET_NAME }];
}

writeFileSync(resolve(root, "wrangler.jsonc"), JSON.stringify(wrangler, null, 2) + "\n");

const manifestTemplate = readFileSync(resolve(root, "extension/manifest.template.json"), "utf8");
writeFileSync(
  resolve(root, "extension/manifest.json"),
  manifestTemplate.replaceAll("__PUBLIC_BASE_URL__", publicBaseUrl) + "\n"
);

mkdirSync(resolve(root, "extension/src/lib"), { recursive: true });
writeFileSync(
  resolve(root, "extension/src/lib/config.js"),
  `export const CLOUD_API_BASE = ${JSON.stringify(publicBaseUrl)};\n`
);

console.log("Generated wrangler.jsonc");
console.log("Generated extension/manifest.json");
console.log("Generated extension/src/lib/config.js");

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  return value;
}

function withoutTrailingSlash(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function readDotEnv(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (_) {
    return {};
  }
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return values;
}
