package config

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL, HTTPAddr, PublicWebURL, MigrationsDir string
	CORSOrigins                                        []string
}

func Load() (Config, error) {
	c := Config{DatabaseURL: os.Getenv("DATABASE_URL"), HTTPAddr: env("HTTP_ADDR", ":8080"), PublicWebURL: strings.TrimRight(env("PUBLIC_WEB_URL", "http://localhost:8090"), "/"), MigrationsDir: env("MIGRATIONS_DIR", "../../db/migrations")}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	u, err := url.Parse(c.PublicWebURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("PUBLIC_WEB_URL must be an absolute HTTP(S) URL without credentials, query or fragment")
	}
	for _, origin := range strings.Split(env("CORS_ORIGINS", "http://localhost:8081,http://localhost:8082,http://localhost:8090"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			c.CORSOrigins = append(c.CORSOrigins, origin)
		}
	}
	return c, nil
}
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
