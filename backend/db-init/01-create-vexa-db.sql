-- Idempotent: create the workforce0_vexa database if it doesn't exist.
SELECT 'CREATE DATABASE workforce0_vexa'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'workforce0_vexa')\gexec
