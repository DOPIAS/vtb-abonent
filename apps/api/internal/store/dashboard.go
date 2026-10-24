package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Dashboard struct {
	AsOf            time.Time        `json:"asOf"`
	Totals          DashboardTotals  `json:"totals"`
	Renewals        []Renewal        `json:"renewals"`
	UpcomingLessons []UpcomingLesson `json:"upcomingLessons"`
}

type DashboardTotals struct {
	ClientCount              int   `json:"clientCount"`
	PaidPackageCount         int   `json:"paidPackageCount"`
	PendingPackageCount      int   `json:"pendingPackageCount"`
	ConfirmedPaymentsKopecks int64 `json:"confirmedPaymentsKopecks"`
	PendingPaymentsKopecks   int64 `json:"pendingPaymentsKopecks"`
	CompletedLessons         int   `json:"completedLessons"`
	RemainingLessons         int   `json:"remainingLessons"`
	RemainingValueKopecks    int64 `json:"remainingValueKopecks"`
}

type Renewal struct {
	ClientID         string `json:"clientId"`
	ClientName       string `json:"clientName"`
	PackageID        string `json:"packageId"`
	PackageTitle     string `json:"packageTitle"`
	TotalLessons     int    `json:"totalLessons"`
	PriceKopecks     int64  `json:"priceKopecks"`
	RemainingLessons int    `json:"remainingLessons"`
}

type UpcomingLesson struct {
	ID           string    `json:"id"`
	PackageID    string    `json:"packageId"`
	ClientID     string    `json:"clientId"`
	ClientName   string    `json:"clientName"`
	PackageTitle string    `json:"packageTitle"`
	ScheduledAt  time.Time `json:"scheduledAt"`
}

// Dashboard reads all sections from one repeatable-read snapshot. Payments are
// manual confirmations; remaining value is allocated per paid package in whole
// kopecks, with the division rounding down the value of completed lessons.
func (s *Store) Dashboard(ctx context.Context, owner string) (Dashboard, error) {
	result := Dashboard{Renewals: []Renewal{}, UpcomingLessons: []UpcomingLesson{}}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&result.AsOf); err != nil {
		return result, err
	}
	result.AsOf = result.AsOf.UTC()

	err = tx.QueryRow(ctx, `WITH owned_packages AS (
		SELECT p.*, (SELECT count(*) FROM lessons l WHERE l.package_id=p.id AND l.status='completed') AS completed
		FROM packages p JOIN clients c ON c.id=p.client_id WHERE c.user_id=$1
	)
	SELECT (SELECT count(*) FROM clients WHERE user_id=$1),
		count(*) FILTER (WHERE payment_status='paid'),
		count(*) FILTER (WHERE payment_status='pending'),
		COALESCE(sum(price_kopecks) FILTER (WHERE payment_status='paid'),0)::bigint,
		COALESCE(sum(price_kopecks) FILTER (WHERE payment_status='pending'),0)::bigint,
		COALESCE(sum(completed),0)::bigint,
		COALESCE(sum(total_lessons-completed) FILTER (WHERE payment_status='paid'),0)::bigint,
		COALESCE(sum(price_kopecks-(price_kopecks*completed/total_lessons)) FILTER (WHERE payment_status='paid'),0)::bigint
	FROM owned_packages`, owner).Scan(
		&result.Totals.ClientCount, &result.Totals.PaidPackageCount, &result.Totals.PendingPackageCount,
		&result.Totals.ConfirmedPaymentsKopecks, &result.Totals.PendingPaymentsKopecks,
		&result.Totals.CompletedLessons, &result.Totals.RemainingLessons, &result.Totals.RemainingValueKopecks,
	)
	if err != nil {
		return result, err
	}

	rows, err := tx.Query(ctx, `WITH paid_packages AS (
		SELECT p.*, c.name AS client_name,
			p.total_lessons-(SELECT count(*) FROM lessons l WHERE l.package_id=p.id AND l.status='completed') AS remaining
		FROM packages p JOIN clients c ON c.id=p.client_id WHERE c.user_id=$1 AND p.payment_status='paid'
	), clients_to_renew AS (
		SELECT client_id,sum(remaining)::bigint AS remaining FROM paid_packages GROUP BY client_id HAVING sum(remaining)<=2
	)
	SELECT latest.client_id::text,latest.client_name,latest.id::text,latest.title,latest.total_lessons,latest.price_kopecks,r.remaining
	FROM clients_to_renew r JOIN LATERAL (
		SELECT * FROM paid_packages p WHERE p.client_id=r.client_id ORDER BY p.paid_at DESC,p.created_at DESC,p.id DESC LIMIT 1
	) latest ON true
	ORDER BY r.remaining,latest.client_name,latest.client_id`, owner)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var renewal Renewal
		if err = rows.Scan(&renewal.ClientID, &renewal.ClientName, &renewal.PackageID, &renewal.PackageTitle, &renewal.TotalLessons, &renewal.PriceKopecks, &renewal.RemainingLessons); err != nil {
			rows.Close()
			return result, err
		}
		result.Renewals = append(result.Renewals, renewal)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}

	rows, err = tx.Query(ctx, `SELECT l.id::text,p.id::text,c.id::text,c.name,p.title,l.scheduled_at
		FROM lessons l JOIN packages p ON p.id=l.package_id JOIN clients c ON c.id=p.client_id
		WHERE c.user_id=$1 AND l.status='scheduled' AND l.scheduled_at >= $2 AND l.scheduled_at <= $3
		ORDER BY l.scheduled_at,l.id LIMIT 10`, owner, result.AsOf, result.AsOf.Add(7*24*time.Hour))
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var lesson UpcomingLesson
		if err = rows.Scan(&lesson.ID, &lesson.PackageID, &lesson.ClientID, &lesson.ClientName, &lesson.PackageTitle, &lesson.ScheduledAt); err != nil {
			rows.Close()
			return result, err
		}
		lesson.ScheduledAt = lesson.ScheduledAt.UTC()
		result.UpcomingLessons = append(result.UpcomingLessons, lesson)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
