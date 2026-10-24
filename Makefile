.PHONY: db migrate seed api mobile web test-api test-mobile test-integration check

db:
	docker compose up -d db

migrate:
	cd apps/api && go run ./cmd/migrate

seed:
	cd apps/api && go run ./cmd/seed

api:
	cd apps/api && go run ./cmd/server

mobile:
	cd apps/mobile && npm start

web:
	cd apps/mobile && npx expo export --platform web

test-api:
	cd apps/api && go test -race ./... && go vet ./...

test-mobile:
	cd apps/mobile && npm run typecheck && npm run lint && npm test -- --runInBand

test-integration:
	python3 tests/integration/run.py
	python3 tests/integration/phone.py
	python3 tests/integration/dashboard.py

check: test-api test-mobile web
