package main

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"abonent/api/internal/database"
	"abonent/api/internal/store"
)

func TestShowcaseSeedPreservesExistingRecords(t *testing.T) {
	connection := os.Getenv("TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("set TEST_DATABASE_URL to a dedicated PostgreSQL test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := database.Migrate(ctx, connection, "../../../../db/migrations"); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := store.New(pool)
	created, err := s.Register(ctx, "Synthetic seed test", fmt.Sprintf("showcase-test-%d@example.com", time.Now().UnixNano()), "test-only-unused-hash")
	if err != nil {
		t.Fatal(err)
	}
	owner := created.User.ID
	defer func() {
		if _, err := pool.Exec(context.Background(), "DELETE FROM clients WHERE user_id=$1", owner); err != nil {
			t.Errorf("cleanup clients: %v", err)
		}
		if _, err := pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", owner); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	}()
	now := time.Now().UTC().Truncate(time.Minute)
	packageID, err := seedShowcaseData(ctx, s, owner, now)
	if err != nil {
		t.Fatal(err)
	}
	primary, err := s.Detail(ctx, owner, packageID)
	if err != nil {
		t.Fatal(err)
	}
	if primary.Package.PaidLessons != 8 || primary.Package.CompletedLessons != 5 || primary.Package.RemainingLessons != 3 || primary.Package.PriceKopecks != 1600000 {
		t.Fatalf("primary showcase must start at 8/5/3: %+v", primary.Package)
	}
	dashboard, err := s.Dashboard(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	want := store.DashboardTotals{ClientCount: 3, PaidPackageCount: 2, PendingPackageCount: 1, ConfirmedPaymentsKopecks: 2000000, PendingPaymentsKopecks: 800000, CompletedLessons: 6, RemainingLessons: 4, RemainingValueKopecks: 800000}
	if dashboard.Totals != want || len(dashboard.Renewals) != 1 || dashboard.Renewals[0].RemainingLessons != 1 || len(dashboard.UpcomingLessons) != 5 {
		t.Fatalf("showcase must demonstrate paid/pending/renewal/future schedule: %+v", dashboard)
	}
	for _, lesson := range dashboard.UpcomingLessons {
		if !lesson.ScheduledAt.After(now) {
			t.Fatalf("showcase lessons must be in the future: %+v", lesson)
		}
	}
	if _, err = s.UpdateClient(ctx, owner, primary.Package.ClientID, "Переименованный клиент", nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateClient(ctx, owner, "Дополнительные пользовательские данные", "Сохранить"); err != nil {
		t.Fatal(err)
	}
	for _, lesson := range primary.Lessons {
		if lesson.Status == "scheduled" {
			if _, err = s.ChangeLesson(ctx, owner, lesson.ID, store.LessonChange{Action: "complete"}); err != nil {
				t.Fatal(err)
			}
			break
		}
	}
	edited, err := s.Detail(ctx, owner, packageID)
	if err != nil {
		t.Fatal(err)
	}
	reused, err := seedShowcaseData(ctx, s, owner, now.Add(30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.Detail(ctx, owner, packageID)
	if err != nil {
		t.Fatal(err)
	}
	client, err := s.ClientDetail(ctx, owner, primary.Package.ClientID)
	if err != nil {
		t.Fatal(err)
	}
	if reused != packageID || !reflect.DeepEqual(edited, after) || client.Client.Name != "Переименованный клиент" {
		t.Fatalf("repeat seed must preserve IDs, statuses, names and schedule: edited %+v after %+v", edited, after)
	}
	dashboard, err = s.Dashboard(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.Totals.ClientCount != 4 || dashboard.Totals.PaidPackageCount != 2 || dashboard.Totals.PendingPackageCount != 1 || dashboard.Totals.CompletedLessons != 7 {
		t.Fatalf("repeat seed must neither duplicate nor reset records: %+v", dashboard.Totals)
	}
	var paymentAudits, completeAudits int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM payment_audit a JOIN packages p ON p.id=a.package_id JOIN clients c ON c.id=p.client_id WHERE c.user_id=$1`, owner).Scan(&paymentAudits); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM lesson_audit a JOIN lessons l ON l.id=a.lesson_id JOIN packages p ON p.id=l.package_id JOIN clients c ON c.id=p.client_id WHERE c.user_id=$1 AND a.action='complete'`, owner).Scan(&completeAudits); err != nil {
		t.Fatal(err)
	}
	if paymentAudits != 2 || completeAudits != 7 {
		t.Fatalf("seed audit must agree with manual payment and lesson events, without repeats: payments %d completions %d", paymentAudits, completeAudits)
	}
}
