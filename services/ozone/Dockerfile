FROM node:18-alpine AS build

RUN corepack enable

WORKDIR /app

COPY ./package.json ./
RUN corepack prepare --activate

# Move files into the image and install
COPY ./*.* ./
COPY ./tsconfig ./tsconfig
COPY ./lexicons ./lexicons
COPY ./packages/lex/lex-cbor ./packages/lex/lex-cbor
COPY ./packages/lex/lex-data ./packages/lex/lex-data
COPY ./packages/lex/lex-json ./packages/lex/lex-json

# NOTE: keep this list aligned with @atproto/aws and @atproto/ozone runtime dependencies.
COPY ./packages/api ./packages/api
COPY ./packages/aws ./packages/aws
COPY ./packages/common ./packages/common
COPY ./packages/common-web ./packages/common-web
COPY ./packages/crypto ./packages/crypto
COPY ./packages/identity ./packages/identity
COPY ./packages/lexicon ./packages/lexicon
COPY ./packages/ozone ./packages/ozone
COPY ./packages/repo ./packages/repo
COPY ./packages/syntax ./packages/syntax
COPY ./packages/ws-client ./packages/ws-client
COPY ./packages/xrpc ./packages/xrpc
COPY ./packages/xrpc-server ./packages/xrpc-server

COPY ./services/ozone ./services/ozone

RUN node -e "const fs=require('fs'),path=require('path');const stripWsDev=(file)=>{if(!fs.existsSync(file))return;const pkg=JSON.parse(fs.readFileSync(file,'utf8'));const dd=pkg.devDependencies;if(dd){for(const k of Object.keys(dd)){if(dd[k].startsWith('workspace:'))delete dd[k];}}fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');};const walk=(dir)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())walk(path.join(dir,e.name));else if(e.name==='package.json')stripWsDev(path.join(dir,e.name));}};stripWsDev('package.json');walk('packages');walk('services');"

# install all deps
RUN pnpm install --no-frozen-lockfile
# build all packages with external node_modules
RUN pnpm run --recursive --stream --filter '@atproto/aws...' --filter '@atproto/ozone...' build
# clean up
RUN rm -rf node_modules
# install only prod deps, hoisted to root node_modules dir
RUN pnpm install --prod --shamefully-hoist --no-frozen-lockfile --prefer-offline

WORKDIR /app/services/ozone

# Uses assets from build stage to reduce build size
FROM node:18-alpine

RUN apk add --update dumb-init

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/ozone
COPY --from=build /app /app

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
USER node
CMD ["node", "--enable-source-maps", "api.js"]

LABEL org.opencontainers.image.source=https://github.com/bluesky-social/atproto
LABEL org.opencontainers.image.description="Ozone"
LABEL org.opencontainers.image.licenses=MIT
