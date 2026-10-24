package auth

import "testing"

func TestPasswordHash(t *testing.T) {
	hash, err := HashPassword("пароль-123456")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("пароль-123456", hash) || VerifyPassword("wrong", hash) {
		t.Fatal("password comparison failed")
	}
	second, err := HashPassword("пароль-123456")
	if err != nil {
		t.Fatal(err)
	}
	if second == hash {
		t.Fatal("password salts reused")
	}
	for _, invalid := range []string{"", hash + "$", "$argon2id$v=19$m=999999999,t=2,p=1$abc$abc"} {
		if VerifyPassword("пароль-123456", invalid) {
			t.Fatal("accepted malformed password hash")
		}
	}
}
func TestTokensAndIDs(t *testing.T) {
	first, err := Token()
	if err != nil {
		t.Fatal(err)
	}
	second, err := Token()
	if err != nil {
		t.Fatal(err)
	}
	if !ValidToken(first) || first == second || len(TokenHash(first)) != 32 {
		t.Fatal("invalid or repeated token")
	}
	for _, invalid := range []string{"", first + "=", first[:42], "invalid"} {
		if ValidToken(invalid) {
			t.Fatal("accepted invalid token")
		}
	}
	id, err := UUID()
	if err != nil || ValidateUUID(id) != nil {
		t.Fatalf("invalid ID %q: %v", id, err)
	}
	for _, invalid := range []string{"", "not-a-uuid", "a-------aaaa-aaaa-aaaa-aaaaaaaaaaaa"} {
		if ValidateUUID(invalid) == nil {
			t.Fatalf("accepted invalid UUID %q", invalid)
		}
	}
}
