-- +goose Up
ALTER TABLE clients ADD COLUMN phone text NOT NULL DEFAULT ''
    CONSTRAINT clients_phone_format CHECK (phone = '' OR phone ~ '^\+7[3489][0-9]{9}$');

-- +goose Down
ALTER TABLE clients DROP COLUMN phone;
