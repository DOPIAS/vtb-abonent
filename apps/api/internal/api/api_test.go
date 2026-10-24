package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"abonent/api/internal/config"
)

// Write the complete upload before reading, as urllib/http.client does. A
// ResponseRecorder or Go's concurrent Transport cannot reproduce the TCP reset.
func TestOversizeBodyReturnsJSONOverTCP(t *testing.T) {
	server := httptest.NewServer(New(nil, config.Config{CORSOrigins: []string{"https://trusted.example"}}))
	defer server.Close()
	payload := append([]byte(`{"name":"`), bytes.Repeat([]byte("x"), 1<<20)...)
	payload = append(payload, []byte(`"}`)...)
	for _, chunked := range []bool{false, true} {
		for attempt := 0; attempt < 10; attempt++ {
			connection, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 5*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
			request, err := http.NewRequest("POST", server.URL+"/api/v1/auth/register", bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			if chunked {
				request.ContentLength = -1
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://trusted.example")
			if err := request.Write(connection); err != nil {
				connection.Close()
				t.Fatalf("write upload (chunked=%v): %v", chunked, err)
			}
			response, err := http.ReadResponse(bufio.NewReader(connection), request)
			if err != nil {
				connection.Close()
				t.Fatalf("read response (chunked=%v): %v", chunked, err)
			}
			data, err := io.ReadAll(response.Body)
			response.Body.Close()
			connection.Close()
			if err != nil {
				t.Fatal(err)
			}
			var failure struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(data, &failure); err != nil || response.StatusCode != 400 || failure.Error.Code != "validation_error" {
				t.Fatalf("oversized body response: HTTP %d %q (%v)", response.StatusCode, data, err)
			}
			if response.Header.Get("Access-Control-Allow-Origin") != "https://trusted.example" {
				t.Fatal("oversize response lost trusted CORS header")
			}
		}
	}
}

func TestStrictJSON(t *testing.T) {
	for _, body := range []string{"", "null", "[]", `{"name":null}`, `{"Name":"a"}`, `{"name":"a","extra":1}`, `{"name":"a"} {}`, `{"name":2}`, strings.Repeat("a", (1<<20)+1)} {
		t.Run(body[:min(len(body), 30)], func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			w := httptest.NewRecorder()
			var target struct {
				Name string `json:"name"`
			}
			if decode(w, r, &target) || w.Code != 400 {
				t.Fatalf("accepted invalid body: %d", w.Code)
			}
		})
	}
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"Анна"}`))
	w := httptest.NewRecorder()
	var target struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &target) || target.Name != "Анна" {
		t.Fatal("rejected valid JSON")
	}
}
func TestCORSAndAuth(t *testing.T) {
	handler := New(nil, config.Config{CORSOrigins: []string{"https://trusted.example"}})
	for _, origin := range []string{"https://trusted.example", "https://evil.example"} {
		r := httptest.NewRequest(http.MethodOptions, "/api/v1/clients", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if origin == "https://trusted.example" {
			if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != origin || !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
				t.Fatal("trusted CORS failed")
			}
		} else if w.Header().Get("Access-Control-Allow-Origin") != "" || w.Code != 400 {
			t.Fatal("untrusted CORS allowed")
		}
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/clients", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("authentication or privacy headers failed")
	}
}
func TestDateAndEmailValidation(t *testing.T) {
	for _, invalid := range []string{"2026-10-24", "2026-10-24T12:00:00", "0000-01-01T00:00:00Z", "2026-10-24T2:00:00Z", "2026-10-24T12:00:00+24:00", "2026-10-24T12:00:00+00:60", "today"} {
		if _, err := parseTime(invalid); err == nil {
			t.Fatalf("accepted invalid time %s", invalid)
		}
	}
	parsed, err := parseTime("2026-10-24T12:00:00+10:00")
	if err != nil || parsed.Format("15:04Z") != "02:00Z" {
		t.Fatal("timezone was not respected")
	}
	for _, invalid := range []string{"", "Person <person@example.com>", "a@", "a b@example.com"} {
		if validEmail(invalid) {
			t.Fatalf("accepted invalid email %s", invalid)
		}
	}
	if !validEmail("demo@abonent.local") {
		t.Fatal("demo email rejected")
	}
}
