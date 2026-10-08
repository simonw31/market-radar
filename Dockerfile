FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

FROM dependencies AS worker
WORKDIR /app
ENV NODE_ENV=production
# Typst renders the tailored CV and cover letter PDFs locally (no external API).
# Works on x86_64 (most VPS) and arm64 (Raspberry Pi 5, Ampere, Apple silicon).
ARG TYPST_VERSION=0.13.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils fonts-inter fonts-crosextra-carlito \
  && case "$(uname -m)" in aarch64|arm64) arch=aarch64 ;; *) arch=x86_64 ;; esac \
  && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" \
    | tar -xJ -C /tmp \
  && mv "/tmp/typst-${arch}-unknown-linux-musl/typst" /usr/local/bin/typst \
  && rm -r "/tmp/typst-${arch}-unknown-linux-musl" \
  && rm -r /var/lib/apt/lists
# The static (musl) Typst build does not scan system fonts by itself.
ENV TYPST_FONT_PATHS=/usr/share/fonts
COPY . .
CMD ["npm", "run", "worker"]
