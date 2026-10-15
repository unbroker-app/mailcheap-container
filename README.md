# MailCheap container for Unbroker Cloud

Container packaging of [MailCheap](https://github.com/marclou/mailcheap), without
a fork. Upstream deploys to Vercel and publishes no image. The source is pinned
to upstream commit `9bb4674ca8a3ea40aef9baa97590cef4f840cbbb` (`MAILCHEAP_COMMIT`
in the [Dockerfile](Dockerfile)).

The build adds `output: "standalone"` to upstream's `next.config.mjs` and
changes nothing else. The image runs `node start.mjs` as uid/gid 10001 on port
3000 (`PORT` overrides it). `start.mjs` waits up to `MONGODB_WAIT_SECONDS` (120)
for MongoDB to accept connections, then starts Next.js. Upstream keeps its first
MongoDB connection attempt for the life of the process, so without the wait an
app that starts before its database never recovers, while `/api/health` keeps
answering 200.

Set the variables from upstream's
[self-hosting guide](https://github.com/marclou/mailcheap#environment-variables):
at least `MONGODB_URI`, `BETTER_AUTH_SECRET`, `SUPPRESSION_HASH_KEY`, `APP_URL`,
`ADMIN_EMAILS` and `EMAIL_FROM`. Nothing on disk needs to persist and no volume
is needed. The root filesystem can be read-only: regenerated archive pages then
stay in memory. Pages rendered at build time (docs, `robots.txt`,
`sitemap.xml`, `llms.txt`) show `http://localhost:3000` as the app URL, because
upstream reads `APP_URL` when it builds them. Everything else reads it at runtime.
512 MiB of memory is enough.

Build with `docker build -t mailcheap:test .`, then run `node smoke.mjs`. The
smoke test runs the image hardened (uid 10001, no capabilities, read-only root,
512 MiB), starts it before MongoDB, and checks that the signing key Better Auth
keeps in MongoDB is still there after a restart. CI publishes only after those
checks pass, as
`ghcr.io/unbroker-app/mailcheap-container:sha-<full-container-repository-commit>`.
The package must be public so templates can pull it anonymously. No floating
`latest` tag is published.

To update, change `MAILCHEAP_COMMIT`, run CI, then update the image tag in the
`mailcheap` template.

MailCheap is AGPL-3.0 licensed. The image contains the upstream license, and
its source is the pinned upstream commit. The packaging in this repository is
also AGPL-3.0 licensed.
