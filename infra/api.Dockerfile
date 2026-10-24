# Build from the repository root: docker build -f infra/api.Dockerfile .
FROM golang:1.26-alpine AS build
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates \
    && addgroup -S abonent && adduser -S -G abonent abonent
WORKDIR /app
COPY --from=build /out/ /app/
COPY db/migrations/ /app/db/migrations/
ENV HTTP_ADDR=:8080 \
    MIGRATIONS_DIR=/app/db/migrations
USER abonent
EXPOSE 8080
CMD ["/app/server"]
