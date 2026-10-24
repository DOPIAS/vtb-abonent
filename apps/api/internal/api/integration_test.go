package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"abonent/api/internal/api"
	"abonent/api/internal/auth"
	"abonent/api/internal/config"
	"abonent/api/internal/database"
	"abonent/api/internal/store"
)

type harness struct {
	t      *testing.T
	base   string
	client *http.Client
}

func (h harness) request(method, path, token string, body any, want int) []byte {
	h.t.Helper()
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			h.t.Fatal(err)
		}
	}
	r, err := http.NewRequest(method, h.base+"/api/v1"+path, bytes.NewReader(data))
	if err != nil {
		h.t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := h.client.Do(r)
	if err != nil {
		h.t.Fatal(err)
	}
	defer response.Body.Close()
	result, err := io.ReadAll(response.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if response.StatusCode != want {
		h.t.Fatalf("%s %s: got %d want %d body %s", method, path, response.StatusCode, want, result)
	}
	return result
}
func decodeAs[T any](t *testing.T, data []byte) T {
	t.Helper()
	var result T
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func TestIntegrationBusinessRules(t *testing.T) {
	connection := os.Getenv("TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("set TEST_DATABASE_URL to a dedicated PostgreSQL test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := database.Migrate(ctx, connection, "../../../../db/migrations"); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	server := httptest.NewServer(api.New(store.New(pool), config.Config{PublicWebURL: "https://abonent.example", CORSOrigins: []string{"http://localhost:8090"}}))
	defer server.Close()
	h := harness{t: t, base: server.URL, client: server.Client()}
	unique := fmt.Sprint(time.Now().UnixNano())
	email := "teacher" + unique + "@example.com"
	teacher := decodeAs[store.Auth](t, h.request("POST", "/auth/register", "", map[string]any{"name": "Учитель", "email": email, "password": "CorrectPass123!"}, 201))
	other := decodeAs[store.Auth](t, h.request("POST", "/auth/register", "", map[string]any{"name": "Другой", "email": "other" + unique + "@example.com", "password": "CorrectPass123!"}, 201))
	defer func() {
		if _, err := pool.Exec(context.Background(), "DELETE FROM clients WHERE user_id=ANY($1::uuid[])", []string{teacher.User.ID, other.User.ID}); err != nil {
			t.Errorf("cleanup clients: %v", err)
		}
		if _, err := pool.Exec(context.Background(), "DELETE FROM users WHERE id=ANY($1::uuid[])", []string{teacher.User.ID, other.User.ID}); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	}()
	h.request("GET", "/health", "", nil, 200)
	h.request("POST", "/auth/register", "", map[string]any{"name": "Учитель", "email": email, "password": "CorrectPass123!"}, 409)
	h.request("POST", "/auth/login", "", map[string]any{"email": email, "password": "WrongPass123!"}, 401)
	login := decodeAs[store.Auth](t, h.request("POST", "/auth/login", "", map[string]any{"email": strings.ToUpper(email), "password": "CorrectPass123!"}, 200))
	if login.User.ID != teacher.User.ID || login.Token == teacher.Token {
		t.Fatal("login result invalid")
	}
	h.request("GET", "/auth/me", teacher.Token, nil, 200)
	client := decodeAs[store.Client](t, h.request("POST", "/clients", teacher.Token, map[string]any{"name": "Клиент", "contact": "secret@example.com"}, 201))
	h.request("PATCH", "/clients/"+client.ID, teacher.Token, map[string]any{"name": "Клиент обновлён", "contact": "private"}, 200)
	updated := decodeAs[store.Client](t, h.request("PATCH", "/clients/"+client.ID, teacher.Token, map[string]any{"name": "Клиент обновлён"}, 200))
	if updated.Contact != "private" {
		t.Fatal("omitted contact was erased")
	}
	cleared := decodeAs[store.Client](t, h.request("PATCH", "/clients/"+client.ID, teacher.Token, map[string]any{"name": "Клиент обновлён", "contact": ""}, 200))
	if cleared.Contact != "" {
		t.Fatal("explicit empty contact was not cleared")
	}
	h.request("GET", "/clients?q=обновлён", teacher.Token, nil, 200)
	foreignClients := decodeAs[struct {
		Items []store.Client `json:"items"`
	}](t, h.request("GET", "/clients", other.Token, nil, 200))
	if len(foreignClients.Items) != 0 {
		t.Fatal("foreign client list leak")
	}
	h.request("GET", "/clients/"+client.ID, other.Token, nil, 404)
	h.request("PATCH", "/clients/"+client.ID, other.Token, map[string]any{"name": "Changed"}, 404)
	p := decodeAs[store.Package](t, h.request("POST", "/clients/"+client.ID+"/packages", teacher.Token, map[string]any{"title": "8 занятий", "totalLessons": 8, "priceKopecks": 1200000}, 201))
	if p.RemainingLessons != 0 || p.PaymentStatus != "pending" {
		t.Fatal("new package is paid")
	}
	h.request("POST", "/clients/"+client.ID+"/packages", other.Token, map[string]any{"title": "Foreign", "totalLessons": 1, "priceKopecks": 0}, 404)
	h.request("GET", "/packages/"+p.ID, other.Token, nil, 404)
	h.request("POST", "/packages/"+p.ID+"/payment", other.Token, map[string]any{}, 404)
	h.request("POST", "/packages/"+p.ID+"/lessons", other.Token, map[string]any{"scheduledAt": "2026-10-24T12:00:00+10:00"}, 404)
	lessons := []store.Lesson{}
	for i := 0; i < 8; i++ {
		lessons = append(lessons, decodeAs[store.Lesson](t, h.request("POST", "/packages/"+p.ID+"/lessons", teacher.Token, map[string]any{"scheduledAt": fmt.Sprintf("2026-10-%02dT12:00:00+10:00", i+1)}, 201)))
	}
	h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "complete"}, 409)
	h.request("PATCH", "/lessons/"+lessons[0].ID, other.Token, map[string]any{"action": "complete"}, 404)
	paid := decodeAs[store.Package](t, h.request("POST", "/packages/"+p.ID+"/payment", teacher.Token, map[string]any{}, 200))
	repeatPaid := decodeAs[store.Package](t, h.request("POST", "/packages/"+p.ID+"/payment", teacher.Token, map[string]any{}, 200))
	if paid.PaidAt == nil || repeatPaid.PaidAt == nil || !paid.PaidAt.Equal(*repeatPaid.PaidAt) || repeatPaid.PaidLessons != 8 {
		t.Fatal("payment was not idempotent")
	}
	for i := 0; i < 5; i++ {
		h.request("PATCH", "/lessons/"+lessons[i].ID, teacher.Token, map[string]any{"action": "complete"}, 200)
	}
	detail := decodeAs[store.Detail](t, h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "complete"}, 200))
	if detail.Package.PaidLessons != 8 || detail.Package.CompletedLessons != 5 || detail.Package.RemainingLessons != 3 {
		t.Fatalf("8-5 !=3: %+v", detail.Package)
	}
	detail = decodeAs[store.Detail](t, h.request("PATCH", "/lessons/"+lessons[5].ID, teacher.Token, map[string]any{"action": "reschedule", "scheduledAt": "2026-12-24T13:00:00+10:00"}, 200))
	if detail.Package.RemainingLessons != 3 {
		t.Fatal("reschedule consumed balance")
	}
	found := false
	for _, l := range detail.Lessons {
		if l.ID == lessons[5].ID {
			found = l.ScheduledAt.Equal(time.Date(2026, 12, 24, 3, 0, 0, 0, time.UTC))
		}
	}
	if !found {
		t.Fatal("reschedule changed ID or ignored timezone")
	}
	h.request("PATCH", "/lessons/"+lessons[6].ID, teacher.Token, map[string]any{"action": "cancel"}, 200)
	detail = decodeAs[store.Detail](t, h.request("PATCH", "/lessons/"+lessons[6].ID, teacher.Token, map[string]any{"action": "cancel"}, 200))
	if detail.Package.RemainingLessons != 3 {
		t.Fatal("cancel consumed balance")
	}
	h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "restore"}, 400)
	h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "restore", "confirmed": true}, 200)
	detail = decodeAs[store.Detail](t, h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "restore", "confirmed": true}, 200))
	if detail.Package.RemainingLessons != 4 {
		t.Fatal("restore was not idempotent")
	}
	h.request("PATCH", "/lessons/"+lessons[0].ID, teacher.Token, map[string]any{"action": "complete"}, 200)
	h.request("POST", "/packages/"+p.ID+"/share-link", other.Token, map[string]any{}, 404)
	share := decodeAs[map[string]string](t, h.request("POST", "/packages/"+p.ID+"/share-link", teacher.Token, map[string]any{}, 201))
	if !strings.HasPrefix(share["url"], "https://abonent.example/s/") {
		t.Fatal("wrong public URL")
	}
	publicBody := h.request("GET", "/public/subscriptions/"+share["token"], "", nil, 200)
	for _, forbidden := range []string{"clientId", "userId", "contact", "private", "password", "Клиент"} {
		if bytes.Contains(publicBody, []byte(forbidden)) {
			t.Fatalf("public information leak: %s", forbidden)
		}
	}
	h.request("GET", "/packages/"+p.ID, share["token"], nil, 401)
	secondShare := decodeAs[map[string]string](t, h.request("POST", "/packages/"+p.ID+"/share-link", teacher.Token, map[string]any{}, 201))
	h.request("GET", "/public/subscriptions/"+share["token"], "", nil, 404)
	h.request("DELETE", "/packages/"+p.ID+"/share-link", teacher.Token, nil, 204)
	h.request("GET", "/public/subscriptions/"+secondShare["token"], "", nil, 404)
	// Two requests racing for the final paid lesson must yield exactly one completion.
	last := decodeAs[store.Package](t, h.request("POST", "/clients/"+client.ID+"/packages", teacher.Token, map[string]any{"title": "Последнее занятие", "totalLessons": 1, "priceKopecks": 0}, 201))
	h.request("POST", "/packages/"+last.ID+"/payment", teacher.Token, map[string]any{}, 200)
	raceLessons := []store.Lesson{}
	for i := 0; i < 2; i++ {
		raceLessons = append(raceLessons, decodeAs[store.Lesson](t, h.request("POST", "/packages/"+last.ID+"/lessons", teacher.Token, map[string]any{"scheduledAt": "2026-10-24T12:00:00+10:00"}, 201)))
	}
	start := make(chan struct{})
	statuses := make(chan int, 2)
	failures := make(chan error, 2)
	var wg sync.WaitGroup
	for _, lesson := range raceLessons {
		wg.Add(1)
		go func(l store.Lesson) {
			defer wg.Done()
			<-start
			r, err := http.NewRequest("PATCH", server.URL+"/api/v1/lessons/"+l.ID, strings.NewReader(`{"action":"complete"}`))
			if err != nil {
				failures <- err
				return
			}
			r.Header.Set("Authorization", "Bearer "+teacher.Token)
			r.Header.Set("Content-Type", "application/json")
			response, err := h.client.Do(r)
			if err != nil {
				failures <- err
				return
			}
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			statuses <- response.StatusCode
		}(lesson)
	}
	close(start)
	wg.Wait()
	close(statuses)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent completions: %v", counts)
	}
	lastDetail := decodeAs[store.Detail](t, h.request("GET", "/packages/"+last.ID, teacher.Token, nil, 200))
	if lastDetail.Package.CompletedLessons != 1 || lastDetail.Package.RemainingLessons != 0 {
		t.Fatal("race overdrawn balance")
	}
	var paymentCount, completeCount int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM payment_audit WHERE package_id=$1", p.ID).Scan(&paymentCount); err != nil {
		t.Fatal(err)
	}
	if paymentCount != 1 {
		t.Fatal("payment audit duplicated")
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM lesson_audit WHERE lesson_id=$1 AND action='complete'", lessons[0].ID).Scan(&completeCount); err != nil {
		t.Fatal(err)
	}
	if completeCount != 2 {
		t.Fatalf("expected original+restored completion audits, got %d", completeCount)
	}
	// Reconstructing the server from the same database must retain the authoritative count.
	restarted := httptest.NewServer(api.New(store.New(pool), config.Config{PublicWebURL: "https://abonent.example"}))
	h2 := harness{t: t, base: restarted.URL, client: restarted.Client()}
	persistent := decodeAs[store.Detail](t, h2.request("GET", "/packages/"+p.ID, teacher.Token, nil, 200))
	restarted.Close()
	if persistent.Package.RemainingLessons != 3 {
		t.Fatal("state not persisted")
	}
	h.request("POST", "/auth/logout", teacher.Token, nil, 204)
	h.request("GET", "/auth/me", teacher.Token, nil, 401)
	h.request("GET", "/auth/me", login.Token, nil, 200)
	var digestSize int
	if err := pool.QueryRow(ctx, "SELECT octet_length(token_hash) FROM sessions WHERE token_hash=$1", auth.TokenHash(login.Token)).Scan(&digestSize); err != nil || digestSize != 32 {
		t.Fatalf("session token hash storage: size=%d err=%v", digestSize, err)
	}
	if _, err := pool.Exec(ctx, "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", auth.TokenHash(login.Token)); err != nil {
		t.Fatal(err)
	}
	h.request("GET", "/auth/me", login.Token, nil, 401)
}
