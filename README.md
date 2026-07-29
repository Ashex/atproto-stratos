# Northsky AppView

This repository is a fork of [Blacksky's](https://blacksky.community) AppView fork of `bluesky-social/atproto`, with additional Northsky-specific changes layered on top. It powers the AppView layer and query surface for Stratos-backed private feeds.

This repo is published for transparency. It is not the canonical upstream and is not accepting outside issues or pull requests. For the base project, use `bluesky-social/atproto`.

## What Is Different Here

The active Northsky changes are concentrated in:

- `packages/bsky/` for AppView runtime behavior,
- `services/bsky/` for service packaging,
- `lexicons/zone/stratos/` for Stratos lexicons.


## Stratos Integration

This AppView does not ingest Stratos commits in-process anymore. The current split is:

- `stratos/stratos-indexer` performs Stratos ingestion and writes `stratos_*` rows into PostgreSQL.
- this repo reads those tables and exposes `zone.stratos.feed.*` endpoints.
- `packages/bsky/src/stratos/enrollment-manager.ts` refreshes viewer enrollment data from Stratos when needed.

For the implementation details, see `docs/stratos-integration.md`.

### Code Added for Stratos

| Location | Purpose |
| --- | --- |
| `packages/bsky/src/stratos/store.ts` | Query layer over `stratos_post`, `stratos_post_boundary`, and `stratos_enrollment` |
| `packages/bsky/src/stratos/enrollment-manager.ts` | Boundary lookup, caching, and enrollment refresh |
| `packages/bsky/src/api/zone/stratos/feed/` | `getTimeline`, `getAuthorFeed`, and `getPost` handlers |
| `packages/bsky/src/auth-verifier.ts` | DPoP-aware auth changes used by Stratos clients |
| `lexicons/zone/stratos/` | Stratos record and feed lexicons |

### Removed or Replaced

- legacy `community.blacksky.feed.*` routes,
- the old `community_post` storage path,
- the older community-membership dependency surface.

## Runtime Architecture

```text
relay/indexers -> PostgreSQL <- stratos-indexer
                         |
                         v
                 bsky-dataplane
                         |
                         v
                   bsky-appview
                         |
                         +-> app.bsky.*
                         +-> zone.stratos.feed.*
```

The Stratos-specific tables used by this repo are:

- `stratos_post`
- `stratos_post_boundary`
- `stratos_enrollment`
- `stratos_sync_cursor`

## Development

### Install and build

```bash
pnpm install
pnpm build
```

### Test

```bash
pnpm test
```

### AppView configuration relevant to Stratos

| Variable | Description |
| --- | --- |
| `STRATOS_SERVICE_URL` | Base URL of the Stratos service |
| `STRATOS_SERVICE_DID` | DID of the Stratos service |
| `DB_URL` | Postgres URL for the Stratos query tables |
| `DB_SCHEMA` | Schema name for Stratos tables, defaults to `bsky` |
| `STRATOS_DB_POOL_SIZE` | Pool size for the Stratos-side Kysely connection |

`STRATOS_SYNC_ENABLED` is still parsed in config for compatibility, but the current AppView runtime does not start an in-process Stratos sync worker. Real-time syncing is handled by `stratos/stratos-indexer`.

### Service entrypoints

```bash
node services/bsky/dataplane.js
node services/bsky/api.js
```

## Syncing With Upstream

```bash
git remote add upstream https://github.com/bluesky-social/atproto.git
git fetch upstream
git merge upstream/main
```

Most conflicts land in `packages/bsky/src/api/`, `packages/bsky/src/stratos/`, or AppView data-plane routes.

## License

Same as upstream: dual-licensed under MIT and Apache 2.0.
