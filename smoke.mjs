// Runs mailcheap:test the way Unbroker Cloud runs it (uid 10001, no
// capabilities, read-only root filesystem, HOME=/tmp, 512 MiB), started before
// its MongoDB so the wait in start.mjs is exercised, and checks that the key
// Better Auth keeps in MongoDB survives a restart.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const IMAGE = process.env.IMAGE || "mailcheap:test";
const NET = "mailcheap-smoke";
const DB = "mailcheap-smoke-db";
const APP = "mailcheap-smoke-app";
const BASE = "http://127.0.0.1:3999";
const password = randomBytes(18).toString("hex");

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const quiet = (...args) => spawnSync("docker", args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function ready() {
  const t0 = Date.now();
  while (Date.now() - t0 < 180_000) {
    const status = await get("/api/health").then((r) => r.status, () => 0);
    if (status === 200) return console.log(`Healthy in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    assert(docker("inspect", "-f", "{{.State.Running}}", APP) === "true", "the app container is running");
    await sleep(2000);
  }
  throw new Error("not healthy within 180 s");
}

function cleanup() {
  quiet("rm", "-f", APP, DB);
  quiet("network", "rm", NET);
}

let ok = false;
try {
  cleanup();
  docker("network", "create", NET);
  docker(
    "run", "-d", "--name", APP, "--network", NET, "-p", "127.0.0.1:3999:3000",
    "--user", "10001:10001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:size=256m,uid=10001,gid=10001,mode=1777",
    "--memory", "512m", "--memory-swap", "512m",
    "-e", "HOME=/tmp", "-e", "PORT=3000", "-e", "HOST=0.0.0.0",
    "-e", `MONGODB_URI=mongodb://root:${password}@${DB}:27017/mailcheap?authSource=admin`,
    "-e", `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}`,
    "-e", `SUPPRESSION_HASH_KEY=${randomBytes(32).toString("hex")}`,
    "-e", `APP_URL=${BASE}`,
    "-e", "ADMIN_EMAILS=admin@example.com",
    "-e", "EMAIL_FROM=MailCheap <login@example.com>",
    IMAGE,
  );
  await sleep(5000); // the app waits for a database that isn't there yet
  docker(
    "run", "-d", "--name", DB, "--network", NET,
    "-e", "MONGO_INITDB_ROOT_USERNAME=root", "-e", `MONGO_INITDB_ROOT_PASSWORD=${password}`,
    "mongo:7",
  );
  await ready();
  assert(docker("logs", APP).includes("MongoDB ready after"), "start.mjs waited for MongoDB");

  const signin = await get("/signin");
  assert(signin.status === 200 && signin.text.includes("MailCheap"), `sign-in page renders (got ${signin.status})`);
  const docs = await get("/docs");
  assert(docs.status === 200, `docs render (got ${docs.status})`);
  const first = await get("/api/auth/jwks");
  const kid = first.json?.keys?.[0]?.kid;
  assert(first.status === 200 && kid, `signing key created in MongoDB (got ${first.status}: ${first.text})`);

  docker("restart", DB, APP);
  await ready();
  const again = await get("/api/auth/jwks");
  assert(again.json?.keys?.some((k) => k.kid === kid), `signing key ${kid} survives a restart (got ${again.text})`);
  ok = true;
} catch (error) {
  console.error(error);
  const logs = spawnSync("docker", ["logs", "--tail", "200", APP], { encoding: "utf8" });
  console.error(`── logs: ${APP}\n${logs.stdout}${logs.stderr}`);
} finally {
  cleanup();
}
console.log(ok ? "✓ smoke test passed" : "✗ smoke test failed");
process.exit(ok ? 0 : 1);
