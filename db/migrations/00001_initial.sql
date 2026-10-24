-- +goose Up
CREATE TABLE users (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE clients (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    contact text NOT NULL DEFAULT '' CHECK (char_length(contact) <= 250),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_user_idx ON clients(user_id, created_at DESC);
CREATE TABLE packages (
    id uuid PRIMARY KEY,
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    total_lessons integer NOT NULL CHECK (total_lessons BETWEEN 1 AND 1000),
    price_kopecks bigint NOT NULL CHECK (price_kopecks BETWEEN 0 AND 1000000000),
    payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
    paid_at timestamptz,
    paid_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((payment_status = 'pending' AND paid_at IS NULL AND paid_by IS NULL) OR (payment_status = 'paid' AND paid_at IS NOT NULL AND paid_by IS NOT NULL))
);
CREATE INDEX packages_client_idx ON packages(client_id, created_at DESC);
CREATE TABLE lessons (
    id uuid PRIMARY KEY,
    package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    scheduled_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lessons_package_idx ON lessons(package_id, scheduled_at, id);
CREATE TABLE payment_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES users(id),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(package_id)
);
CREATE TABLE lesson_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES users(id),
    action text NOT NULL CHECK (action IN ('schedule','complete','cancel','restore','reschedule')),
    from_status text,
    to_status text NOT NULL,
    previous_scheduled_at timestamptz,
    scheduled_at timestamptz NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lesson_audit_lesson_idx ON lesson_audit(lesson_id, occurred_at);
CREATE TABLE share_links (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    package_id uuid NOT NULL UNIQUE REFERENCES packages(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE share_links, lesson_audit, payment_audit, lessons, packages, clients, sessions, users;
