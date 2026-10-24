package database

import (
	"context"
	"database/sql"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Open(ctx context.Context, connection string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connection)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 12
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "10000"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
func Migrate(ctx context.Context, connection, dir string) error {
	db, err := sql.Open("pgx", connection)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, os.DirFS(dir))
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}
