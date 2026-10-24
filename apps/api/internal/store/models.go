package store

import (
	"errors"
	"time"
)

var (
	ErrNotFound             = errors.New("not found")
	ErrConflict             = errors.New("conflict")
	ErrPaymentRequired      = errors.New("payment required")
	ErrInsufficientBalance  = errors.New("insufficient balance")
	ErrConfirmationRequired = errors.New("confirmation required")
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
type Auth struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	User      User      `json:"user"`
}
type Client struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Contact   string    `json:"contact"`
	Phone     string    `json:"phone"`
	CreatedAt time.Time `json:"createdAt"`
}
type Package struct {
	ID               string     `json:"id"`
	ClientID         string     `json:"clientId,omitempty"`
	Title            string     `json:"title"`
	TotalLessons     int        `json:"totalLessons"`
	PriceKopecks     int64      `json:"priceKopecks"`
	PaymentStatus    string     `json:"paymentStatus"`
	PaidLessons      int        `json:"paidLessons"`
	CompletedLessons int        `json:"completedLessons"`
	RemainingLessons int        `json:"remainingLessons"`
	PaidAt           *time.Time `json:"paidAt"`
	CreatedAt        time.Time  `json:"createdAt"`
}
type Lesson struct {
	ID          string    `json:"id"`
	PackageID   string    `json:"packageId"`
	ScheduledAt time.Time `json:"scheduledAt"`
	Status      string    `json:"status"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type Detail struct {
	Package Package  `json:"package"`
	Lessons []Lesson `json:"lessons"`
}
type ClientDetail struct {
	Client   Client    `json:"client"`
	Packages []Package `json:"packages"`
}
type LessonChange struct {
	Action      string
	ScheduledAt *time.Time
	Confirmed   bool
}

// nextStatus is shared by all status writers. Idempotent repeats do not create audit entries.
func nextStatus(current string, change LessonChange, paid bool, remaining int) (next string, changed bool, err error) {
	switch change.Action {
	case "complete":
		if current == "completed" {
			return current, false, nil
		}
		if current != "scheduled" {
			return "", false, ErrConflict
		}
		if !paid {
			return "", false, ErrPaymentRequired
		}
		if remaining <= 0 {
			return "", false, ErrInsufficientBalance
		}
		return "completed", true, nil
	case "cancel":
		if current == "cancelled" {
			return current, false, nil
		}
		if current != "scheduled" {
			return "", false, ErrConflict
		}
		return "cancelled", true, nil
	case "restore":
		if !change.Confirmed {
			return "", false, ErrConfirmationRequired
		}
		if current == "scheduled" {
			return current, false, nil
		}
		if current != "completed" {
			return "", false, ErrConflict
		}
		return "scheduled", true, nil
	case "reschedule":
		if current != "scheduled" {
			return "", false, ErrConflict
		}
		if change.ScheduledAt == nil {
			return "", false, ErrConflict
		}
		return "scheduled", true, nil
	default:
		return "", false, ErrConflict
	}
}
