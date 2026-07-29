# NOTE there is an additional build stage below that should match
FROM node:20.20-alpine3.23 AS build

RUN corepack enable

WORKDIR /app

COPY ./package.json ./
RUN corepack prepare --activate

# Move files into the image and install
COPY ./*.* ./
COPY ./tsconfig ./tsconfig
COPY ./lexicons ./lexicons
COPY ./packages/internal/fetch ./packages/internal/fetch
COPY ./packages/internal/fetch-node ./packages/internal/fetch-node
COPY ./packages/internal/pipe ./packages/internal/pipe
COPY ./packages/internal/simple-store ./packages/internal/simple-store
COPY ./packages/internal/simple-store-memory ./packages/internal/simple-store-memory
COPY ./packages/internal/simple-store-redis ./packages/internal/simple-store-redis
COPY ./packages/internal/xrpc-utils ./packages/internal/xrpc-utils
COPY ./packages/lex ./packages/lex

# NOTE: keep this list aligned with @atproto/pds runtime dependencies.
COPY ./packages/api ./packages/api
COPY ./packages/aws ./packages/aws
COPY ./packages/common ./packages/common
COPY ./packages/common-web ./packages/common-web
COPY ./packages/crypto ./packages/crypto
COPY ./packages/did ./packages/did
COPY ./packages/identity ./packages/identity
COPY ./packages/lexicon ./packages/lexicon
COPY ./packages/oauth/jwk ./packages/oauth/jwk
COPY ./packages/oauth/jwk-jose ./packages/oauth/jwk-jose
COPY ./packages/oauth/oauth-provider ./packages/oauth/oauth-provider
COPY ./packages/oauth/oauth-provider-api ./packages/oauth/oauth-provider-api
COPY ./packages/oauth/oauth-provider-frontend ./packages/oauth/oauth-provider-frontend
COPY ./packages/oauth/oauth-provider-ui ./packages/oauth/oauth-provider-ui
COPY ./packages/oauth/oauth-scopes ./packages/oauth/oauth-scopes
COPY ./packages/oauth/oauth-types ./packages/oauth/oauth-types
COPY ./packages/pds ./packages/pds
COPY ./packages/repo ./packages/repo
COPY ./packages/syntax ./packages/syntax
COPY ./packages/ws-client ./packages/ws-client
COPY ./packages/xrpc ./packages/xrpc
COPY ./packages/xrpc-server ./packages/xrpc-server

COPY ./services/pds ./services/pds

RUN node -e "const fs=require('fs'),path=require('path');const stripWsDev=(file)=>{if(!fs.existsSync(file))return;const pkg=JSON.parse(fs.readFileSync(file,'utf8'));const dd=pkg.devDependencies;if(dd){for(const k of Object.keys(dd)){if(dd[k].startsWith('workspace:'))delete dd[k];}}fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');};const walk=(dir)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())walk(path.join(dir,e.name));else if(e.name==='package.json')stripWsDev(path.join(dir,e.name));}};stripWsDev('package.json');walk('packages');walk('services');"

# install all deps
RUN pnpm install --no-frozen-lockfile
# build all packages with external node_modules
RUN pnpm run --recursive --stream --filter '@atproto/pds...' build
# clean up
RUN rm -rf node_modules
# install only prod deps, hoisted to root node_modules dir
RUN pnpm install --prod --shamefully-hoist --no-frozen-lockfile --prefer-offline

WORKDIR /app/services/pds

# Uses assets from build stage to reduce build size
FROM node:20.20-alpine3.23

RUN apk add --update dumb-init

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/pds
COPY --from=build /app /app
RUN mkdir /app/data && chown node /app/data

VOLUME /app/data
EXPOSE 3000
ENV PDS_PORT=3000
ENV NODE_ENV=production
# potential perf issues w/ io_uring on this version of node
ENV UV_USE_IO_URING=0

# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
USER node
CMD ["node", "--heapsnapshot-signal=SIGUSR2", "--enable-source-maps", "--require=./tracer.js", "index.js"]

LABEL org.opencontainers.image.source=https://github.com/bluesky-social/atproto
LABEL org.opencontainers.image.description="ATP Personal Data Server (PDS)"
LABEL org.opencontainers.image.licenses=MIT
