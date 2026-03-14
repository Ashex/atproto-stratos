# Northsky AppView

This is [Blacksky's](https://blacksky.community) fork of the [AT Protocol reference implementation](https://github.com/bluesky-social/atproto) by Bluesky Social PBC. It powers the AppView at `api.blacksky.community` and provides first-class integration with [Stratos](../stratos/), a private permissioned data service for ATProtocol.

We're publishing this for transparency and so other communities can benefit from the work. **This repository is not accepting contributions, issues, or PRs.** If you want the canonical atproto implementation, use [bluesky-social/atproto](https://github.com/bluesky-social/atproto).

## What's Different

All changes are in `packages/bsky` (appview logic), `services/bsky` (runtime config), `lexicons/zone/stratos/` (Stratos lexicons), and `infra/` (CDK deployment). Everything else is upstream.

### Stratos Integration

The AppView indexes private, boundary-scoped records from a [Stratos](../stratos/) service and serves them through XRPC feed endpoints. This replaces the previous `community.blacksky.feed.*` system with a standards-based ATProtocol approach.

For a full technical walkthrough, see [docs/stratos-integration.md](./docs/stratos-integration.md).

**What it adds:**

- **Real-time indexer** (`packages/bsky/src/stratos/indexer.ts`) — Connects to Stratos via per-actor WebSocket subscriptions, decodes CBOR-framed commit events, and writes records to PostgreSQL
- **Enrollment manager** (`packages/bsky/src/stratos/enrollment-manager.ts`) — Discovers enrolled users from Stratos, fetches their boundaries, and subscribes new actors to the indexer
- **Boundary-aware feed endpoints** — Three new `zone.stratos.feed.*` XRPC endpoints (getTimeline, getAuthorFeed, getPost) that filter records by the viewer's boundaries
- **DPoP authentication** (`packages/bsky/src/auth-verifier.ts`) — Direct DPoP-bound OAuth token verification so webapp clients can authenticate without proxying through a PDS
- **Custom lexicons** (`lexicons/zone/stratos/`) — Record types, boundary definitions, and feed query/procedure schemas
- **Database schema** — Four new tables (`stratos_post`, `stratos_post_boundary`, `stratos_enrollment`, `stratos_sync_cursor`) via Kysely migration
- **CDK infrastructure** (`infra/src/appview-stack.ts`) — AWS deployment stack for the AppView with RDS, ECS, and Stratos connectivity

**What it removes:**

- `community.blacksky.feed.*` lexicons and endpoints (replaced by `zone.stratos.feed.*`)
- `community_post` table and migration
- Membership database dependency (`BLACKSKY_MEMBERSHIP_DB_URL`)
- Community post integration in `getPostThreadV2`
- Protobuf service definitions for community routes

### Why Not the Built-in Firehose Consumer?

The upstream dataplane includes a TypeScript firehose consumer (`subscription.ts`) that indexes events directly. We replaced it with [rsky-wintermute](https://github.com/blacksky-algorithms/rsky), a Rust indexer, for several reasons:

- **Performance at scale**: The TypeScript consumer processes events sequentially. At network scale (~1,000 events/second, 18.5 billion total records), a full backfill at ~90 records/sec would take 6.5 years. Wintermute targets 10,000+ records/sec with parallel queue processing.
- **Backfill architecture**: Wintermute separates live indexing from backfill into independent queues (firehose_live, firehose_backfill, repo_backfill, labels). Live events are never blocked by backfill work.
- **Operational tooling**: Wintermute includes utilities for direct indexing of specific accounts, PLC directory bulk import, label stream replay, blob reference repair, and queue management -- all needed when bootstrapping an AppView from scratch.

The dataplane and appview from this repo still run as-is. They read from the PostgreSQL database that wintermute writes to. We just don't start the built-in firehose subscription.

### Performance & Operational Fixes

These are broadly useful to anyone self-hosting an AppView at scale.

**LATERAL JOIN query optimization** (`packages/bsky/src/data-plane/server/routes/feeds.ts`)
- `getTimeline` and `getListFeed` rewritten with PostgreSQL LATERAL JOINs to force per-user index usage instead of full table scans. Major improvement for users following thousands of accounts.

**Redis caching layer** (`packages/bsky/src/data-plane/server/cache/`)
- Actor profiles (60s TTL), records (5m), interaction counts (30s), post metadata (5m)
- Reduces database load under production traffic
- **Known issue**: The actor cache has a protobuf timestamp serialization bug where `Timestamp` objects lose their `.toDate()` method after JSON round-tripping through Redis, causing incomplete profile hydration on cache hits. We currently run with Redis caching disabled. The fix is to serialize timestamps as ISO strings on cache write and reconstruct on read.

**Notification preferences server-side enforcement** (`packages/bsky/src/api/app/bsky/notification/listNotifications.ts`)
- When the client doesn't specify `reasons`, the server applies the user's saved notification preferences. Without this, preferences are only enforced client-side and have no effect.

**Auth verifier stale signing key fix** (`packages/bsky/src/auth-verifier.ts`)
- On JWT verification retry (`forceRefresh`), bypasses the dataplane's in-memory identity cache and resolves the DID document directly from PLC directory. Fixes authentication failures after account migration where the signing key rotates but the cache holds the old key.

**JSON sanitization** (`packages/bsky/src/data-plane/server/routes/records.ts`)
- Strips null bytes (`\u0000`) and control characters from stored records before JSON parsing. These are valid per RFC 8259 but rejected by Node.js `JSON.parse()`, causing silent `rowToRecord` parse failures in the dataplane that surface as missing posts.

## Architecture

```
Bluesky Relay (bsky.network)
     |
     v
rsky-wintermute -----> PostgreSQL 17 <----- Palomar
  (Rust indexer)            |                (Go search)
  - firehose consumer       |                     |
  - backfiller              |                     v
  - label indexer           |               OpenSearch
  - direct indexer          |
                            v
                    bsky-dataplane (gRPC :2585) <--- Redis (optional)
                            |
                            v
                    bsky-appview (HTTP :2584) <--- Stratos Service (WebSocket)
                            |                       |
                            v                       v
                    Reverse proxy            stratos_post
                    (Caddy/nginx)            stratos_enrollment
                                             stratos_sync_cursor
```

### Component Overview

| Component | Source | Purpose |
|-----------|--------|---------|
| **rsky-wintermute** | [blacksky-algorithms/rsky](https://github.com/blacksky-algorithms/rsky) | Rust firehose indexer: consumes events, backfills repos, indexes records into PostgreSQL |
| **rsky-relay** | [blacksky-algorithms/rsky](https://github.com/blacksky-algorithms/rsky) | AT Protocol relay for receiving moderation labels from labeler services |
| **rsky-video** | [blacksky-algorithms/rsky](https://github.com/blacksky-algorithms/rsky) | Video upload service: transcodes via Bunny Stream CDN, uploads blob refs to user PDSes |
| **bsky-dataplane** | This repo (`services/bsky`) | gRPC data layer over PostgreSQL |
| **bsky-appview** | This repo (`services/bsky`) | HTTP API server for `app.bsky.*` and `zone.stratos.*` XRPC endpoints |
| **Stratos** | [stratos](../stratos/) | Private permissioned data service — stores boundary-scoped records, serves them via WebSocket subscription |
| **Palomar** | [blacksky-algorithms/indigo](https://github.com/blacksky-algorithms/indigo) | Full-text search: indexes profiles and posts into OpenSearch with follower count boosting |
| **palomar-sync** | [blacksky-algorithms/rsky](https://github.com/blacksky-algorithms/rsky) | Syncs follower counts and PageRank scores from PostgreSQL to OpenSearch |

### rsky-wintermute in Detail

Wintermute is a monolithic Rust service with four parallel processing paths:

- **Ingester**: Connects to `bsky.network` firehose via WebSocket, writes events to Fjall (embedded key-value store) queues
- **Indexer**: Reads from queues, parses records, writes to PostgreSQL with `ON CONFLICT` for idempotency
- **Backfiller**: Fetches full repo CAR files from PDSes, unpacks records into the backfill queue
- **Label indexer**: Subscribes to labeler WebSocket streams, processes label create/negate events

Additional CLI tools included in the rsky repo:
- `queue_backfill` -- queue DIDs for backfill from CSV, PDS discovery, or direct DID lists
- `direct_index` -- fetch and index specific repos bypassing queues (useful for fixing individual accounts)
- `label_sync` -- replay label streams from cursor 0 to catch up on missed negations
- `plc_import` -- bulk import handle/DID mappings from PLC directory
- `palomar-sync` -- sync follower counts and PageRank to OpenSearch

### rsky-video

Video upload service for users whose PDS doesn't support Bluesky's `video.bsky.app`. Uses its own DID (`did:web:video.blacksky.community`) to authenticate to user PDSes via service auth JWTs. Flow:

1. Client gets service auth token from PDS (audience: video service DID)
2. Client uploads video bytes to rsky-video
3. rsky-video generates a CID, uploads the blob to the user's PDS
4. Video forwarded to Bunny Stream CDN for transcoding
5. On completion, client creates the post referencing the blob -- PDS validates the blob exists

### Label Handling

Moderation labels come from labeler services (e.g., Bluesky's Ozone) via WebSocket subscription. Wintermute's ingester processes labels in a dedicated `label_live` queue (low volume, separate from the main firehose). The `label_sync` tool can replay a labeler's full stream to catch up on missed negations (label removals) without reinserting labels.

## Setup

### Prerequisites

- **Node.js 18+** and **pnpm** (for building the dataplane and appview)
- **PostgreSQL 17** with the `bsky` schema
- **Redis** (optional, for caching -- see known issue above)
- **rsky-wintermute** consuming the firehose and populating the database
- **OpenSearch** (if running Palomar search)

### Database

The `bsky` schema is created by the dataplane's migrations. On first run, the dataplane will apply all migrations automatically. Stratos-specific tables are added by `20260312T120000000Z-add-stratos-tables.ts`:

| Table | Purpose |
|-------|---------|
| `stratos_post` | Indexed Stratos posts with text, reply info, embeds, facets. `sortAt` is a stored generated column: `LEAST(createdAt, indexedAt)` |
| `stratos_post_boundary` | Many-to-many: maps post URIs to boundary strings |
| `stratos_enrollment` | Enrolled users with their Stratos service URL and cached boundaries |
| `stratos_sync_cursor` | Per-actor WebSocket subscription cursor tracking |

rsky-wintermute writes to this same schema. All its INSERT statements use `ON CONFLICT` so it's safe to run wintermute and the dataplane migrations in any order.

### Build

The Docker images use Node.js 24 (Alpine). The build copies only the packages needed by `@atproto/bsky` to reduce image size and avoid pulling in the full monorepo.

```bash
pnpm install
pnpm build
```

The `services/bsky/Dockerfile` also bundles the AWS RDS CA certificate for TLS connections to RDS PostgreSQL instances.

### Run the Dataplane

```bash
node services/bsky/dataplane.js
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PRIMARY_URL` | Yes | PostgreSQL connection string with `?options=-csearch_path%3Dbsky` |
| `DB_REPLICA_URL` | No | Read replica connection string |
| `BSKY_DATAPLANE_PORT` | No | gRPC port (default 2585) |
| `BSKY_REDIS_HOST` | No | Redis host:port for caching (currently recommended to leave disabled) |

### Run the AppView

```bash
node services/bsky/api.js
```

| Variable | Required | Description |
|----------|----------|-------------|
| `BSKY_APPVIEW_PORT` | No | HTTP port (default 2584) |
| `BSKY_DATAPLANE_URLS` | Yes | Comma-separated dataplane gRPC URLs |
| `BSKY_DID` | Yes | The AppView's DID (e.g. `did:web:api.example.com`) |
| `BSKY_MOD_SERVICE_DID` | Yes | Ozone moderation service DID |
| `BSKY_ADMIN_PASSWORDS` | Yes | Comma-separated admin passwords for basic auth |
| `STRATOS_SERVICE_URL` | No | Stratos service base URL (enables Stratos integration) |
| `STRATOS_SERVICE_DID` | No | Stratos service DID (required with `STRATOS_SERVICE_URL`) |
| `DB_URL` | No | PostgreSQL URL for Stratos tables (reuses the bsky database) |
| `DB_SCHEMA` | No | PostgreSQL schema for Stratos tables (default: `bsky`) |
| `STRATOS_SYNC_ENABLED` | No | Set to `true` to enable real-time WebSocket indexing from Stratos |

When `STRATOS_SERVICE_URL`, `STRATOS_SERVICE_DID`, and `DB_URL` are all set, the AppView starts the Stratos enrollment manager, creates the `stratos_*` tables via migration, and registers the `zone.stratos.feed.*` endpoints. Setting `STRATOS_SYNC_ENABLED=true` additionally starts the real-time indexer that connects to Stratos via WebSocket.

## Operating at Scale

### Backfill Timeline

A full-network backfill (all ~42M users, ~18.5B records) takes weeks even with wintermute's parallel processing. Expect:

- **Live indexing**: Keeps up in real-time from day one (~1,000 events/sec)
- **Full backfill**: 2-4 weeks at 10,000 records/sec depending on PDS responsiveness and network conditions
- **Partial backfill**: Hours to days for a subset of users (e.g., community members only)

During backfill, the AppView is functional but will show incomplete data for users that haven't been backfilled yet. Live events are indexed immediately regardless of backfill progress.

### Problems We Solved Getting Here

These are issues we encountered bootstrapping a full-network AppView. If you're doing the same, you'll likely hit some of these:

**COPY text format JSON corruption**: PostgreSQL's COPY text protocol treats backslash as an escape character. If your bulk loader doesn't escape backslashes in JSON strings, `\"` becomes `"` and you get silently corrupted records. The `record.json` column is type `text` (not `jsonb`), so PostgreSQL won't catch this. We found ~66,000 corrupted records and had to repair them by re-fetching from the public API.

**Null bytes in JSON**: Some AT Protocol records contain `\u0000` (null byte), which is valid JSON per RFC 8259 but rejected by Node.js `JSON.parse()`. The dataplane silently returns null for these records. Strip null bytes before writing to the database.

**Timestamp format sensitivity**: The dataplane expects timestamps with millisecond precision and `Z` suffix (`2026-01-12T19:45:23.307Z`). Nanosecond precision or timezone offset format (`+00:00`) causes subtle sorting and comparison issues.

**Notification table bloat**: Without a unique constraint on `(did, recordUri, reason)`, the notification table grows unbounded with duplicates. Ours reached 1.3 billion rows (663 GB) before we caught it. Adding `ON CONFLICT DO NOTHING` to INSERTs only helps if the unique index exists first, and creating the index requires deduplication of the existing data.

**Post embed tables**: The `post_embed_image` and `post_embed_video` tables aren't populated by default if your indexer doesn't handle them. Without these, the media filter on `getAuthorFeed` returns nothing. These need to be backfilled separately.

**Label negation ordering**: Label negation (removal) events reference the original label by source, URI, and value. If negations arrive before the original label (common during backfill), they're silently dropped. The `label_sync` tool replays the full stream to catch these.

**Fjall queue poisoning**: The Fjall embedded database (used for wintermute's queues) can enter a "poisoned" state after crashes, blocking all queue operations. The fix is to delete the queue database directory and restart -- wintermute will catch up from the relay's cursor (relays keep ~72 hours of history).

**TLS provider initialization**: Rust's `rustls` requires explicitly installing a crypto provider before any TLS connection. Without `rustls::crypto::aws_lc_rs::default_provider().install_default()` at startup, the first WebSocket connection to the firehose panics.

**Signing key rotation after account migration**: When users migrate between PDSes, their signing key changes. The dataplane caches identity data with a staleTTL of 1 hour. During that window, JWT verification fails for migrated users. The fix is to bypass the cache on verification retry and resolve directly from PLC directory.

## Resource Requirements

Based on running a full-network AppView (all ~42M users, ~18.5B records).

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 16 cores | 48+ cores |
| **RAM** | 64 GB | 256 GB |
| **Storage** | 10 TB NVMe | 28+ TB NVMe (RAID) |
| **PostgreSQL** | Dedicated, same machine or low-latency | Same machine recommended |
| **Network** | Sustained 100 Mbps | 1 Gbps+ |

**Storage breakdown** (approximate, full network):

| Table group | Size |
|-------------|------|
| Posts + records | ~3.5 TB |
| Likes | ~2 TB |
| Follows | ~500 GB |
| Notifications | ~600 GB |
| Indexes | ~4 TB |
| OpenSearch (Palomar) | ~500 GB |

For a smaller community running a partial AppView (indexing only community members), requirements scale roughly linearly with indexed accounts.

## Syncing with Upstream

```bash
git remote add upstream https://github.com/bluesky-social/atproto.git
git fetch upstream
git merge upstream/main
```

Conflicts will typically be in `packages/bsky/src/data-plane/server/routes/` and `packages/bsky/src/api/`. Resolve by keeping our additions alongside upstream changes.

## License

Same as upstream: dual-licensed under MIT and Apache 2.0. See [LICENSE-MIT.txt](./LICENSE-MIT.txt) and [LICENSE-APACHE.txt](./LICENSE-APACHE.txt).
