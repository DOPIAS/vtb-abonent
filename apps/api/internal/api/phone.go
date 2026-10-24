package api

import (
	"regexp"
	"strings"
)

var phoneCharacters = regexp.MustCompile(`^\+?[0-9 ()-]+$`)
var internationalRussianPhone = regexp.MustCompile(`^\+7[3489][0-9]{9}$`)
var domesticRussianPhone = regexp.MustCompile(`^[78][3489][0-9]{9}$`)
var nationalRussianPhone = regexp.MustCompile(`^[3489][0-9]{9}$`)

// normalizeRussianPhone accepts Russian mobile and landline numbers with an
// optional country/domestic prefix and common formatting. Empty unsets the
// optional phone; malformed content is never silently discarded.
func normalizeRussianPhone(value string) (string, bool) {
	input := strings.Trim(value, " ")
	if input == "" {
		return "", true
	}
	if !phoneCharacters.MatchString(input) {
		return "", false
	}
	compact := strings.NewReplacer(" ", "", "(", "", ")", "", "-", "").Replace(input)
	switch {
	case internationalRussianPhone.MatchString(compact):
		return compact, true
	case domesticRussianPhone.MatchString(compact):
		return "+7" + compact[1:], true
	case nationalRussianPhone.MatchString(compact):
		return "+7" + compact, true
	default:
		return "", false
	}
}
