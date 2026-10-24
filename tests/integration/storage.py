#!/usr/bin/env python3
"""Optional real PostgreSQL inspection for synthetic HTTP-created QA records.

Requires psql and DATABASE_URL pointing at the same development DB as BASE_URL.
Writes are performed exclusively through HTTP; SQL uses a read-only transaction.
"""

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit
import uuid

from run import HTTP, PASSWORD, check


PSQL_BIN = os.environ.get("PSQL_BIN", "psql")


def inspect(sql):
    # PGDATABASE itself does not parse a postgres:// URI. Populate libpq's
    # individual environment variables so credentials never enter process argv.
    connection = urlsplit(os.environ["DATABASE_URL"])
    check(connection.scheme in ("postgres", "postgresql"), "DATABASE_URL must be a PostgreSQL URI")
    environment = dict(os.environ)
    settings = {
        "PGHOST": connection.hostname or "localhost",
        "PGPORT": str(connection.port or 5432),
        "PGDATABASE": unquote(connection.path.lstrip("/")),
        "PGUSER": unquote(connection.username or os.environ.get("USER", "")),
    }
    if connection.password is not None:
        settings["PGPASSWORD"] = unquote(connection.password)
    options = {"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY", "connect_timeout": "PGCONNECT_TIMEOUT", "application_name": "PGAPPNAME", "options": "PGOPTIONS"}
    for key, value in parse_qsl(connection.query):
        check(key in options, "Unsupported PostgreSQL URI parameter in storage inspector")
        settings[options[key]] = value
    environment.update(settings)
    process = subprocess.run(
        [PSQL_BIN, "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"],
        input="BEGIN READ ONLY;\n" + sql + ";\nCOMMIT;\n",
        capture_output=True, text=True, timeout=15, env=environment,
    )
    check(process.returncode == 0, "Read-only PostgreSQL inspection failed; check DATABASE_URL and applied migrations")
    return json.loads(process.stdout.strip())


def main():
    check(bool(os.environ.get("DATABASE_URL")), "Set DATABASE_URL explicitly to the development PostgreSQL used by the running API")
    check(shutil.which(PSQL_BIN) is not None, "psql is required for storage inspection; optionally set PSQL_BIN")
    http = HTTP()
    _, auth, _ = http.request("POST", "/auth/register", body={"name": "QA Storage", "email": f"qa-storage-{uuid.uuid4().hex}@example.com", "password": PASSWORD}, expected=201)
    token, owner_id = auth["token"], auth["user"]["id"]
    # UUIDs have already passed the OpenAPI response format validator.
    _, client, _ = http.request("POST", "/clients", token, {"name": "QA Storage Client"}, expected=201)
    _, package, _ = http.request("POST", f"/clients/{client['id']}/packages", token, {"title": "QA Storage", "totalLessons": 8, "priceKopecks": 123456}, expected=201)
    package_id = package["id"]
    _, lesson, _ = http.request("POST", f"/packages/{package_id}/lessons", token, {"scheduledAt": "2026-10-24T12:00:00+10:00"}, expected=201)
    lesson_id = lesson["id"]
    for _ in range(2):
        http.request("POST", f"/packages/{package_id}/payment", token, {})
    for action in [{"action": "complete"}, {"action": "complete"}, {"action": "restore", "confirmed": True}, {"action": "restore", "confirmed": True}, {"action": "complete"}]:
        http.request("PATCH", f"/lessons/{lesson_id}", token, action)
    _, link, _ = http.request("POST", f"/packages/{package_id}/share-link", token, {}, expected=201)
    state = inspect(f"""
SELECT json_build_object(
  'passwordHash', (SELECT password_hash FROM users WHERE id='{owner_id}'),
  'sessionHash', (SELECT encode(token_hash,'hex') FROM sessions WHERE user_id='{owner_id}'),
  'sessionBytes', (SELECT octet_length(token_hash) FROM sessions WHERE user_id='{owner_id}'),
  'shareHash', (SELECT encode(token_hash,'hex') FROM share_links WHERE package_id='{package_id}'),
  'shareBytes', (SELECT octet_length(token_hash) FROM share_links WHERE package_id='{package_id}'),
  'paymentCount', (SELECT count(*) FROM payment_audit WHERE package_id='{package_id}'),
  'paymentActorAndTime', (SELECT bool_and(actor_id='{owner_id}'::uuid AND occurred_at IS NOT NULL) FROM payment_audit WHERE package_id='{package_id}'),
  'paidBy', (SELECT paid_by::text FROM packages WHERE id='{package_id}'),
  'updatedBy', (SELECT updated_by::text FROM lessons WHERE id='{lesson_id}'),
  'lessonActions', (SELECT json_agg(action ORDER BY id) FROM lesson_audit WHERE lesson_id='{lesson_id}'),
  'lessonActorAndTime', (SELECT bool_and(actor_id='{owner_id}'::uuid AND occurred_at IS NOT NULL) FROM lesson_audit WHERE lesson_id='{lesson_id}'),
  'scheduleType', (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='lessons' AND column_name='scheduled_at'),
  'priceType', (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='price_kopecks')
)""")
    check(state["sessionBytes"] == 32 and state["sessionHash"] == hashlib.sha256(token.encode()).hexdigest(), "Session storage must contain the SHA256 digest, not the bearer token")
    check(state["shareBytes"] == 32 and state["shareHash"] == hashlib.sha256(link["token"].encode()).hexdigest(), "Share storage must contain the SHA256 digest, not the public token")
    password = state["passwordHash"]
    match = re.fullmatch(r"\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)", password or "")
    check(match is not None and password != PASSWORD, "Password must be stored as an Argon2id encoded hash")
    memory, iterations, parallelism = map(int, match.group(1, 2, 3))
    check(memory >= 19456 and iterations >= 2 and parallelism == 1, "Argon2id parameters below agreed minimum")
    check(len(base64.b64decode(match.group(4) + "==")) >= 16, "Argon2id salt must be at least 16 bytes")
    check(len(base64.b64decode(match.group(5) + "==")) >= 32, "Argon2id key must be at least 32 bytes")
    check(state["paymentCount"] == 1, "Repeated payment created duplicate audit records")
    check(state["paymentActorAndTime"] and state["lessonActorAndTime"], "Audit must store correct actor and timestamp")
    check(state["paidBy"] == owner_id and state["updatedBy"] == owner_id, "Payment and lesson must retain actor IDs")
    check(state["lessonActions"] == ["schedule", "complete", "restore", "complete"], "Repeated transitions must not duplicate audit records")
    check(state["scheduleType"] == "timestamp with time zone", "PostgreSQL must use timestamptz")
    check(state["priceType"] == "bigint", "PostgreSQL money must be integer kopecks")
    _, rotated, _ = http.request("POST", f"/packages/{package_id}/share-link", token, {}, expected=201)
    rotation = inspect(f"SELECT json_build_object('count',count(*),'hash',min(encode(token_hash,'hex'))) FROM share_links WHERE package_id='{package_id}'")
    check(rotation["count"] == 1 and rotation["hash"] == hashlib.sha256(rotated["token"].encode()).hexdigest(), "Rotation must replace the old token hash")
    check(rotation["hash"] != state["shareHash"], "Old token hash survived rotation")
    http.request("DELETE", f"/packages/{package_id}/share-link", token, expected=204)
    http.request("POST", "/auth/logout", token, expected=204)
    revoked = inspect(f"SELECT json_build_object('sessions',(SELECT count(*) FROM sessions WHERE user_id='{owner_id}'),'links',(SELECT count(*) FROM share_links WHERE package_id='{package_id}'))")
    check(revoked == {"sessions": 0, "links": 0}, "Logout and revoke must remove stored access hashes")
    print("PASS: real PostgreSQL hashes, Argon2id parameters, audit idempotency/actor/time, timestamptz, integer kopecks, rotation and revocation.")
    print(f"HTTP requests: {http.count}; read-only SQL inspections: 3. Synthetic QA data retained. No raw tokens or hashes printed.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, KeyError, ValueError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
