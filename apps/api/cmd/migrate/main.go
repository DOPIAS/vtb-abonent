package main

import (
	"abonent/api/internal/config"
	"abonent/api/internal/database"
	"context"
	"log"
	"time"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err = database.Migrate(ctx, cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		log.Fatal(err)
	}
	log.Print("Migrations applied")
}
