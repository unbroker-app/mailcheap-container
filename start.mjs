// Waits for MongoDB before starting MailCheap. Upstream's lib/db.js keeps the
// first connection attempt for the life of the process, so a database that
// isn't accepting connections yet at that moment (one starting next to the app)
// would leave every page failing until the container restarted. /api/health
// doesn't touch the database, so nothing would restart it.
import { connect } from "node:net";

const WAIT_SECONDS = Number(process.env.MONGODB_WAIT_SECONDS || 120);

function target(uri) {
  if (!uri || uri.startsWith("mongodb+srv:")) return null; // SRV: DNS finds the hosts, the driver retries
  try {
    const { hostname, port } = new URL(uri.replace(/,[^/]*/, "")); // first host of a seed list
    return hostname ? { host: hostname.replace(/^\[|\]$/g, ""), port: Number(port) || 27017 } : null;
  } catch {
    return null;
  }
}

const reachable = ({ host, port }) =>
  new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 3000 });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

const db = target(process.env.MONGODB_URI);
if (db) {
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  for (let i = 1; !(await reachable(db)); i++) {
    if (secs() >= WAIT_SECONDS) {
      console.error(`MongoDB at ${db.host}:${db.port} did not accept connections within ${WAIT_SECONDS}s. Check MONGODB_URI.`);
      process.exit(1);
    }
    if (i % 10 === 0) console.log(`Still waiting for MongoDB at ${db.host}:${db.port} (${secs()}s)...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (secs() > 0) console.log(`MongoDB ready after ${secs()}s`);
}

await import("./server.js");
