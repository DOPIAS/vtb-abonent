package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"abonent/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }
type querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func New(pool *pgxpool.Pool) *Store { return &Store{Pool: pool} }
func normalizeError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var e *pgconn.PgError
	if errors.As(err, &e) && e.Code == "23505" {
		return ErrConflict
	}
	return err
}
func (s *Store) Register(ctx context.Context, name, email, passwordHash string) (Auth, error) {
	var result Auth
	id, err := auth.UUID()
	if err != nil {
		return result, err
	}
	token, err := auth.Token()
	if err != nil {
		return result, err
	}
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)", id, name, email, passwordHash)
	if err != nil {
		return result, normalizeError(err)
	}
	_, err = tx.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", auth.TokenHash(token), id, expires)
	if err != nil {
		return result, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	return Auth{Token: token, ExpiresAt: expires, User: User{ID: id, Name: name, Email: email}}, nil
}
func (s *Store) Credentials(ctx context.Context, email string) (User, string, error) {
	var u User
	var hash string
	err := s.Pool.QueryRow(ctx, "SELECT id::text,name,email,password_hash FROM users WHERE email=$1", email).Scan(&u.ID, &u.Name, &u.Email, &hash)
	return u, hash, normalizeError(err)
}
func (s *Store) Session(ctx context.Context, token string) (User, error) {
	var u User
	err := s.Pool.QueryRow(ctx, "SELECT u.id::text,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", auth.TokenHash(token)).Scan(&u.ID, &u.Name, &u.Email)
	return u, normalizeError(err)
}
func (s *Store) CreateSession(ctx context.Context, u User) (Auth, error) {
	var result Auth
	token, err := auth.Token()
	if err != nil {
		return result, err
	}
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	_, err = s.Pool.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", auth.TokenHash(token), u.ID, expires)
	if err != nil {
		return result, err
	}
	return Auth{Token: token, ExpiresAt: expires, User: u}, nil
}
func (s *Store) Logout(ctx context.Context, token string) error {
	_, err := s.Pool.Exec(ctx, "DELETE FROM sessions WHERE token_hash=$1", auth.TokenHash(token))
	return err
}
func scanClient(row pgx.Row) (Client, error) {
	var c Client
	err := row.Scan(&c.ID, &c.Name, &c.Contact, &c.Phone, &c.CreatedAt)
	c.CreatedAt = c.CreatedAt.UTC()
	return c, normalizeError(err)
}

const clientCols = "id::text,name,contact,phone,created_at"

func (s *Store) Clients(ctx context.Context, owner, q string) ([]Client, error) {
	// Treat search text literally, including SQL wildcard characters.
	q = strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
	rows, err := s.Pool.Query(ctx, "SELECT "+clientCols+" FROM clients WHERE user_id=$1 AND (name ILIKE $2 OR contact ILIKE $2 OR phone ILIKE $2) ORDER BY created_at DESC,id", owner, "%"+q+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Store) CreateClient(ctx context.Context, owner, name, contact string, phones ...string) (Client, error) {
	id, err := auth.UUID()
	if err != nil {
		return Client{}, err
	}
	phone := ""
	if len(phones) > 0 {
		phone = phones[0]
	}
	return scanClient(s.Pool.QueryRow(ctx, "INSERT INTO clients(id,user_id,name,contact,phone) VALUES($1,$2,$3,$4,$5) RETURNING "+clientCols, id, owner, name, contact, phone))
}
func (s *Store) UpdateClient(ctx context.Context, owner, id, name string, contact *string, phones ...*string) (Client, error) {
	var phone *string
	if len(phones) > 0 {
		phone = phones[0]
	}
	return scanClient(s.Pool.QueryRow(ctx, "UPDATE clients SET name=$3,contact=COALESCE($4,contact),phone=COALESCE($5,phone) WHERE id=$1 AND user_id=$2 RETURNING "+clientCols, id, owner, name, contact, phone))
}

const packageCols = `p.id::text,p.client_id::text,p.title,p.total_lessons,p.price_kopecks,p.payment_status,
 CASE WHEN p.payment_status='paid' THEN p.total_lessons ELSE 0 END,
 (SELECT count(*)::integer FROM lessons l WHERE l.package_id=p.id AND l.status='completed'),
 (CASE WHEN p.payment_status='paid' THEN p.total_lessons ELSE 0 END)-(SELECT count(*)::integer FROM lessons l WHERE l.package_id=p.id AND l.status='completed'),
 p.paid_at,p.created_at`

func scanPackage(row pgx.Row) (Package, error) {
	var p Package
	err := row.Scan(&p.ID, &p.ClientID, &p.Title, &p.TotalLessons, &p.PriceKopecks, &p.PaymentStatus, &p.PaidLessons, &p.CompletedLessons, &p.RemainingLessons, &p.PaidAt, &p.CreatedAt)
	p.CreatedAt = p.CreatedAt.UTC()
	if p.PaidAt != nil {
		t := p.PaidAt.UTC()
		p.PaidAt = &t
	}
	return p, normalizeError(err)
}
func getPackage(ctx context.Context, q querier, id string) (Package, error) {
	return scanPackage(q.QueryRow(ctx, "SELECT "+packageCols+" FROM packages p WHERE p.id=$1", id))
}
func (s *Store) ClientDetail(ctx context.Context, owner, id string) (ClientDetail, error) {
	result := ClientDetail{Packages: []Package{}}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	result.Client, err = scanClient(tx.QueryRow(ctx, "SELECT "+clientCols+" FROM clients WHERE id=$1 AND user_id=$2", id, owner))
	if err != nil {
		return result, err
	}
	rows, err := tx.Query(ctx, "SELECT "+packageCols+" FROM packages p WHERE p.client_id=$1 ORDER BY p.created_at DESC,p.id", id)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		p, err := scanPackage(rows)
		if err != nil {
			rows.Close()
			return result, err
		}
		result.Packages = append(result.Packages, p)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func (s *Store) CreatePackage(ctx context.Context, owner, clientID, title string, total int, price int64) (Package, error) {
	id, err := auth.UUID()
	if err != nil {
		return Package{}, err
	}
	return scanPackage(s.Pool.QueryRow(ctx, `WITH inserted AS (INSERT INTO packages(id,client_id,title,total_lessons,price_kopecks) SELECT $1,c.id,$4,$5,$6 FROM clients c WHERE c.id=$2 AND c.user_id=$3 RETURNING *) SELECT `+packageCols+` FROM inserted p`, id, clientID, owner, title, total, price))
}
func scanLesson(row pgx.Row) (Lesson, error) {
	var l Lesson
	err := row.Scan(&l.ID, &l.PackageID, &l.ScheduledAt, &l.Status, &l.UpdatedAt)
	l.ScheduledAt = l.ScheduledAt.UTC()
	l.UpdatedAt = l.UpdatedAt.UTC()
	return l, normalizeError(err)
}

const lessonCols = "id::text,package_id::text,scheduled_at,status,updated_at"

func getDetail(ctx context.Context, q querier, id string) (Detail, error) {
	result := Detail{Lessons: []Lesson{}}
	var err error
	result.Package, err = getPackage(ctx, q, id)
	if err != nil {
		return result, err
	}
	rows, err := q.Query(ctx, "SELECT "+lessonCols+" FROM lessons WHERE package_id=$1 ORDER BY scheduled_at,id", id)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return result, err
		}
		result.Lessons = append(result.Lessons, l)
	}
	return result, rows.Err()
}
func (s *Store) Detail(ctx context.Context, owner, id string) (Detail, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	var found string
	err = tx.QueryRow(ctx, "SELECT p.id::text FROM packages p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.user_id=$2", id, owner).Scan(&found)
	if err != nil {
		return Detail{}, normalizeError(err)
	}
	result, err := getDetail(ctx, tx, id)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

// Every package writer obtains this same row lock before touching lessons or links.
func lockPackage(ctx context.Context, tx pgx.Tx, owner, id string) error {
	var found string
	return normalizeError(tx.QueryRow(ctx, "SELECT p.id::text FROM packages p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.user_id=$2 FOR UPDATE OF p", id, owner).Scan(&found))
}
func (s *Store) Payment(ctx context.Context, owner, id string) (Package, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Package{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockPackage(ctx, tx, owner, id); err != nil {
		return Package{}, err
	}
	tag, err := tx.Exec(ctx, "UPDATE packages SET payment_status='paid',paid_at=now(),paid_by=$2 WHERE id=$1 AND payment_status='pending'", id, owner)
	if err != nil {
		return Package{}, err
	}
	if tag.RowsAffected() > 0 {
		_, err = tx.Exec(ctx, "INSERT INTO payment_audit(package_id,actor_id) VALUES($1,$2)", id, owner)
		if err != nil {
			return Package{}, err
		}
	}
	result, err := getPackage(ctx, tx, id)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func (s *Store) CreateLesson(ctx context.Context, owner, packageID string, scheduled time.Time) (Lesson, error) {
	id, err := auth.UUID()
	if err != nil {
		return Lesson{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Lesson{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockPackage(ctx, tx, owner, packageID); err != nil {
		return Lesson{}, err
	}
	result, err := scanLesson(tx.QueryRow(ctx, "INSERT INTO lessons(id,package_id,scheduled_at,updated_by) VALUES($1,$2,$3,$4) RETURNING "+lessonCols, id, packageID, scheduled, owner))
	if err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, "INSERT INTO lesson_audit(lesson_id,actor_id,action,to_status,scheduled_at) VALUES($1,$2,'schedule','scheduled',$3)", id, owner, scheduled)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func (s *Store) ChangeLesson(ctx context.Context, owner, id string, change LessonChange) (Detail, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	var packageID string
	// Discover the parent without locking a child, then acquire the parent first.
	err = tx.QueryRow(ctx, "SELECT p.id::text FROM lessons l JOIN packages p ON p.id=l.package_id JOIN clients c ON c.id=p.client_id WHERE l.id=$1 AND c.user_id=$2", id, owner).Scan(&packageID)
	if err != nil {
		return Detail{}, normalizeError(err)
	}
	if err = lockPackage(ctx, tx, owner, packageID); err != nil {
		return Detail{}, err
	}
	lesson, err := scanLesson(tx.QueryRow(ctx, "SELECT "+lessonCols+" FROM lessons WHERE id=$1 FOR UPDATE", id))
	if err != nil {
		return Detail{}, err
	}
	p, err := getPackage(ctx, tx, packageID)
	if err != nil {
		return Detail{}, err
	}
	status, changed, err := nextStatus(lesson.Status, change, p.PaymentStatus == "paid", p.RemainingLessons)
	if err != nil {
		return Detail{}, err
	}
	if changed {
		scheduled := lesson.ScheduledAt
		if change.Action == "reschedule" {
			scheduled = *change.ScheduledAt
		}
		_, err = tx.Exec(ctx, "UPDATE lessons SET status=$2,scheduled_at=$3,updated_at=now(),updated_by=$4 WHERE id=$1", id, status, scheduled, owner)
		if err != nil {
			return Detail{}, err
		}
		_, err = tx.Exec(ctx, "INSERT INTO lesson_audit(lesson_id,actor_id,action,from_status,to_status,previous_scheduled_at,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,$7)", id, owner, change.Action, lesson.Status, status, lesson.ScheduledAt, scheduled)
		if err != nil {
			return Detail{}, err
		}
	}
	result, err := getDetail(ctx, tx, packageID)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func (s *Store) Share(ctx context.Context, owner, id string) (string, error) {
	token, err := auth.Token()
	if err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err = lockPackage(ctx, tx, owner, id); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, "DELETE FROM share_links WHERE package_id=$1", id)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, "INSERT INTO share_links(token_hash,package_id,created_by) VALUES($1,$2,$3)", auth.TokenHash(token), id, owner)
	if err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}
func (s *Store) RevokeShare(ctx context.Context, owner, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = lockPackage(ctx, tx, owner, id); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "DELETE FROM share_links WHERE package_id=$1", id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) PublicDetail(ctx context.Context, token string) (Detail, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, "SELECT package_id::text FROM share_links WHERE token_hash=$1", auth.TokenHash(token)).Scan(&id)
	if err != nil {
		return Detail{}, normalizeError(err)
	}
	result, err := getDetail(ctx, tx, id)
	if err != nil {
		return result, err
	}
	result.Package.ClientID = ""
	return result, tx.Commit(ctx)
}
