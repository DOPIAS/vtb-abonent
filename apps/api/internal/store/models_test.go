package store

import (
	"errors"
	"testing"
	"time"
)

func TestLessonTransitions(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name, current string
		change        LessonChange
		paid          bool
		remaining     int
		next          string
		changed       bool
		err           error
	}{
		{"complete pending", "scheduled", LessonChange{Action: "complete"}, false, 0, "", false, ErrPaymentRequired},
		{"complete empty", "scheduled", LessonChange{Action: "complete"}, true, 0, "", false, ErrInsufficientBalance},
		{"complete", "scheduled", LessonChange{Action: "complete"}, true, 1, "completed", true, nil},
		{"repeat complete", "completed", LessonChange{Action: "complete"}, true, 0, "completed", false, nil},
		{"complete cancelled", "cancelled", LessonChange{Action: "complete"}, true, 1, "", false, ErrConflict},
		{"cancel", "scheduled", LessonChange{Action: "cancel"}, true, 1, "cancelled", true, nil},
		{"repeat cancel", "cancelled", LessonChange{Action: "cancel"}, true, 1, "cancelled", false, nil},
		{"cancel completed", "completed", LessonChange{Action: "cancel"}, true, 1, "", false, ErrConflict},
		{"restore unconfirmed", "completed", LessonChange{Action: "restore"}, true, 1, "", false, ErrConfirmationRequired},
		{"restore", "completed", LessonChange{Action: "restore", Confirmed: true}, true, 1, "scheduled", true, nil},
		{"repeat restore", "scheduled", LessonChange{Action: "restore", Confirmed: true}, true, 1, "scheduled", false, nil},
		{"restore cancelled", "cancelled", LessonChange{Action: "restore", Confirmed: true}, true, 1, "", false, ErrConflict},
		{"reschedule", "scheduled", LessonChange{Action: "reschedule", ScheduledAt: &now}, false, 0, "scheduled", true, nil},
		{"reschedule completed", "completed", LessonChange{Action: "reschedule", ScheduledAt: &now}, true, 1, "", false, ErrConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next, changed, err := nextStatus(tt.current, tt.change, tt.paid, tt.remaining)
			if next != tt.next || changed != tt.changed || !errors.Is(err, tt.err) {
				t.Fatalf("got (%q,%v,%v), want (%q,%v,%v)", next, changed, err, tt.next, tt.changed, tt.err)
			}
		})
	}
}
