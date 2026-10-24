#!/usr/bin/env python3
"""Independent end-to-end checks against a running Abonent API and its real DB.

Only Python's standard library is needed. No server modules, mocks, or destructive
cleanup are used. Every run creates uniquely named synthetic accounts and data.
Never point this runner at a production service: it intentionally creates data.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import threading
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import uuid


ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "docs/openapi.yaml").read_text(encoding="utf-8"))
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080/api/v1").rstrip("/")
PASSWORD = "SyntheticQaPass2026!"
RUN_ID = uuid.uuid4().hex


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def parsed_time(value: str) -> datetime:
    check(isinstance(value, str), "Expected an RFC3339 string")
    check(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value)), "Expected an RFC3339 timestamp with offset")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    check(result.utcoffset() is not None, "Expected timezone-aware timestamp")
    return result


def validate_schema(value, schema: dict, at: str = "response") -> None:
    """Validate the subset actually used by this repository's OpenAPI schemas.

    This is deliberately not advertised as a general JSON Schema implementation.
    Unknown schema keywords fail closed, making contract additions visible.
    """
    if "$ref" in schema:
        ref = schema["$ref"]
        check(ref.startswith("#/"), f"{at}: only local schema references supported")
        target = SPEC
        for part in ref[2:].split("/"):
            target = target[part]
        validate_schema(value, target, at)
        return
    supported = {"type", "properties", "required", "items", "nullable", "format", "enum", "minimum", "maximum", "minLength", "maxLength", "description", "example", "additionalProperties", "pattern"}
    check(not (set(schema) - supported), f"{at}: unsupported schema keywords")
    if value is None and schema.get("nullable"):
        return
    kind = schema.get("type")
    type_ok = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": type(value) is int,
        "boolean": type(value) is bool,
        "number": type(value) in (int, float),
        None: True,
    }.get(kind, False)
    check(type_ok, f"{at}: wrong type, expected {kind}")
    if "enum" in schema:
        check(value in schema["enum"], f"{at}: value outside enum")
    if kind == "object":
        for field in schema.get("required", []):
            check(field in value, f"{at}: missing {field}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            check(not (set(value) - set(properties)), f"{at}: unexpected fields")
        for field, child in properties.items():
            if field in value:
                validate_schema(value[field], child, f"{at}.{field}")
    elif kind == "array":
        for index, child in enumerate(value):
            validate_schema(child, schema["items"], f"{at}[{index}]")
    elif kind in ("integer", "number"):
        if "minimum" in schema:
            check(value >= schema["minimum"], f"{at}: below minimum")
        if "maximum" in schema:
            check(value <= schema["maximum"], f"{at}: above maximum")
    elif kind == "string":
        if "pattern" in schema:
            check(re.search(schema["pattern"], value, flags=re.ASCII) is not None, f"{at}: pattern mismatch")
        if "minLength" in schema:
            check(len(value) >= schema["minLength"], f"{at}: too short")
        if "maxLength" in schema:
            check(len(value) <= schema["maxLength"], f"{at}: too long")
        fmt = schema.get("format")
        if fmt == "uuid":
            check(str(uuid.UUID(value)) == value.lower(), f"{at}: noncanonical UUID")
        elif fmt == "date-time":
            parsed_time(value)
        elif fmt == "email":
            check(bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)), f"{at}: invalid email")
        elif fmt == "uri":
            parsed = urlsplit(value)
            check(parsed.scheme in ("http", "https") and bool(parsed.netloc), f"{at}: invalid URI")
        else:
            check(fmt is None, f"{at}: unsupported format")


def operation_for(method: str, path: str):
    path = path.split("?", 1)[0]
    for template, operations in SPEC["paths"].items():
        pattern = re.sub(r"\{[^}]+\}", "[^/]+", template)
        if re.fullmatch(pattern, path) and method.lower() in operations:
            return template, operations[method.lower()]
    raise AssertionError(f"No OpenAPI operation for {method} route")


class HTTP:
    def __init__(self):
        self.count = 0
        self.schema_count = 0
        self.lock = threading.Lock()

    def request(self, method: str, path: str, token: str | None = None,
                body=None, expected: int | None = 200, code: str | None = None,
                headers: dict | None = None, raw: bytes | None = None):
        request_headers = {"Accept": "application/json"}
        if body is not None:
            raw = json.dumps(body, ensure_ascii=False).encode()
        if raw is not None:
            request_headers["Content-Type"] = "application/json"
        if token:
            request_headers["Authorization"] = "Bearer " + token
        request_headers.update(headers or {})
        request = Request(BASE_URL + path, data=raw, headers=request_headers, method=method)
        try:
            response = urlopen(request, timeout=15)
        except HTTPError as error:
            response = error
        except URLError as error:
            raise AssertionError("Running API is unavailable; start API and apply migrations first") from error
        with response:
            status, response_headers, payload = response.status, response.headers, response.read()
        with self.lock:
            self.count += 1
        # Route labels are templates; never print bearer or public link tokens.
        if method == "OPTIONS":
            template, operation = path, None
        else:
            template, operation = operation_for(method, path)
        label = f"{method} {template}"
        if expected is not None:
            check(status == expected, f"{label}: expected HTTP {expected}, got {status}")
        if status == 204:
            check(not payload, f"{label}: HTTP 204 must have no body")
            return status, None, response_headers
        check("application/json" in response_headers.get("Content-Type", ""), f"{label}: expected JSON content type")
        try:
            data = json.loads(payload)
        except (ValueError, UnicodeDecodeError) as error:
            raise AssertionError(f"{label}: invalid JSON response") from error
        if operation:
            check(str(status) in operation["responses"], f"{label}: HTTP status missing from contract")
            schema = operation["responses"][str(status)]["content"]["application/json"]["schema"]
            validate_schema(data, schema)
            with self.lock:
                self.schema_count += 1
        if code:
            check(data.get("error", {}).get("code") == code, f"{label}: unexpected machine error code")
            check(bool(data["error"]["message"].strip()), f"{label}: empty error message")
        return status, data, response_headers


class RealAPIScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = HTTP()
        cls.http.request("GET", "/health")
        cls.email = f"qa-{RUN_ID}@example.com"
        _, cls.owner, _ = cls.http.request("POST", "/auth/register", body={"name": "QA Преподаватель", "email": cls.email, "password": PASSWORD}, expected=201)
        _, cls.other, _ = cls.http.request("POST", "/auth/register", body={"name": "QA Другой преподаватель", "email": f"qa-other-{RUN_ID}@example.com", "password": PASSWORD}, expected=201)
        cls.token = cls.owner["token"]
        cls.other_token = cls.other["token"]

    def request(self, method, path, body=None, token=None, expected=200, code=None, **kwargs):
        return self.http.request(method, path, self.token if token is None else token, body, expected, code, **kwargs)[1]

    def client(self, name="QA Клиент", contact="qa-private@example.com"):
        return self.request("POST", "/clients", {"name": name, "contact": contact}, expected=201)

    def package(self, client, total=8):
        return self.request("POST", f"/clients/{client['id']}/packages", {"title": "QA Пакет", "totalLessons": total, "priceKopecks": 123456}, expected=201)

    def lesson(self, package, at="2026-10-24T12:30:00+10:00"):
        return self.request("POST", f"/packages/{package['id']}/lessons", {"scheduledAt": at}, expected=201)

    def detail(self, package):
        detail = self.request("GET", f"/packages/{package['id']}")
        self.invariant(detail)
        return detail

    def invariant(self, detail):
        package = detail["package"]
        completed = sum(lesson["status"] == "completed" for lesson in detail["lessons"])
        self.assertEqual(package["completedLessons"], completed)
        self.assertEqual(package["paidLessons"], package["totalLessons"] if package["paymentStatus"] == "paid" else 0)
        self.assertEqual(package["remainingLessons"], package["paidLessons"] - completed)
        self.assertGreaterEqual(package["remainingLessons"], 0)

    def test_01_register_login_logout_sessions(self):
        expiry = parsed_time(self.owner["expiresAt"])
        self.assertTrue(timedelta(days=29) < expiry - datetime.now(timezone.utc) <= timedelta(days=31))
        self.assertEqual(self.request("GET", "/auth/me")["id"], self.owner["user"]["id"])
        self.http.request("GET", "/auth/me", expected=401, code="unauthorized")
        self.http.request("POST", "/auth/register", body={"name": "QA duplicate", "email": self.email, "password": PASSWORD}, expected=409, code="conflict")
        self.http.request("POST", "/auth/login", body={"email": self.email, "password": "WrongPassword2026!"}, expected=401, code="unauthorized")
        _, login, _ = self.http.request("POST", "/auth/login", body={"email": self.email.upper(), "password": PASSWORD})
        self.assertEqual(login["user"]["id"], self.owner["user"]["id"])
        check(login["token"] != self.token, "Login must issue an independent session")
        self.http.request("POST", "/auth/logout", token=login["token"], expected=204)
        self.http.request("GET", "/auth/me", token=login["token"], expected=401, code="unauthorized")
        self.http.request("POST", "/auth/logout", token=login["token"], expected=401, code="unauthorized")
        self.request("GET", "/auth/me")

    def test_02_client_create_edit_search(self):
        marker = "Поиск-" + uuid.uuid4().hex
        client = self.client(marker, "private-" + marker)
        self.assertEqual(client["contact"], "private-" + marker)
        edited = self.request("PATCH", f"/clients/{client['id']}", {"name": marker + " Исправлен"})
        self.assertEqual(edited["id"], client["id"])
        self.assertEqual(edited["contact"], client["contact"], "Omitted contact must be preserved")
        result = self.request("GET", "/clients?" + urlencode({"q": marker.lower()}))
        self.assertEqual([item["id"] for item in result["items"]], [client["id"]])
        result = self.request("GET", "/clients?" + urlencode({"q": "private-" + marker}))
        self.assertEqual([item["id"] for item in result["items"]], [client["id"]])
        cleared = self.request("PATCH", f"/clients/{client['id']}", {"name": marker, "contact": ""})
        self.assertEqual(cleared["contact"], "")
        self.assertEqual(self.request("GET", f"/clients/{client['id']}")["client"]["contact"], "")
        no_contact = self.request("POST", "/clients", {"name": "Без контакта"}, expected=201)
        self.assertEqual(no_contact["contact"], "")
        literal = self.client(marker + "%_", "")
        self.client(marker + "AB", "")
        for term in [marker + "%", marker + "%_"]:
            results = self.request("GET", "/clients?" + urlencode({"q": term}))["items"]
            self.assertEqual([item["id"] for item in results], [literal["id"]], "Search must treat SQL wildcard input literally")

    def test_03_payment_lesson_balance_and_restore(self):
        client = self.client()
        package = self.package(client)
        self.assertEqual((package["paymentStatus"], package["paidLessons"], package["remainingLessons"]), ("pending", 0, 0))
        lessons = [self.lesson(package, f"2026-10-{day:02d}T12:30:00+10:00") for day in range(1, 9)]
        self.assertEqual(lessons[0]["scheduledAt"], "2026-10-01T02:30:00Z")
        self.request("PATCH", f"/lessons/{lessons[0]['id']}", {"action": "complete"}, expected=409, code="payment_required")
        self.assertEqual(self.detail(package)["package"]["completedLessons"], 0)
        self.assertEqual(self.detail(package)["package"]["remainingLessons"], 0)
        paid = self.request("POST", f"/packages/{package['id']}/payment", {})
        repeated = self.request("POST", f"/packages/{package['id']}/payment", {})
        self.assertEqual(paid, repeated, "Repeated payment must preserve paidAt and all counters")
        self.assertEqual((paid["paidLessons"], paid["remainingLessons"], paid["priceKopecks"]), (8, 8, 123456))
        for lesson in lessons[:5]:
            self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "complete"})
        before = self.detail(package)
        self.assertEqual((before["package"]["paidLessons"], before["package"]["completedLessons"], before["package"]["remainingLessons"]), (8, 5, 3))
        repeated = self.request("PATCH", f"/lessons/{lessons[0]['id']}", {"action": "complete"})
        self.assertEqual(repeated, before, "Repeated completion must not touch counters or lesson timestamp")
        moved = self.request("PATCH", f"/lessons/{lessons[5]['id']}", {"action": "reschedule", "scheduledAt": "2026-12-31T23:45:00-07:00"})
        self.invariant(moved)
        self.assertEqual(moved["package"]["remainingLessons"], 3)
        moved_lesson = next(item for item in moved["lessons"] if item["id"] == lessons[5]["id"])
        self.assertEqual(moved_lesson["scheduledAt"], "2027-01-01T06:45:00Z")
        self.assertEqual(len(moved["lessons"]), 8, "Rescheduling must preserve the existing lesson ID")
        cancelled = self.request("PATCH", f"/lessons/{lessons[6]['id']}", {"action": "cancel"})
        repeated_cancel = self.request("PATCH", f"/lessons/{lessons[6]['id']}", {"action": "cancel"})
        self.assertEqual(cancelled, repeated_cancel)
        self.assertEqual(cancelled["package"]["remainingLessons"], 3)
        for action in [{"action": "complete"}, {"action": "restore", "confirmed": True}, {"action": "reschedule", "scheduledAt": "2026-12-01T00:00:00Z"}]:
            self.request("PATCH", f"/lessons/{lessons[6]['id']}", action, expected=409, code="conflict")
        for action in [{"action": "restore"}, {"action": "restore", "confirmed": False}]:
            self.request("PATCH", f"/lessons/{lessons[0]['id']}", action, expected=400, code="validation_error")
        self.assertEqual(self.detail(package)["package"]["remainingLessons"], 3)
        restored = self.request("PATCH", f"/lessons/{lessons[0]['id']}", {"action": "restore", "confirmed": True})
        self.assertEqual((restored["package"]["completedLessons"], restored["package"]["remainingLessons"]), (4, 4))
        self.assertEqual(self.request("PATCH", f"/lessons/{lessons[0]['id']}", {"action": "restore", "confirmed": True}), restored)
        self.request("PATCH", f"/lessons/{lessons[0]['id']}", {"action": "complete"})
        final = self.detail(package)
        self.assertEqual(final["package"]["remainingLessons"], 3)
        client_packages = self.request("GET", f"/clients/{client['id']}")["packages"]
        self.assertEqual(client_packages[0], final["package"], "Client card must use authoritative counters")

    def test_04_cross_teacher_access_all_resource_routes(self):
        client = self.client("QA Приватный", "must-not-leak-" + RUN_ID)
        package = self.package(client)
        lesson = self.lesson(package)
        link = self.request("POST", f"/packages/{package['id']}/share-link", {}, expected=201)
        routes = [
            ("GET", f"/clients/{client['id']}", None),
            ("PATCH", f"/clients/{client['id']}", {"name": "Foreign mutation"}),
            ("POST", f"/clients/{client['id']}/packages", {"title": "Foreign package", "totalLessons": 1, "priceKopecks": 0}),
            ("GET", f"/packages/{package['id']}", None),
            ("POST", f"/packages/{package['id']}/payment", {}),
            ("POST", f"/packages/{package['id']}/lessons", {"scheduledAt": "2026-10-24T00:00:00Z"}),
            ("POST", f"/packages/{package['id']}/share-link", {}),
            ("DELETE", f"/packages/{package['id']}/share-link", None),
        ]
        for action in [{"action": "complete"}, {"action": "cancel"}, {"action": "restore", "confirmed": True}, {"action": "reschedule", "scheduledAt": "2026-10-25T00:00:00Z"}]:
            routes.append(("PATCH", f"/lessons/{lesson['id']}", action))
        before = self.detail(package)
        for method, path, body in routes:
            self.request(method, path, body, token=self.other_token, expected=404, code="not_found")
        foreign = self.request("GET", "/clients?" + urlencode({"q": "must-not-leak-" + RUN_ID}), token=self.other_token)
        self.assertEqual(foreign["items"], [])
        self.assertEqual(self.detail(package), before, "Foreign requests must not mutate the package")
        self.http.request("GET", "/public/subscriptions/" + link["token"])

    def test_05_public_read_only_scope_rotation_revocation(self):
        private_name = "Secret-client-" + RUN_ID
        private_contact = "Secret-contact-" + RUN_ID
        client = self.client(private_name, private_contact)
        package = self.package(client)
        lesson = self.lesson(package)
        self.request("POST", f"/packages/{package['id']}/payment", {})
        other_package = self.package(client, total=2)
        self.lesson(other_package)
        link = self.request("POST", f"/packages/{package['id']}/share-link", {}, expected=201)
        check(len(link["token"]) >= 43, "Public link token needs at least 256-bit encoding length")
        check(urlsplit(link["url"]).path == "/s/" + link["token"], "Share URL path does not contain issued token")
        status, public, headers = self.http.request("GET", "/public/subscriptions/" + link["token"])
        self.assertEqual(headers.get("Cache-Control"), "no-store")
        self.assertEqual(headers.get("Referrer-Policy"), "no-referrer")
        self.assertEqual(public["package"]["id"], package["id"])
        self.assertEqual([item["id"] for item in public["lessons"]], [lesson["id"]])
        allowed_package_fields = set(SPEC["components"]["schemas"]["PublicPackage"]["properties"])
        self.assertEqual(set(public), {"package", "lessons"})
        self.assertEqual(set(public["package"]), allowed_package_fields)
        allowed_lesson_fields = set(SPEC["components"]["schemas"]["Lesson"]["properties"])
        for public_lesson in public["lessons"]:
            self.assertEqual(set(public_lesson), allowed_lesson_fields)
        wire = json.dumps(public, ensure_ascii=False)
        for secret in ["clientId", "userId", "contact", "password", "token", "actorId", "paidBy", "updatedBy", private_name, private_contact, client["id"], self.owner["user"]["id"], other_package["id"]]:
            check(secret not in wire, "Public response contains private or unrelated fields")
        protected_routes = [
            ("GET", "/auth/me", None), ("POST", "/auth/logout", None),
            ("GET", "/clients", None), ("POST", "/clients", {"name": "Forbidden"}),
            ("GET", f"/clients/{client['id']}", None),
            ("PATCH", f"/clients/{client['id']}", {"name": "Forbidden"}),
            ("POST", f"/clients/{client['id']}/packages", {"title": "Forbidden", "totalLessons": 1, "priceKopecks": 0}),
            ("GET", f"/packages/{package['id']}", None),
            ("POST", f"/packages/{package['id']}/payment", {}),
            ("POST", f"/packages/{package['id']}/lessons", {"scheduledAt": "2026-10-24T00:00:00Z"}),
            ("PATCH", f"/lessons/{lesson['id']}", {"action": "complete"}),
            ("POST", f"/packages/{package['id']}/share-link", {}),
            ("DELETE", f"/packages/{package['id']}/share-link", None),
        ]
        for method, path, body in protected_routes:
            self.request(method, path, body, token=link["token"], expected=401, code="unauthorized")
        self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "complete"})
        fresh = self.http.request("GET", "/public/subscriptions/" + link["token"])[1]
        self.assertEqual(fresh["package"]["remainingLessons"], 7, "Public read must immediately reflect committed completion")
        rotated = self.request("POST", f"/packages/{package['id']}/share-link", {}, expected=201)
        check(rotated["token"] != link["token"], "Rotation must issue a fresh token")
        for old_token in [link["token"], "not-valid", "A" * 43]:
            _, _, error_headers = self.http.request("GET", "/public/subscriptions/" + old_token, expected=404, code="not_found")
            self.assertEqual(error_headers.get("Cache-Control"), "no-store")
            self.assertEqual(error_headers.get("Referrer-Policy"), "no-referrer")
        self.http.request("GET", "/public/subscriptions/" + rotated["token"])
        self.request("DELETE", f"/packages/{package['id']}/share-link", expected=204)
        self.request("DELETE", f"/packages/{package['id']}/share-link", expected=204)
        self.http.request("GET", "/public/subscriptions/" + rotated["token"], expected=404, code="not_found")

    def test_06_parallel_final_credit_and_duplicate_completion(self):
        client = self.client()
        # Repeat independent last-credit races to exercise PostgreSQL row locking.
        for _ in range(5):
            package = self.package(client, total=1)
            self.request("POST", f"/packages/{package['id']}/payment", {})
            lessons = [self.lesson(package), self.lesson(package)]
            start = threading.Barrier(2)

            def complete(lesson):
                start.wait(timeout=10)
                return self.http.request("PATCH", f"/lessons/{lesson['id']}", self.token, {"action": "complete"}, expected=None)

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(complete, lessons))
            self.assertEqual(sorted(result[0] for result in results), [200, 409])
            conflict = next(result[1] for result in results if result[0] == 409)
            self.assertEqual(conflict["error"]["code"], "insufficient_balance")
            detail = self.detail(package)
            self.assertEqual((detail["package"]["completedLessons"], detail["package"]["remainingLessons"]), (1, 0))
            self.assertEqual(sorted(lesson["status"] for lesson in detail["lessons"]), ["completed", "scheduled"])
        package = self.package(client, total=1)
        self.request("POST", f"/packages/{package['id']}/payment", {})
        lesson = self.lesson(package)
        start = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(complete, [lesson, lesson]))
        self.assertEqual([result[0] for result in results], [200, 200])
        self.assertEqual(self.detail(package)["package"]["remainingLessons"], 0)

    def test_07_validation_money_timezone_and_foreign_body_ids(self):
        client = self.client()
        package = self.package(client)
        lesson = self.lesson(package)
        for body in [{"name": "", "email": f"invalid-{RUN_ID}@example.com", "password": PASSWORD}, {"name": "QA", "email": "invalid", "password": PASSWORD}, {"name": "QA", "email": f"invalid-{RUN_ID}@example.com", "password": "short"}, {"name": "Я" * 121, "email": f"invalid-{RUN_ID}@example.com", "password": PASSWORD}]:
            self.http.request("POST", "/auth/register", body=body, expected=400, code="validation_error")
        for body in [{"name": "   "}, {"name": "Я" * 121}, {"name": "NUL\u0000"}, {"name": "QA", "contact": "c" * 251}, {"name": "QA", "contact": None}, {"name": "QA", "userId": self.other["user"]["id"]}]:
            self.request("POST", "/clients", body, expected=400, code="validation_error")
        for changes in [{"totalLessons": 0}, {"totalLessons": 1001}, {"totalLessons": 1.5}, {"priceKopecks": -1}, {"priceKopecks": 1000000001}, {"priceKopecks": 1.25}, {"title": ""}, {"clientId": str(uuid.uuid4())}, {"totalLessons": None}]:
            body = {"title": "QA", "totalLessons": 1, "priceKopecks": 0, **changes}
            self.request("POST", f"/clients/{client['id']}/packages", body, expected=400, code="validation_error")
        for timestamp in ["2026-10-24T12:00:00", "2026-02-30T12:00:00+10:00", "not-a-date", "2026-10-24T24:00:00Z", "2026-10-24T12:00:00+24:00", "2026-10-24T12:00:00+00:60", "2026-10-24T12:00:00,5Z"]:
            self.request("POST", f"/packages/{package['id']}/lessons", {"scheduledAt": timestamp}, expected=400, code="validation_error")
            self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "reschedule", "scheduledAt": timestamp}, expected=400, code="validation_error")
        for body in [{"action": "unknown"}, {"action": "reschedule"}, {"action": "complete", "confirmed": True}, {"action": "complete", "packageId": str(uuid.uuid4())}, {"action": "restore", "confirmed": None}]:
            self.request("PATCH", f"/lessons/{lesson['id']}", body, expected=400, code="validation_error")
        for raw in [b"[]", b"null", b'{"name":"QA"}{}', b'{"name":"QA",}', b'{"name":null}', b'{"name":"QA","unexpected":1}', b'{"name":"' + b"x" * (1024 * 1024) + b'"}']:
            self.request("POST", "/clients", raw=raw, expected=400, code="validation_error")
        self.request("POST", "/clients", raw=b'{"name":"QA"}', headers={"Content-Type": "text/plain"}, expected=400, code="validation_error")
        self.request("GET", "/clients?" + urlencode({"q": "x" * 251}), expected=400, code="validation_error")
        self.request("GET", "/clients/not-a-uuid", expected=404, code="not_found")
        self.assertEqual(self.detail(package)["package"]["completedLessons"], 0)
        for timestamp, utc in [("2026-10-24T00:15:00+14:00", "2026-10-23T10:15:00Z"), ("2026-10-24T23:15:00-12:00", "2026-10-25T11:15:00Z")]:
            self.assertEqual(self.lesson(package, timestamp)["scheduledAt"], utc)

    def test_08_cors_allowlist(self):
        allowed = os.environ.get("CORS_TEST_ORIGIN", "http://localhost:8090")
        headers = {"Origin": allowed, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "Authorization,Content-Type"}
        _, _, response = self.http.request("OPTIONS", "/clients", headers=headers, expected=204)
        self.assertEqual(response.get("Access-Control-Allow-Origin"), allowed)
        self.assertIn("Authorization", response.get("Access-Control-Allow-Headers", ""))
        self.assertIn("Content-Type", response.get("Access-Control-Allow-Headers", ""))
        self.assertIn("PATCH", response.get("Access-Control-Allow-Methods", ""))
        _, _, response = self.http.request("GET", "/health", headers={"Origin": allowed})
        self.assertEqual(response.get("Access-Control-Allow-Origin"), allowed)
        _, _, response = self.http.request("GET", "/health", headers={"Origin": "https://untrusted.invalid"})
        self.assertIsNone(response.get("Access-Control-Allow-Origin"))
        _, _, response = self.http.request("OPTIONS", "/clients", headers={"Origin": "https://untrusted.invalid"}, expected=400, code="validation_error")
        self.assertIsNone(response.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RealAPIScenarios)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    http = getattr(RealAPIScenarios, "http", None)
    if http:
        print(f"HTTP requests: {http.count}; OpenAPI response schemas checked: {http.schema_count}.")
    print("Synthetic QA data retained; no existing records deleted. Tokens are omitted from output.")
    sys.exit(0 if result.wasSuccessful() else 1)
