# --- STAGE 1: Build the native Rust addon (Tantivy wrapped via napi-rs) ---
FROM rust:1-alpine AS rust-builder

# musl-dev is needed for the linker; nodejs+npm run the @napi-rs/cli
# tool that packages the cdylib as a .node addon.
RUN apk add --no-cache musl-dev nodejs npm make g++

WORKDIR /build/native
COPY native/package.json ./package.json
RUN npm install --no-audit --no-fund

COPY native/Cargo.toml ./Cargo.toml
COPY native/build.rs   ./build.rs
COPY native/src        ./src

# --platform embeds the target triple in the .node filename so the
# generated loader (index.js) resolves the right file at runtime.
RUN npx napi build --platform --release

# --- STAGE 2: Runtime Node.js image ---
FROM node:18-alpine

WORKDIR /app

RUN npm install express fs axios msgpackr

COPY . .

# Copy the compiled .node addon and its generated JS loader across.
COPY --from=rust-builder /build/native/*.node     ./native/
COPY --from=rust-builder /build/native/index.js   ./native/index.js
COPY --from=rust-builder /build/native/index.d.ts ./native/index.d.ts

RUN mkdir -p /data

RUN addgroup -g 1001 -S nodejs
RUN adduser -S searchnode -u 1001

RUN chown -R searchnode:nodejs /app /data
RUN mkdir -p /var/sockets && chown searchnode:nodejs /var/sockets && chmod 777 /var/sockets
USER searchnode

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

CMD ["node", "app.js"]
