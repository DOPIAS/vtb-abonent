// Seed is deliberately an explicit development command; the server never calls it.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"time"

	"abonent/api/internal/auth"
	"abonent/api/internal/config"
	"abonent/api/internal/database"
	"abonent/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func main() {
	showcase := flag.Bool("showcase", false, "create the separate synthetic competition showcase account")
	flag.Parse()
	if err := run(*showcase); err != nil {
		log.Fatal(err)
	}
}
func run(showcase bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	s := store.New(pool)
	if showcase {
		return runShowcase(ctx, s, cfg.PublicWebURL)
	}
	// A repeat invocation reuses the synthetic account and package, preserving user edits.
	const email = "demo@abonent.local"
	const password = "DemoPass123!"
	u, _, err := s.Credentials(ctx, email)
	if errors.Is(err, store.ErrNotFound) {
		hash, e := auth.HashPassword(password)
		if e != nil {
			return e
		}
		result, e := s.Register(ctx, "Анна Смирнова", email, hash)
		if e != nil {
			return e
		}
		u = result.User
		_ = s.Logout(ctx, result.Token)
	} else if err != nil {
		return err
	}
	var packageID string
	err = pool.QueryRow(ctx, "SELECT p.id::text FROM packages p JOIN clients c ON c.id=p.client_id WHERE c.user_id=$1 AND p.title='Английский • 8 занятий' ORDER BY p.created_at LIMIT 1", u.ID).Scan(&packageID)
	if errors.Is(err, pgx.ErrNoRows) {
		clients, e := s.Clients(ctx, u.ID, "")
		if e != nil {
			return e
		}
		var client store.Client
		if len(clients) == 0 {
			client, e = s.CreateClient(ctx, u.ID, "Михаил Иванов", "Синтетические демонстрационные данные")
			if e != nil {
				return e
			}
		} else {
			client = clients[0]
		}
		p, e := s.CreatePackage(ctx, u.ID, client.ID, "Английский • 8 занятий", 8, 1600000)
		if e != nil {
			return e
		}
		packageID = p.ID
		if _, e = s.Payment(ctx, u.ID, p.ID); e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Minute)
		for i := 0; i < 8; i++ {
			l, e := s.CreateLesson(ctx, u.ID, p.ID, now.AddDate(0, 0, (i-5)*7))
			if e != nil {
				return e
			}
			if i < 5 {
				if _, e = s.ChangeLesson(ctx, u.ID, l.ID, store.LessonChange{Action: "complete"}); e != nil {
					return e
				}
			}
		}
	} else if err != nil {
		return err
	}
	token, err := s.Share(ctx, u.ID, packageID)
	if err != nil {
		return err
	}
	detail, err := s.Detail(ctx, u.ID, packageID)
	if err != nil {
		return err
	}
	fmt.Printf("Synthetic development demo\nEmail: %s\nPassword: %s\nPaid: %d, completed: %d, remaining: %d\nClient link: %s/s/%s\n", email, password, detail.Package.PaidLessons, detail.Package.CompletedLessons, detail.Package.RemainingLessons, cfg.PublicWebURL, token)
	return nil
}
