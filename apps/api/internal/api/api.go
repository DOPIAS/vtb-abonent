package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/mail"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"abonent/api/internal/auth"
	"abonent/api/internal/config"
	"abonent/api/internal/store"
)

type API struct {
	store     *store.Store
	publicURL string
	origins   map[string]bool
	dummyHash string
}
type requestUserKey struct{}

func New(s *store.Store, c config.Config) http.Handler {
	dummy, _ := auth.HashPassword("unusable-dummy-password")
	a := &API{store: s, publicURL: strings.TrimRight(c.PublicWebURL, "/"), origins: map[string]bool{}, dummyHash: dummy}
	for _, origin := range c.CORSOrigins {
		a.origins[origin] = true
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /api/v1/health", a.health)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("GET /api/v1/public/subscriptions/{token}", a.public)
	mux.Handle("GET /api/v1/auth/me", a.protect(a.me))
	mux.Handle("POST /api/v1/auth/logout", a.protect(a.logout))
	mux.Handle("GET /api/v1/dashboard", a.protect(a.dashboard))
	mux.Handle("GET /api/v1/clients", a.protect(a.clients))
	mux.Handle("POST /api/v1/clients", a.protect(a.createClient))
	mux.Handle("GET /api/v1/clients/{id}", a.protect(a.client))
	mux.Handle("PATCH /api/v1/clients/{id}", a.protect(a.updateClient))
	mux.Handle("POST /api/v1/clients/{id}/packages", a.protect(a.createPackage))
	mux.Handle("GET /api/v1/packages/{id}", a.protect(a.packageDetail))
	mux.Handle("POST /api/v1/packages/{id}/payment", a.protect(a.payment))
	mux.Handle("POST /api/v1/packages/{id}/lessons", a.protect(a.createLesson))
	mux.Handle("PATCH /api/v1/lessons/{id}", a.protect(a.changeLesson))
	mux.Handle("POST /api/v1/packages/{id}/share-link", a.protect(a.share))
	mux.Handle("DELETE /api/v1/packages/{id}/share-link", a.protect(a.revokeShare))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, 404, "not_found", "Ресурс не найден")
	})
	return a.middleware(mux)
}
func (a *API) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); origin != "" && a.origins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			if origin := r.Header.Get("Origin"); origin != "" && !a.origins[origin] {
				fail(w, 400, "validation_error", "Источник запроса не разрешён")
				return
			}
			w.WriteHeader(204)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		defer func() {
			if recover() != nil {
				fail(w, 500, "internal_error", "Внутренняя ошибка сервера")
			}
		}()
		if !limitBody(w, r) {
			return
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Read at most one byte beyond the application limit before dispatching. Rejecting
// from Content-Length alone leaves a large unread upload: HTTP/1 then closes the
// socket before clients that finish writing first can receive the JSON response.
func limitBody(w http.ResponseWriter, r *http.Request) bool {
	const maxBody = 1 << 20
	original := r.Body
	defer original.Close()
	data, err := io.ReadAll(io.LimitReader(original, maxBody+1))
	if err != nil {
		w.Header().Set("Connection", "close")
		fail(w, 400, "validation_error", "Не удалось прочитать тело запроса")
		return false
	}
	if len(data) > maxBody {
		// A small overshoot can be drained safely, allowing the error response to
		// arrive without a TCP reset. Bound both bytes and time for hostile uploads.
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		_, drainErr := io.CopyN(io.Discard, original, (64<<10)+1)
		if !errors.Is(drainErr, io.EOF) {
			w.Header().Set("Connection", "close")
		}
		fail(w, 400, "validation_error", "Тело запроса превышает 1 MiB")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(data))
	return true
}
func (a *API) protect(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearer(r)
		if !auth.ValidToken(token) {
			fail(w, 401, "unauthorized", "Войдите в аккаунт")
			return
		}
		u, err := a.store.Session(r.Context(), token)
		if errors.Is(err, store.ErrNotFound) {
			fail(w, 401, "unauthorized", "Сессия завершена. Войдите снова")
			return
		}
		if err != nil {
			respondError(w, err)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), requestUserKey{}, u)))
	})
}
func bearer(r *http.Request) string {
	value := r.Header.Get("Authorization")
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}
func userID(r *http.Request) string { return r.Context().Value(requestUserKey{}).(store.User).ID }
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func respondError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		fail(w, 404, "not_found", "Ресурс не найден")
	case errors.Is(err, store.ErrConflict):
		fail(w, 409, "conflict", "Действие недоступно в текущем состоянии или данные уже существуют")
	case errors.Is(err, store.ErrPaymentRequired):
		fail(w, 409, "payment_required", "Сначала подтвердите полную оплату пакета")
	case errors.Is(err, store.ErrInsufficientBalance):
		fail(w, 409, "insufficient_balance", "В пакете не осталось оплаченных занятий")
	case errors.Is(err, store.ErrConfirmationRequired):
		fail(w, 400, "validation_error", "Подтвердите исправление проведённого занятия")
	default:
		fail(w, 500, "internal_error", "Внутренняя ошибка сервера")
	}
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if content := r.Header.Get("Content-Type"); content != "" {
		mediaType, _, err := mime.ParseMediaType(content)
		if err != nil || mediaType != "application/json" {
			fail(w, 400, "validation_error", "Ожидается JSON")
			return false
		}
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		fail(w, 400, "validation_error", "Тело запроса слишком велико или не прочитано")
		return false
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '{' || !utf8.Valid(data) {
		fail(w, 400, "validation_error", "Ожидается JSON-объект")
		return false
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		fail(w, 400, "validation_error", "Некорректный JSON")
		return false
	}
	allowed := map[string]bool{}
	objectType := reflect.TypeOf(target).Elem()
	for index := 0; index < objectType.NumField(); index++ {
		allowed[strings.Split(objectType.Field(index).Tag.Get("json"), ",")[0]] = true
	}
	for field, value := range fields {
		if !allowed[field] {
			fail(w, 400, "validation_error", "Неизвестные поля JSON")
			return false
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			fail(w, 400, "validation_error", "Значения null не разрешены")
			return false
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(target); err != nil {
		fail(w, 400, "validation_error", "Некорректные поля JSON")
		return false
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		fail(w, 400, "validation_error", "Ожидается один JSON-объект")
		return false
	}
	return true
}
func emptyBody(w http.ResponseWriter, r *http.Request) bool { return decode(w, r, &struct{}{}) }
func id(w http.ResponseWriter, r *http.Request) (string, bool) {
	value := r.PathValue("id")
	if auth.ValidateUUID(value) != nil {
		fail(w, 404, "not_found", "Ресурс не найден")
		return "", false
	}
	return value, true
}
func validName(value string) bool {
	return utf8.ValidString(value) && !strings.ContainsRune(value, '\x00') && utf8.RuneCountInString(value) >= 1 && utf8.RuneCountInString(value) <= 120
}
func validEmail(value string) bool {
	if len(value) > 254 {
		return false
	}
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value && strings.Contains(value, "@") && !strings.ContainsAny(value, "\r\n ")
}
func bad(w http.ResponseWriter, message string) { fail(w, 400, "validation_error", message) }
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if a.store == nil || a.store.Pool == nil {
		fail(w, 500, "internal_error", "База данных недоступна")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.Pool.Ping(ctx); err != nil {
		fail(w, 500, "internal_error", "База данных недоступна")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if !validName(body.Name) || !validEmail(body.Email) || !utf8.ValidString(body.Password) || utf8.RuneCountInString(body.Password) < 10 || utf8.RuneCountInString(body.Password) > 128 {
		bad(w, "Введите имя (1–120 символов), email и пароль (10–128 символов)")
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		respondError(w, err)
		return
	}
	result, err := a.store.Register(r.Context(), body.Name, body.Email, hash)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 201, result)
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(body.Email) || !utf8.ValidString(body.Password) || utf8.RuneCountInString(body.Password) > 128 || body.Password == "" {
		bad(w, "Введите email и пароль")
		return
	}
	u, hash, err := a.store.Credentials(r.Context(), body.Email)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		respondError(w, err)
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		hash = a.dummyHash
	}
	if !auth.VerifyPassword(body.Password, hash) || errors.Is(err, store.ErrNotFound) {
		fail(w, 401, "unauthorized", "Неверный email или пароль")
		return
	}
	result, err := a.store.CreateSession(r.Context(), u)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *API) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, r.Context().Value(requestUserKey{}).(store.User))
}
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Logout(r.Context(), bearer(r)); err != nil {
		respondError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (a *API) clients(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if !utf8.ValidString(q) || strings.ContainsRune(q, '\x00') || utf8.RuneCountInString(q) > 250 {
		bad(w, "Поиск — до 250 символов")
		return
	}
	result, err := a.store.Clients(r.Context(), userID(r), q)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": result})
}

type clientBody struct {
	Name    string  `json:"name"`
	Contact *string `json:"contact"`
	Phone   *string `json:"phone"`
}

func clientInput(w http.ResponseWriter, r *http.Request) (clientBody, bool) {
	var body clientBody
	if !decode(w, r, &body) {
		return body, false
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Contact != nil {
		contact := strings.TrimSpace(*body.Contact)
		body.Contact = &contact
	}
	if !validName(body.Name) || (body.Contact != nil && (!utf8.ValidString(*body.Contact) || strings.ContainsRune(*body.Contact, '\x00') || utf8.RuneCountInString(*body.Contact) > 250)) {
		bad(w, "Введите имя (1–120 символов) и контакт до 250 символов")
		return body, false
	}
	if body.Phone != nil {
		phone, ok := normalizeRussianPhone(*body.Phone)
		if !ok {
			bad(w, "Введите российский номер: +7 (999) 123-45-67")
			return body, false
		}
		body.Phone = &phone
	}
	return body, true
}
func (a *API) createClient(w http.ResponseWriter, r *http.Request) {
	body, ok := clientInput(w, r)
	if !ok {
		return
	}
	contact := ""
	if body.Contact != nil {
		contact = *body.Contact
	}
	phone := ""
	if body.Phone != nil {
		phone = *body.Phone
	}
	result, err := a.store.CreateClient(r.Context(), userID(r), body.Name, contact, phone)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 201, result)
}
func (a *API) updateClient(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	body, ok := clientInput(w, r)
	if !ok {
		return
	}
	result, err := a.store.UpdateClient(r.Context(), userID(r), value, body.Name, body.Contact, body.Phone)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *API) client(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	result, err := a.store.ClientDetail(r.Context(), userID(r), value)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *API) createPackage(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	var body struct {
		Title        string `json:"title"`
		TotalLessons *int   `json:"totalLessons"`
		PriceKopecks *int64 `json:"priceKopecks"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	if !validName(body.Title) || body.TotalLessons == nil || *body.TotalLessons < 1 || *body.TotalLessons > 1000 || body.PriceKopecks == nil || *body.PriceKopecks < 0 || *body.PriceKopecks > 1000000000 {
		bad(w, "Название — 1–120 символов, занятия — 1–1000, стоимость — 0–1000000000 копеек")
		return
	}
	result, err := a.store.CreatePackage(r.Context(), userID(r), value, body.Title, *body.TotalLessons, *body.PriceKopecks)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 201, result)
}
func (a *API) packageDetail(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	result, err := a.store.Detail(r.Context(), userID(r), value)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *API) payment(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok || !emptyBody(w, r) {
		return
	}
	result, err := a.store.Payment(r.Context(), userID(r), value)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}

var dateTimePattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$`)

func parseTime(value string) (time.Time, error) {
	if !dateTimePattern.MatchString(value) {
		return time.Time{}, errors.New("invalid RFC3339 timestamp")
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err == nil && (t.Year() < 1 || t.Year() > 9999) {
		err = errors.New("year out of range")
	}
	return t.UTC(), err
}
func (a *API) createLesson(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	var body struct {
		ScheduledAt string `json:"scheduledAt"`
	}
	if !decode(w, r, &body) {
		return
	}
	scheduled, err := parseTime(body.ScheduledAt)
	if err != nil {
		bad(w, "Укажите дату и время RFC3339 с часовым поясом")
		return
	}
	result, err := a.store.CreateLesson(r.Context(), userID(r), value, scheduled)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 201, result)
}
func (a *API) changeLesson(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	var body struct {
		Action      string  `json:"action"`
		ScheduledAt *string `json:"scheduledAt"`
		Confirmed   *bool   `json:"confirmed"`
	}
	if !decode(w, r, &body) {
		return
	}
	change := store.LessonChange{Action: body.Action}
	switch body.Action {
	case "complete", "cancel":
		if body.ScheduledAt != nil || body.Confirmed != nil {
			bad(w, "У действия лишние параметры")
			return
		}
	case "restore":
		if body.Confirmed == nil || !*body.Confirmed || body.ScheduledAt != nil {
			bad(w, "Подтвердите исправление: confirmed=true")
			return
		}
		change.Confirmed = true
	case "reschedule":
		if body.ScheduledAt == nil || body.Confirmed != nil {
			bad(w, "Для переноса укажите scheduledAt")
			return
		}
		scheduled, err := parseTime(*body.ScheduledAt)
		if err != nil {
			bad(w, "Укажите дату и время RFC3339 с часовым поясом")
			return
		}
		change.ScheduledAt = &scheduled
	default:
		bad(w, "Неизвестное действие")
		return
	}
	result, err := a.store.ChangeLesson(r.Context(), userID(r), value, change)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *API) share(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok || !emptyBody(w, r) {
		return
	}
	token, err := a.store.Share(r.Context(), userID(r), value)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"url": a.publicURL + "/s/" + token, "token": token})
}
func (a *API) revokeShare(w http.ResponseWriter, r *http.Request) {
	value, ok := id(w, r)
	if !ok {
		return
	}
	if err := a.store.RevokeShare(r.Context(), userID(r), value); err != nil {
		respondError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (a *API) public(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if !auth.ValidToken(token) {
		fail(w, 404, "not_found", "Ссылка недействительна или отозвана")
		return
	}
	result, err := a.store.PublicDetail(r.Context(), token)
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
