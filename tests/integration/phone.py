#!/usr/bin/env python3
"""Russian-phone regression against a running API, using synthetic data only.

Run after migrations and API restart:
    BASE_URL=http://localhost:8090/api/v1 python3 tests/integration/phone.py
"""

from __future__ import annotations

import json
import sys
import unittest
from urllib.parse import urlencode

from run import HTTP, PASSWORD, RUN_ID


class PhoneScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = HTTP()
        cls.http.request("GET", "/health")
        cls.owner = cls.http.request("POST", "/auth/register", body={
            "name": "QA Телефон", "email": f"phone-{RUN_ID}@example.com", "password": PASSWORD,
        }, expected=201)[1]
        cls.other = cls.http.request("POST", "/auth/register", body={
            "name": "QA Другой", "email": f"phone-other-{RUN_ID}@example.com", "password": PASSWORD,
        }, expected=201)[1]

    def request(self, method, path, body=None, expected=200, token=None):
        return self.http.request(method, path, token or self.owner["token"], body,
                                 expected=expected,
                                 code="validation_error" if expected == 400 else None)[1]

    def client(self, **extra):
        return self.request("POST", "/clients", {
            "name": "QA Клиент", "contact": "phone-qa@example.com", **extra,
        }, expected=201)

    def test_01_formats_and_legacy_contacts(self):
        legacy = self.client()
        self.assertEqual(legacy["phone"], "")
        self.assertEqual(legacy["contact"], "phone-qa@example.com")
        for phone, canonical in [
            ("+79991234567", "+79991234567"),
            ("+7 (999) 123-45-67", "+79991234567"),
            ("8 (999) 123-45-67", "+79991234567"),
            ("7 999 123 45 67", "+79991234567"),
            ("9991234567", "+79991234567"),
            ("+7 (495) 123-45-67", "+74951234567"),
            ("8 (343) 123-45-67", "+73431234567"),
            ("8001234567", "+78001234567"),
            ("", ""), ("   ", ""),
        ]:
            created = self.client(phone=phone)
            self.assertEqual(created["phone"], canonical)
            self.assertEqual(created["contact"], "phone-qa@example.com")
            updated = self.request("PATCH", f"/clients/{legacy['id']}", {
                "name": "QA Клиент", "phone": phone,
            })
            self.assertEqual(updated["phone"], canonical)

    def test_02_api_validation_cannot_be_bypassed(self):
        client = self.client(phone="8 (999) 123-45-67")
        for invalid in [
            "+7 (701) 123-45-67", "+7 (601) 123-45-67", "+1 999 123 45 67",
            "+8 999 123 45 67", "7999123456", "799912345678", "2991234567",
            "телефон 89991234567", "89991234567 доб. 1", "++79991234567",
            "7+9991234567", "8.999.123.45.67", "+79991234567\x00",
            "+79991234567\n", "+79991234567\r", "\t+79991234567",
            "+７９９９１２３４５６７", "()-", "+", None, 79991234567, True, [], {},
        ]:
            body = {"name": "Не должно сохраниться", "phone": invalid}
            self.request("POST", "/clients", body, expected=400)
            self.request("PATCH", f"/clients/{client['id']}", body, expected=400)
        fresh = self.request("GET", f"/clients/{client['id']}")["client"]
        self.assertEqual(fresh["name"], client["name"])
        self.assertEqual(fresh["phone"], client["phone"])

    def test_03_preserve_clear_and_phone_search(self):
        client = self.client(phone="8 (999) 555-44-33")
        path = f"/clients/{client['id']}"
        updated = self.request("PATCH", path, {"name": "QA Новое имя"})
        self.assertEqual(updated["phone"], "+79995554433")
        self.assertEqual(updated["contact"], client["contact"])
        updated = self.request("PATCH", path, {"name": "QA Новое имя", "contact": ""})
        self.assertEqual(updated["phone"], "+79995554433")
        self.assertEqual(updated["contact"], "")
        found = self.request("GET", "/clients?" + urlencode({"q": "9995554433"}))["items"]
        self.assertEqual([item["id"] for item in found], [client["id"]])
        cleared = self.request("PATCH", path, {"name": "QA Новое имя", "phone": ""})
        self.assertEqual(cleared["phone"], "")
        self.assertEqual(self.request("GET", path)["client"]["phone"], "")

    def test_04_phone_is_private(self):
        client = self.client(phone="+7 (999) 123-45-67")
        self.http.request("GET", f"/clients/{client['id']}", self.other["token"],
                          expected=404, code="not_found")
        self.http.request("PATCH", f"/clients/{client['id']}", self.other["token"],
                          {"name": "QA", "phone": ""}, expected=404, code="not_found")
        package = self.request("POST", f"/clients/{client['id']}/packages", {
            "title": "QA Телефон", "totalLessons": 1, "priceKopecks": 0,
        }, expected=201)
        link = self.request("POST", f"/packages/{package['id']}/share-link", {}, expected=201)
        public = self.http.request("GET", "/public/subscriptions/" + link["token"])[1]
        serialized = json.dumps(public, ensure_ascii=False)
        for forbidden in ["phone", client["phone"], "contact", client["contact"], client["name"]]:
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(PhoneScenarios))
    http = getattr(PhoneScenarios, "http", None)
    if http:
        print(f"HTTP requests: {http.count}; OpenAPI response schemas checked: {http.schema_count}.")
    print("Synthetic QA data retained. Phone numbers and tokens are omitted from output.")
    sys.exit(0 if result.wasSuccessful() else 1)
