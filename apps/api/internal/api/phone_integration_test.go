package api_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"abonent/api/internal/api"
	"abonent/api/internal/config"
	"abonent/api/internal/database"
	"abonent/api/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestIntegrationPhoneNumbers(t *testing.T) {
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
	s := store.New(pool)
	server := httptest.NewServer(api.New(s, config.Config{PublicWebURL: "https://abonent.example"}))
	defer server.Close()
	h := harness{t: t, base: server.URL, client: server.Client()}
	teacher := decodeAs[store.Auth](t, h.request("POST", "/auth/register", "", map[string]any{
		"name": "Телефон QA", "email": fmt.Sprintf("phone-%d@example.com", time.Now().UnixNano()), "password": "PhoneTestPass123!",
	}, 201))
	defer func() {
		if _, err := pool.Exec(context.Background(), "DELETE FROM clients WHERE user_id=$1", teacher.User.ID); err != nil {
			t.Errorf("cleanup clients: %v", err)
		}
		if _, err := pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", teacher.User.ID); err != nil {
			t.Errorf("cleanup account: %v", err)
		}
	}()
	legacy, err := s.CreateClient(ctx, teacher.User.ID, "Клиент без телефона", "legacy@example.com")
	if err != nil || legacy.Phone != "" || legacy.Contact != "legacy@example.com" {
		t.Fatal("legacy store calls must retain freeform contact and default empty phone")
	}
	noPhone := decodeAs[store.Client](t, h.request("POST", "/clients", teacher.Token, map[string]any{"name": "Email", "contact": "email@example.com"}, 201))
	if noPhone.Phone != "" || noPhone.Contact != "email@example.com" {
		t.Fatal("legacy API payload must retain email contact and default empty phone")
	}
	client := decodeAs[store.Client](t, h.request("POST", "/clients", teacher.Token, map[string]any{
		"name": "Клиент с телефоном", "contact": "phone-test@example.com", "phone": "8 (999) 123-45-67",
	}, 201))
	if client.Phone != "+79991234567" || client.Contact != "phone-test@example.com" {
		t.Fatal("create must normalize phone and preserve the independent contact")
	}
	path := "/clients/" + client.ID
	for _, body := range []map[string]any{
		{"name": "Новое имя"},
		{"name": "Новое имя", "contact": ""},
	} {
		updated := decodeAs[store.Client](t, h.request("PATCH", path, teacher.Token, body, 200))
		if updated.Phone != "+79991234567" {
			t.Fatal("omitting phone must preserve it")
		}
	}
	for _, input := range []string{"9991234567", "7 999 123 45 67", "+7 (999) 123-45-67"} {
		updated := decodeAs[store.Client](t, h.request("PATCH", path, teacher.Token, map[string]any{"name": "Новое имя", "phone": input}, 200))
		if updated.Phone != "+79991234567" {
			t.Fatal("patch must normalize every accepted phone format")
		}
	}
	list := decodeAs[struct {
		Items []store.Client `json:"items"`
	}](t, h.request("GET", "/clients?q=9991234567", teacher.Token, nil, 200))
	if len(list.Items) != 1 || list.Items[0].ID != client.ID {
		t.Fatal("normalized phone must be searchable")
	}
	for _, invalid := range []any{
		"+7 (701) 123-45-67", "+7 (601) 123-45-67", "+1 999 123 45 67", "+8 999 123 45 67",
		"7999123456", "799912345678", "2991234567", "телефон 89991234567", "89991234567 доб. 1",
		"++79991234567", "7+9991234567", "8.999.123.45.67", "+79991234567\x00",
		"+79991234567\n", "+79991234567\r", "\t+79991234567", "+７９９９１２３４５６７", "()-", "+", nil, 79991234567, true, []any{},
	} {
		body := map[string]any{"name": "Некорректный номер", "phone": invalid}
		h.request("POST", "/clients", teacher.Token, body, 400)
		h.request("PATCH", path, teacher.Token, body, 400)
	}
	detail := decodeAs[store.ClientDetail](t, h.request("GET", path, teacher.Token, nil, 200))
	if detail.Client.Phone != "+79991234567" || detail.Client.Name != "Новое имя" {
		t.Fatal("failed validation must not modify the existing client")
	}
	// The database is a second line of defense for non-HTTP writers.
	for _, invalid := range []string{"89991234567", "+77011234567", "+79991234567\n", "invalid"} {
		_, err := pool.Exec(ctx, "UPDATE clients SET phone=$2 WHERE id=$1", client.ID, invalid)
		var pgError *pgconn.PgError
		if !errors.As(err, &pgError) || pgError.Code != "23514" || pgError.ConstraintName != "clients_phone_format" {
			t.Fatal("database must reject a noncanonical or non-Russian phone")
		}
	}
	p := decodeAs[store.Package](t, h.request("POST", path+"/packages", teacher.Token, map[string]any{"title": "QA", "totalLessons": 1, "priceKopecks": 0}, 201))
	share := decodeAs[map[string]string](t, h.request("POST", "/packages/"+p.ID+"/share-link", teacher.Token, map[string]any{}, 201))
	publicBody := h.request("GET", "/public/subscriptions/"+share["token"], "", nil, 200)
	for _, forbidden := range []string{"phone", "+79991234567", "contact", "Новое имя"} {
		if bytes.Contains(publicBody, []byte(forbidden)) {
			t.Fatal("public subscription must not expose private client fields")
		}
	}
	cleared := decodeAs[store.Client](t, h.request("PATCH", path, teacher.Token, map[string]any{"name": "Новое имя", "phone": ""}, 200))
	if cleared.Phone != "" {
		t.Fatal("an explicit empty string must clear the phone")
	}
}
