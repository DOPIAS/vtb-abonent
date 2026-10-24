package api

import "testing"

func TestNormalizeRussianPhone(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{"", ""},
		{"   ", ""},
		{"+79991234567", "+79991234567"},
		{"+7 (999) 123-45-67", "+79991234567"},
		{"  8 (999) 123-45-67  ", "+79991234567"},
		{"7 999 123 45 67", "+79991234567"},
		{"9991234567", "+79991234567"},
		{"+7 (495) 123-45-67", "+74951234567"},
		{"8 (343) 123-45-67", "+73431234567"},
		{"8001234567", "+78001234567"},
	} {
		t.Run(test.input, func(t *testing.T) {
			got, ok := normalizeRussianPhone(test.input)
			if !ok || got != test.want {
				t.Fatalf("normalization: got %q, %v want %q, true", got, ok, test.want)
			}
		})
	}
	for _, input := range []string{
		"+7 (701) 123-45-67", "+7 (601) 123-45-67", "+1 999 123 45 67", "+8 999 123 45 67",
		"7999123456", "799912345678", "2991234567", "телефон 89991234567", "89991234567 доб. 1",
		"++79991234567", "7+9991234567", "8.999.123.45.67", "+79991234567\x00",
		"+79991234567\n", "+79991234567\r", "\t+79991234567", "+７９９９１２３４５６７", "()-", "+",
	} {
		t.Run("invalid_"+input, func(t *testing.T) {
			if _, ok := normalizeRussianPhone(input); ok {
				t.Fatal("invalid number accepted")
			}
		})
	}
}
