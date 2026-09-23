-- AgResearch Labs Database Schema
-- Migration 001: Initial Tables & Business Rule Constraints

-- 1. Custom Enum Types
CREATE TYPE batch_stage AS ENUM (
  'SEEDED',
  'GERMINATION',
  'GROWING',
  'HARVEST_READY',
  'HARVESTED'
);

CREATE TYPE harvest_grade AS ENUM ('A', 'B', 'C');

-- 2. Trays Table
CREATE TABLE trays (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  zone            TEXT NOT NULL,
  capacity_units  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_trays_code UNIQUE (code),
  CONSTRAINT ck_trays_capacity_positive CHECK (capacity_units > 0)
);

-- Index for searching trays by zone
CREATE INDEX idx_trays_zone ON trays (zone);

-- 3. Batches Table
CREATE TABLE batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tray_id             UUID NOT NULL REFERENCES trays(id) ON DELETE RESTRICT,
  crop                TEXT NOT NULL,
  seeded_on           DATE NOT NULL DEFAULT CURRENT_DATE,
  stage               batch_stage NOT NULL DEFAULT 'SEEDED',
  expected_harvest_on DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_batches_dates CHECK (
    expected_harvest_on IS NULL OR expected_harvest_on >= seeded_on
  )
);

-- CRITICAL BUSINESS RULE 1 & CONCURRENCY SAFETY (Part 2 & Part 3a):
-- "A tray can hold at most one active batch. A batch is active until it reaches HARVESTED."
-- This partial unique index guarantees that across all concurrent transactions and multiple
-- API replicas behind a load balancer, at most ONE batch in non-HARVESTED state can exist per tray.
CREATE UNIQUE INDEX uq_active_batch_per_tray
  ON batches (tray_id)
  WHERE stage != 'HARVESTED';

-- Indexes for filtering & reporting performance
CREATE INDEX idx_batches_stage ON batches (stage);
CREATE INDEX idx_batches_crop ON batches (crop);
CREATE INDEX idx_batches_tray_id ON batches (tray_id);

-- 4. Harvests Table
CREATE TABLE harvests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  harvested_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_grams  NUMERIC(10, 2) NOT NULL,
  grade         harvest_grade NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_harvests_batch_id UNIQUE (batch_id),
  CONSTRAINT ck_harvests_weight_positive CHECK (weight_grams > 0)
);

CREATE INDEX idx_harvests_harvested_on ON harvests (harvested_on);

-- 5. Idempotency Table (Part 3b)
-- Stores responses for idempotent POST /batches/:id/harvest requests.
-- Keys have a 24-hour validity window.
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX idx_idempotency_expires_at ON idempotency_keys (expires_at);
