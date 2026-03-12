FROM node:24-alpine AS build

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
COPY ./packages/internal/xrpc-utils ./packages/internal/xrpc-utils
COPY ./packages/lex/lex-cbor ./packages/lex/lex-cbor
COPY ./packages/lex/lex-data ./packages/lex/lex-data
COPY ./packages/lex/lex-json ./packages/lex/lex-json

# NOTE: keep this list aligned with @atproto/bsky runtime dependencies.
COPY ./packages/api ./packages/api
COPY ./packages/bsky ./packages/bsky
COPY ./packages/common ./packages/common
COPY ./packages/common-web ./packages/common-web
COPY ./packages/crypto ./packages/crypto
COPY ./packages/did ./packages/did
COPY ./packages/identity ./packages/identity
COPY ./packages/lexicon ./packages/lexicon
COPY ./packages/repo ./packages/repo
COPY ./packages/sync ./packages/sync
COPY ./packages/syntax ./packages/syntax
COPY ./packages/ws-client ./packages/ws-client
COPY ./packages/xrpc ./packages/xrpc
COPY ./packages/xrpc-server ./packages/xrpc-server

COPY ./services/bsky ./services/bsky

RUN node -e "const fs=require('fs'),path=require('path');const stripWsDev=(file)=>{if(!fs.existsSync(file))return;const pkg=JSON.parse(fs.readFileSync(file,'utf8'));const dd=pkg.devDependencies;if(dd){for(const k of Object.keys(dd)){if(dd[k].startsWith('workspace:'))delete dd[k];}}fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');};const walk=(dir)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())walk(path.join(dir,e.name));else if(e.name==='package.json')stripWsDev(path.join(dir,e.name));}};stripWsDev('package.json');walk('packages');walk('services');"

# install all deps
RUN pnpm install --no-frozen-lockfile
# build all packages with external node_modules
RUN pnpm run --recursive --stream --filter '@atproto/crypto...' build
RUN pnpm run --recursive --stream --filter '@atproto/bsky...' build
# clean up
RUN rm -rf node_modules
# install only prod deps, hoisted to root node_modules dir
RUN pnpm install --prod --shamefully-hoist --no-frozen-lockfile --prefer-offline

WORKDIR /app/services/bsky

# Uses assets from build stage to reduce build size
FROM node:24-alpine

# dumb-init is used to handle signals properly.
# runit is installed so it can be (optionally) used for logging via svlogd.
RUN apk add --update dumb-init runit

ADD https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem /usr/local/share/rds-combined-ca-bundle.pem
RUN chmod 644 /usr/local/share/rds-combined-ca-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-combined-ca-bundle.pem


# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/bsky
COPY --from=build /app /app

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
USER node
CMD ["node", "--heapsnapshot-signal=SIGUSR2", "--enable-source-maps", "api.js"]

LABEL org.opencontainers.image.source=https://github.com/bluesky-social/atproto
LABEL org.opencontainers.image.description="Bsky App View"
LABEL org.opencontainers.image.licenses=MIT
