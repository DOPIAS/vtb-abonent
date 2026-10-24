package api_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"abonent/api/internal/api"
	"abonent/api/internal/config"
	"abonent/api/internal/database"
	"abonent/api/internal/store"
)

func dashboardHarness(t *testing.T) (harness, store.Auth, *store.Store) {
	t.Helper()
	connection := os.Getenv("TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("set TEST_DATABASE_URL to a dedicated PostgreSQL test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	if err := database.Migrate(ctx, connection, "../../../../db/migrations"); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	s := store.New(pool)
	server := httptest.NewServer(api.New(s, config.Config{PublicWebURL: "https://abonent.example"}))
	t.Cleanup(server.Close)
	h := harness{t: t, base: server.URL, client: server.Client()}
	teacher := decodeAs[store.Auth](t, h.request("POST", "/auth/register", "", map[string]any{
		"name": "Обзор QA", "email": fmt.Sprintf("dashboard-%d@example.com", time.Now().UnixNano()), "password": "DashboardPass123!",
	}, 201))
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), "DELETE FROM clients WHERE user_id=$1", teacher.User.ID); err != nil {
			t.Errorf("cleanup clients: %v", err)
		}
		if _, err := pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", teacher.User.ID); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return h, teacher, s
}

func dashboardClient(h harness, token, name string) store.Client {
	return decodeAs[store.Client](h.t, h.request("POST", "/clients", token, map[string]any{"name": name}, 201))
}

func dashboardPackage(h harness, token, clientID, title string, total int, price int64, paid bool) store.Package {
	p := decodeAs[store.Package](h.t, h.request("POST", "/clients/"+clientID+"/packages", token, map[string]any{
		"title": title, "totalLessons": total, "priceKopecks": price,
	}, 201))
	if paid {
		p = decodeAs[store.Package](h.t, h.request("POST", "/packages/"+p.ID+"/payment", token, map[string]any{}, 200))
	}
	return p
}

func dashboardLesson(h harness, token, packageID string, scheduled time.Time, action string) store.Lesson {
	l := decodeAs[store.Lesson](h.t, h.request("POST", "/packages/"+packageID+"/lessons", token, map[string]any{"scheduledAt": scheduled}, 201))
	if action != "" {
		h.request("PATCH", "/lessons/"+l.ID, token, map[string]any{"action": action}, 200)
	}
	return l
}

func dashboardRead(h harness, token string) store.Dashboard {
	return decodeAs[store.Dashboard](h.t, h.request("GET", "/dashboard", token, nil, 200))
}

func TestIntegrationDashboardPaidBalanceAndOwnership(t *testing.T) {
	h, teacher, _ := dashboardHarness(t)
	h.request("GET", "/dashboard", "", nil, 401)
	emptyBody := h.request("GET", "/dashboard", teacher.Token, nil, 200)
	empty := decodeAs[store.Dashboard](t, emptyBody)
	if empty.Totals != (store.DashboardTotals{}) || !bytes.Contains(emptyBody, []byte(`"renewals":[]`)) || !bytes.Contains(emptyBody, []byte(`"upcomingLessons":[]`)) {
		t.Fatalf("empty dashboard must use zero totals and JSON arrays: %s", emptyBody)
	}
	client := dashboardClient(h, teacher.Token, "Основной клиент")
	p := dashboardPackage(h, teacher.Token, client.ID, "Английский", 8, 1600000, true)
	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		dashboardLesson(h, teacher.Token, p.ID, now.Add(-time.Duration(i+1)*time.Hour), "complete")
	}
	upcoming := dashboardLesson(h, teacher.Token, p.ID, now.Add(time.Hour), "")
	pendingClient := dashboardClient(h, teacher.Token, "Ожидает оплату")
	pending := dashboardPackage(h, teacher.Token, pendingClient.ID, "Не оплачено", 4, 800000, false)
	pendingLesson := dashboardLesson(h, teacher.Token, pending.ID, now.Add(2*time.Hour), "")
	// A scheduled unpaid lesson belongs in the timetable but creates no paid credits.
	foreignHarness, foreignOwner, _ := dashboardHarness(t)
	foreignClient := dashboardClient(foreignHarness, foreignOwner.Token, "Секретное имя")
	foreignPackage := dashboardPackage(foreignHarness, foreignOwner.Token, foreignClient.ID, "Чужой пакет", 1, 999999999, true)
	dashboardLesson(foreignHarness, foreignOwner.Token, foreignPackage.ID, now.Add(30*time.Minute), "")

	dashboard := dashboardRead(h, teacher.Token)
	want := store.DashboardTotals{ClientCount: 2, PaidPackageCount: 1, PendingPackageCount: 1, ConfirmedPaymentsKopecks: 1600000, PendingPaymentsKopecks: 800000, CompletedLessons: 5, RemainingLessons: 3, RemainingValueKopecks: 600000}
	if dashboard.Totals != want {
		t.Fatalf("8/5/3 dashboard: got %+v want %+v", dashboard.Totals, want)
	}
	if dashboard.AsOf.Before(now.Add(-time.Second)) || dashboard.AsOf.After(time.Now().UTC().Add(time.Second)) || dashboard.AsOf.Location() != time.UTC {
		t.Fatalf("asOf must identify the current UTC snapshot: %s", dashboard.AsOf)
	}
	if len(dashboard.Renewals) != 0 || len(dashboard.UpcomingLessons) != 2 || dashboard.UpcomingLessons[0].ID != upcoming.ID || dashboard.UpcomingLessons[1].ID != pendingLesson.ID {
		t.Fatalf("pending/foreign rows leaked into renewals or changed upcoming: %+v", dashboard)
	}
	foreignDashboard := dashboardRead(foreignHarness, foreignOwner.Token)
	if foreignDashboard.Totals.ClientCount != 1 || foreignDashboard.Totals.ConfirmedPaymentsKopecks != 999999999 || len(foreignDashboard.UpcomingLessons) != 1 || foreignDashboard.UpcomingLessons[0].ClientID != foreignClient.ID {
		t.Fatalf("foreign dashboard must contain only its owner's data: %+v", foreignDashboard)
	}
}

func TestIntegrationDashboardRoundingAndClientRenewal(t *testing.T) {
	h, teacher, _ := dashboardHarness(t)
	client := dashboardClient(h, teacher.Token, "Продление")
	old := dashboardPackage(h, teacher.Token, client.ID, "Первый шаблон", 3, 101, true)
	now := time.Now().UTC()
	dashboardLesson(h, teacher.Token, old.ID, now.Add(-time.Hour), "complete")
	pending := dashboardPackage(h, teacher.Token, client.ID, "Будущий пакет", 4, 800000, false)
	dashboard := dashboardRead(h, teacher.Token)
	if dashboard.Totals.RemainingValueKopecks != 68 || dashboard.Totals.RemainingLessons != 2 || len(dashboard.Renewals) != 1 || dashboard.Renewals[0].PackageID != old.ID || dashboard.Renewals[0].RemainingLessons != 2 {
		t.Fatalf("101 kopecks / 3: remaining value must be 101-floor(101/3)=68, pending does not suppress renewal: %+v", dashboard)
	}
	if pending.PaymentStatus != "pending" || dashboard.Totals.ConfirmedPaymentsKopecks != 101 || dashboard.Totals.PendingPaymentsKopecks != 800000 {
		t.Fatal("pending payment must remain separate from confirmed money")
	}
	newPackage := dashboardPackage(h, teacher.Token, client.ID, "Последний оплаченный шаблон", 3, 100, true)
	dashboard = dashboardRead(h, teacher.Token)
	if dashboard.Totals.RemainingLessons != 5 || len(dashboard.Renewals) != 0 {
		t.Fatalf("new paid stock must suppress an old low package renewal: %+v", dashboard)
	}
	for i := 0; i < 3; i++ {
		dashboardLesson(h, teacher.Token, newPackage.ID, now.Add(-time.Duration(i+2)*time.Hour), "complete")
	}
	other := dashboardClient(h, teacher.Token, "Второе округление")
	otherPackage := dashboardPackage(h, teacher.Token, other.ID, "Трети копейки", 3, 100, true)
	for i := 0; i < 2; i++ {
		dashboardLesson(h, teacher.Token, otherPackage.ID, now.Add(-time.Duration(i+5)*time.Hour), "complete")
	}
	dashboard = dashboardRead(h, teacher.Token)
	if dashboard.Totals.RemainingValueKopecks != 102 || dashboard.Totals.RemainingLessons != 3 || dashboard.Totals.CompletedLessons != 6 || dashboard.Totals.ConfirmedPaymentsKopecks != 301 {
		t.Fatalf("round per package: 68 + 0 + (100-floor(200/3)) = 102: %+v", dashboard.Totals)
	}
	if len(dashboard.Renewals) != 2 {
		t.Fatalf("expected two clients needing renewal: %+v", dashboard.Renewals)
	}
	found := false
	for _, renewal := range dashboard.Renewals {
		if renewal.ClientID == client.ID {
			found = renewal.PackageID == newPackage.ID && renewal.PackageTitle == newPackage.Title && renewal.TotalLessons == 3 && renewal.PriceKopecks == 100 && renewal.RemainingLessons == 2
		}
	}
	if !found {
		t.Fatalf("renewal must use the last paid template and the whole client balance: %+v", dashboard.Renewals)
	}
}

func TestIntegrationDashboardUpcomingAndCorrections(t *testing.T) {
	h, teacher, _ := dashboardHarness(t)
	client := dashboardClient(h, teacher.Token, "Расписание")
	p := dashboardPackage(h, teacher.Token, client.ID, "Двадцать занятий", 20, 2000, true)
	now := time.Now().UTC()
	completed := dashboardLesson(h, teacher.Token, p.ID, now.Add(15*time.Minute), "complete")
	cancelled := dashboardLesson(h, teacher.Token, p.ID, now.Add(20*time.Minute), "cancel")
	dashboardLesson(h, teacher.Token, p.ID, now.Add(-time.Hour), "")
	dashboardLesson(h, teacher.Token, p.ID, now.Add(8*24*time.Hour), "")
	var scheduled []store.Lesson
	for i := 0; i < 12; i++ {
		scheduled = append(scheduled, dashboardLesson(h, teacher.Token, p.ID, now.Add(time.Duration(i+1)*time.Hour), ""))
	}
	dashboard := dashboardRead(h, teacher.Token)
	if dashboard.Totals.CompletedLessons != 1 || dashboard.Totals.RemainingLessons != 19 || dashboard.Totals.RemainingValueKopecks != 1900 || len(dashboard.UpcomingLessons) != 10 {
		t.Fatalf("completion/cancellation or first ten upcoming mismatch: %+v", dashboard)
	}
	for i, lesson := range dashboard.UpcomingLessons {
		if lesson.ID != scheduled[i].ID || lesson.ClientName != client.Name || lesson.PackageTitle != p.Title || lesson.ScheduledAt.Before(dashboard.AsOf) || lesson.ScheduledAt.After(dashboard.AsOf.Add(7*24*time.Hour)) {
			t.Fatalf("upcoming must be ordered, owner scoped, scheduled and within seven days: %+v", dashboard.UpcomingLessons)
		}
		if lesson.ID == completed.ID || lesson.ID == cancelled.ID {
			t.Fatal("completed/cancelled lessons must not appear as upcoming")
		}
	}
	h.request("PATCH", "/lessons/"+completed.ID, teacher.Token, map[string]any{"action": "restore", "confirmed": true}, 200)
	dashboard = dashboardRead(h, teacher.Token)
	if dashboard.Totals.CompletedLessons != 0 || dashboard.Totals.RemainingLessons != 20 || dashboard.Totals.RemainingValueKopecks != 2000 || dashboard.UpcomingLessons[0].ID != completed.ID {
		t.Fatalf("confirmed restore must return credit/value and future scheduled lesson: %+v", dashboard)
	}
	h.request("PATCH", "/lessons/"+completed.ID, teacher.Token, map[string]any{"action": "reschedule", "scheduledAt": now.Add(9 * 24 * time.Hour)}, 200)
	dashboard = dashboardRead(h, teacher.Token)
	if dashboard.UpcomingLessons[0].ID != scheduled[0].ID || dashboard.Totals.RemainingValueKopecks != 2000 {
		t.Fatalf("reschedule outside seven days must only change the timetable: %+v", dashboard)
	}
}

func TestIntegrationDashboardSnapshotAcrossConcurrentCorrections(t *testing.T) {
	h, teacher, s := dashboardHarness(t)
	client := dashboardClient(h, teacher.Token, "Согласованный снимок")
	p := dashboardPackage(h, teacher.Token, client.ID, "Одно занятие", 1, 101, true)
	l := dashboardLesson(h, teacher.Token, p.ID, time.Now().UTC().Add(time.Hour), "")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		for i := 0; i < 80; i++ {
			if _, err := s.ChangeLesson(ctx, teacher.User.ID, l.ID, store.LessonChange{Action: "complete"}); err != nil {
				done <- err
				return
			}
			if _, err := s.ChangeLesson(ctx, teacher.User.ID, l.ID, store.LessonChange{Action: "restore", Confirmed: true}); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	var readErr error
	for i := 0; i < 80; i++ {
		dashboard, err := s.Dashboard(ctx, teacher.User.ID)
		if err != nil {
			readErr = err
			break
		}
		remaining := dashboard.Totals.RemainingLessons
		// Both valid snapshots must agree across the independently queried totals,
		// renewal queue and timetable while another transaction changes the lesson.
		if (remaining != 0 && remaining != 1) || dashboard.Totals.CompletedLessons != 1-remaining || dashboard.Totals.RemainingValueKopecks != int64(101*remaining) || len(dashboard.Renewals) != 1 || dashboard.Renewals[0].RemainingLessons != remaining || len(dashboard.UpcomingLessons) != remaining {
			readErr = fmt.Errorf("dashboard combined different database states: %+v", dashboard)
			break
		}
	}
	if err := <-done; err != nil {
		t.Fatalf("concurrent writer: %v", err)
	}
	if readErr != nil {
		t.Fatal(readErr)
	}
}
