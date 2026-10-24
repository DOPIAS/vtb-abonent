#!/usr/bin/env python3
"""Dashboard contract and state transitions against a running real API/DB."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sys
import unittest

from run import HTTP, PASSWORD, RUN_ID, parsed_time


class DashboardScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = HTTP()
        cls.owner = cls.http.request("POST", "/auth/register", body={
            "name": "QA Обзор", "email": f"dashboard-{RUN_ID}@example.com", "password": PASSWORD,
        }, expected=201)[1]
        cls.other = cls.http.request("POST", "/auth/register", body={
            "name": "QA Пустой обзор", "email": f"dashboard-other-{RUN_ID}@example.com", "password": PASSWORD,
        }, expected=201)[1]

    def request(self, method, path, body=None, expected=200, token=None):
        return self.http.request(method, path, token or self.owner["token"], body, expected)[1]

    def package(self, client, total, price):
        return self.request("POST", f"/clients/{client['id']}/packages", {
            "title": "QA Продолжение", "totalLessons": total, "priceKopecks": price,
        }, expected=201)

    def lesson(self, package, days):
        at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        return self.request("POST", f"/packages/{package['id']}/lessons", {
            "scheduledAt": at,
        }, expected=201)

    def dashboard(self):
        return self.request("GET", "/dashboard")

    def test_01_empty_and_auth(self):
        self.http.request("GET", "/dashboard", expected=401, code="unauthorized")
        empty = self.dashboard()
        parsed_time(empty["asOf"])
        self.assertTrue(all(value == 0 for value in empty["totals"].values()))
        self.assertEqual(empty["renewals"], [])
        self.assertEqual(empty["upcomingLessons"], [])

    def test_02_balance_rounding_and_renewal(self):
        client = self.request("POST", "/clients", {
            "name": "QA Приватный клиент", "contact": "private@example.com",
        }, expected=201)
        old = self.package(client, 3, 10000)
        self.request("POST", f"/packages/{old['id']}/payment", {})
        lesson = self.lesson(old, 1)
        self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "complete"})
        pending = self.package(client, 4, 8000)
        overview = self.dashboard()
        self.assertEqual(overview["totals"], {
            "clientCount": 1, "paidPackageCount": 1, "pendingPackageCount": 1,
            "confirmedPaymentsKopecks": 10000, "pendingPaymentsKopecks": 8000,
            "completedLessons": 1, "remainingLessons": 2, "remainingValueKopecks": 6667,
        })
        self.assertEqual(len(overview["renewals"]), 1)
        self.assertEqual(overview["renewals"][0]["packageId"], old["id"])
        self.assertEqual(overview["renewals"][0]["remainingLessons"], 2)
        self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "restore", "confirmed": True})
        self.assertEqual(self.dashboard()["totals"]["remainingValueKopecks"], 10000)
        self.assertEqual(self.dashboard()["renewals"], [])
        self.request("PATCH", f"/lessons/{lesson['id']}", {"action": "complete"})
        self.request("POST", f"/packages/{pending['id']}/payment", {})
        self.request("POST", f"/packages/{pending['id']}/payment", {})
        fresh = self.dashboard()
        self.assertEqual(fresh["totals"]["confirmedPaymentsKopecks"], 18000)
        self.assertEqual(fresh["totals"]["pendingPaymentsKopecks"], 0)
        self.assertEqual(fresh["totals"]["remainingValueKopecks"], 14667)
        self.assertEqual(fresh["renewals"], [])  # new paid package covers the client
        other = self.request("GET", "/dashboard", token=self.other["token"])
        self.assertTrue(all(value == 0 for value in other["totals"].values()))
        self.assertEqual(other["renewals"], [])
        self.assertEqual(other["upcomingLessons"], [])
        self.__class__.package_id = pending

    def test_03_upcoming_window_and_correction(self):
        package = self.package_id
        past = self.lesson(package, -1)
        late = self.lesson(package, 8)
        second = self.lesson(package, 2)
        first = self.lesson(package, 1)
        cancelled = self.lesson(package, 3)
        self.request("PATCH", f"/lessons/{cancelled['id']}", {"action": "cancel"})
        overview = self.dashboard()
        self.assertEqual([item["id"] for item in overview["upcomingLessons"]], [first["id"], second["id"]])
        for item in overview["upcomingLessons"]:
            self.assertGreaterEqual(parsed_time(item["scheduledAt"]), parsed_time(overview["asOf"]))
            self.assertLessEqual(parsed_time(item["scheduledAt"]), parsed_time(overview["asOf"]) + timedelta(days=7))
            self.assertNotIn(item["id"], [past["id"], late["id"], cancelled["id"]])
            self.assertNotIn("contact", item)
            self.assertNotIn("phone", item)
        self.request("PATCH", f"/lessons/{first['id']}", {"action": "complete"})
        self.assertEqual([item["id"] for item in self.dashboard()["upcomingLessons"]], [second["id"]])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(DashboardScenarios))
    http = getattr(DashboardScenarios, "http", None)
    if http:
        print(f"HTTP requests: {http.count}; OpenAPI response schemas checked: {http.schema_count}.")
    print("Synthetic QA data retained; no client or token values logged.")
    sys.exit(0 if result.wasSuccessful() else 1)
