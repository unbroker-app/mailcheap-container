ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
# MailCheap's source, pinned to one upstream commit. Update MAILCHEAP_COMMIT on purpose.
ARG MAILCHEAP_COMMIT=9bb4674ca8a3ea40aef9baa97590cef4f840cbbb
ADD https://github.com/marclou/mailcheap/archive/${MAILCHEAP_COMMIT}.tar.gz /tmp/mailcheap.tar.gz
RUN tar -xzf /tmp/mailcheap.tar.gz --strip-components=1 && rm /tmp/mailcheap.tar.gz
RUN npm ci --no-audit --no-fund
# Upstream deploys to Vercel. A standalone build is a small server.js with only the
# node_modules it traces, so the container runs it without npm or the dev dependencies.
RUN sed -i 's/^\tpoweredByHeader: false,$/\toutput: "standalone",\n&/' next.config.mjs \
    && grep -q 'output: "standalone"' next.config.mjs
# Pages read APP_URL at build time (docs, robots, sitemap, llms.txt). The real URL
# is only known at deploy time and is read at runtime everywhere else.
ENV NEXT_TELEMETRY_DISABLED=1 \
    APP_URL=http://localhost:3000
RUN npm run build

FROM ${NODE_IMAGE}
ARG MAILCHEAP_COMMIT=9bb4674ca8a3ea40aef9baa97590cef4f840cbbb
LABEL org.opencontainers.image.source="https://github.com/unbroker-app/mailcheap-container" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.revision="${MAILCHEAP_COMMIT}" \
      org.opencontainers.image.description="MailCheap newsletter app for Unbroker Cloud"
WORKDIR /app
COPY --from=build /src/LICENSE ./LICENSE
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY start.mjs ./start.mjs
# Next.js writes regenerated archive pages (ISR) and its image cache under .next.
RUN chown -R 10001:10001 /app/.next
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
USER 10001:10001
EXPOSE 3000
CMD ["node", "start.mjs"]
