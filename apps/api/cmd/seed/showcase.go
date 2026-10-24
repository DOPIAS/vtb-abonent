package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"abonent/api/internal/auth"
	"abonent/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func runShowcase(ctx context.Context, s *store.Store, publicURL string) error {
	const email = "showcase@abonent.local"
	const password = "DemoPass123!"
	u, _, err := s.Credentials(ctx, email)
	if errors.Is(err, store.ErrNotFound) {
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		created, err := s.Register(ctx, "Анна • конкурсное демо", email, hash)
		if err != nil {
			return err
		}
		u = created.User
		if err = s.Logout(ctx, created.Token); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	packageID, err := seedShowcaseData(ctx, s, u.ID, time.Now().UTC().Truncate(time.Minute))
	if err != nil {
		return err
	}
	// As in the ordinary demo seed, only the public link is deliberately rotated.
	token, err := s.Share(ctx, u.ID, packageID)
	if err != nil {
		return err
	}
	detail, err := s.Detail(ctx, u.ID, packageID)
	if err != nil {
		return err
	}
	fmt.Printf("Synthetic competition showcase; no bank integration\nEmail: %s\nPassword: %s\nPrimary package: paid %d, completed %d, remaining %d\nClient link: %s/s/%s\n", email, password, detail.Package.PaidLessons, detail.Package.CompletedLessons, detail.Package.RemainingLessons, publicURL, token)
	return nil
}

// Stable, owner-scoped IDs let repeated seeds reuse records even after a name or
// title is edited. Existing packages and lessons are never reset or rescheduled.
func showcaseID(owner, key string) string {
	sum := sha256.Sum256([]byte("abonent-competition-showcase-v1:" + owner + ":" + key))
	sum[6] = (sum[6] & 0x0f) | 0x80
	sum[8] = (sum[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(sum[:16])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}

func seedShowcaseData(ctx context.Context, s *store.Store, owner string, now time.Time) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	for _, item := range []struct {
		key, name, title string
		total, completed int
		price            int64
		paid             bool
	}{
		{"primary", "Михаил Иванов", "Английский • 8 занятий", 8, 5, 1600000, true},
		{"renewal", "Елена Петрова", "Математика • 2 занятия", 2, 1, 400000, true},
		{"pending", "Алексей Соколов", "Подготовка к экзамену • 4 занятия", 4, 0, 800000, false},
	} {
		clientID, packageID := showcaseID(owner, "client:"+item.key), showcaseID(owner, "package:"+item.key)
		if _, err = tx.Exec(ctx, `INSERT INTO clients(id,user_id,name,contact) VALUES($1,$2,$3,'Синтетические конкурсные данные') ON CONFLICT(id) DO NOTHING`, clientID, owner, item.name); err != nil {
			return "", err
		}
		var inserted string
		err = tx.QueryRow(ctx, `INSERT INTO packages(id,client_id,title,total_lessons,price_kopecks)
			SELECT $1,c.id,$3,$4,$5 FROM clients c WHERE c.id=$2 AND c.user_id=$6
			ON CONFLICT(id) DO NOTHING RETURNING id::text`, packageID, clientID, item.title, item.total, item.price, owner).Scan(&inserted)
		if errors.Is(err, pgx.ErrNoRows) {
			// Check ownership before reusing an existing deterministic package ID.
			if err = tx.QueryRow(ctx, `SELECT p.id::text FROM packages p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.user_id=$2`, packageID, owner).Scan(&inserted); err != nil {
				return "", err
			}
			continue
		}
		if err != nil {
			return "", err
		}
		if item.paid {
			if _, err = tx.Exec(ctx, `UPDATE packages SET payment_status='paid',paid_at=$2,paid_by=$3 WHERE id=$1`, packageID, now, owner); err != nil {
				return "", err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO payment_audit(package_id,actor_id,occurred_at) VALUES($1,$2,$3)`, packageID, owner, now); err != nil {
				return "", err
			}
		}
		// The unpaid example has one future lesson; payment still contributes no credits.
		lessonCount := item.total
		if !item.paid {
			lessonCount = 1
		}
		for i := 0; i < lessonCount; i++ {
			lessonID := showcaseID(owner, fmt.Sprintf("lesson:%s:%d", item.key, i))
			scheduled := now.Add(time.Duration(1+(i-item.completed)*2) * 24 * time.Hour)
			status := "scheduled"
			if i < item.completed {
				status = "completed"
				scheduled = now.Add(time.Duration(i-item.completed) * 24 * time.Hour)
			}
			if _, err = tx.Exec(ctx, `INSERT INTO lessons(id,package_id,scheduled_at,status,updated_by) VALUES($1,$2,$3,$4,$5)`, lessonID, packageID, scheduled, status, owner); err != nil {
				return "", err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO lesson_audit(lesson_id,actor_id,action,to_status,scheduled_at) VALUES($1,$2,'schedule','scheduled',$3)`, lessonID, owner, scheduled); err != nil {
				return "", err
			}
			if status == "completed" {
				if _, err = tx.Exec(ctx, `INSERT INTO lesson_audit(lesson_id,actor_id,action,from_status,to_status,scheduled_at) VALUES($1,$2,'complete','scheduled','completed',$3)`, lessonID, owner, scheduled); err != nil {
					return "", err
				}
			}
		}
	}
	return showcaseID(owner, "package:primary"), tx.Commit(ctx)
}
