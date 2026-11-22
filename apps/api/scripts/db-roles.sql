-- Least-privilege roles for production. Run once as a superuser (psql), replacing the passwords.
-- Afterwards: DATABASE_URL uses kite_app; migrations run with MIGRATE_DATABASE_URL using kite_migrator.
CREATE ROLE kite_migrator LOGIN PASSWORD 'change-me-migrator';
CREATE ROLE kite_app LOGIN PASSWORD 'change-me-app';
ALTER DATABASE kite OWNER TO kite_migrator;
GRANT CONNECT ON DATABASE kite TO kite_app;
\connect kite
ALTER SCHEMA public OWNER TO kite_migrator;
GRANT USAGE ON SCHEMA public TO kite_app;

-- Run the section below AFTER the first migration (and again after migrations that add tables):
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kite_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kite_app;
-- The stock ledger and the audit trail are append-only for the application.
REVOKE UPDATE, DELETE ON stock_movements, audit_logs FROM kite_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kite_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kite_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kite_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kite_app;
