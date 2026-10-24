# EXPO_PUBLIC_* values are public and are embedded into the exported bundle.
FROM node:24-alpine AS build
WORKDIR /src/apps/mobile
COPY apps/mobile/package.json apps/mobile/package-lock.json ./
RUN npm ci
COPY apps/mobile/ ./
ARG EXPO_PUBLIC_API_URL=/api/v1
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
RUN npm run export:web

FROM caddy:2-alpine AS runtime
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/mobile/dist/ /srv/
EXPOSE 80 443
