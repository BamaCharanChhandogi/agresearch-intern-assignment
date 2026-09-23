# AgResearch Labs — Farm Management API
### Software Developer Intern Take-Home Assignment
**Candidate:** Bama Charan Chhandogi  
**Submission Commit:** `$(git rev-parse HEAD)`  
**Repository:** Public GitHub Repository  

---

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Setup & Running (Clean Machine Instructions)](#setup--running-clean-machine-instructions)
3. [API Reference & HTTP Status Codes](#api-reference--http-status-codes)
4. [Business Rules Enforcement: Handlers vs Services vs Database](#business-rules-enforcement-handlers-vs-services-vs-database)
5. [Database Schema & Constraint Design](#database-schema--constraint-design)
6. [Part 3 Solutions & Architectural Deep-Dives](#part-3-solutions--architectural-deep-dives)
   - [3a. Concurrency Safety & Load-Balancer Behavior](#3a-concurrency-safety--load-balancer-behavior)
   - [3b. Idempotent Harvest Recording & TTL Decision](#3b-idempotent-harvest-recording--ttl-decision)
   - [3c. Single-Query Yield Reporting & Walkthrough](#3c-single-query-yield-reporting--walkthrough)
7. [Assumptions (Spec Gaps Identified & Resolved)](#assumptions-spec-gaps-identified--resolved)
8. [What I Did Not Finish & Next Steps with More Time](#what-i-did-not-finish--next-steps-with-more-time)
9. [AI Usage Transparency](#ai-usage-transparency)

---

## Overview & Architecture

This service is a high-reliability backend REST API for aeroponic indoor farms, built with **Fastify**, **TypeScript** (strict mode), and **PostgreSQL**.

### Design Philosophy: Layered Separation of Concerns
```
HTTP Request
     │
     ▼
[ Routes Layer ]         Fastify schemas validate bodies, query params, and route params (TypeBox)
     │                   Rejects bad requests early (400 Bad Request)
     ▼
[ Services Layer ]       Business rules, state machine validation, friendly descriptive errors
     │                   Throws domain-specific errors (BadRequest, NotFound, Conflict)
     ▼
[ Repositories Layer ]   PostgreSQL queries, transactions (BEGIN/COMMIT), row-level locks (FOR UPDATE)
     │
     ▼
[ PostgreSQL DB ]        Partial unique indexes, custom ENUMs, foreign keys, CHECK constraints
```

---

## Setup & Running (Clean Machine Instructions)

This repository is designed to run seamlessly on a clean machine without surprises.

### Prerequisites
- **Node.js**: `v20.x` or `v22.x` (LTS)
- **npm**: `v10.x` or higher
- **PostgreSQL**: Either local PostgreSQL or Docker (a `docker-compose.yml` is provided)

### Option A: Running with Docker Compose (Recommended)

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repo-url>
   cd agresearch-assignment
   npm install
   ```

2. **Start PostgreSQL via Docker:**
   ```bash
   docker compose up -d
   ```
   *(Starts PostgreSQL on `localhost:5432` with user `postgres` and password `postgres`)*

3. **Copy environment variables and run migrations:**
   ```bash
   cp .env.example .env
   npm run migrate
   ```

4. **Start the API server in development mode:**
   ```bash
   npm run dev
   ```
   Server will start at `http://localhost:3000`.

---

### Option B: Running Tests Directly (Zero External Setup Required)

The test suite is equipped with an integrated in-memory PostgreSQL engine (`pg-mem`), allowing you to execute the entire end-to-end test suite immediately without setting up or starting a database:

```bash
npm test
```

To run against a real local PostgreSQL instance instead:
```bash
TEST_WITH_REAL_PG=true DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/agresearch npm test
```

### Build & Production Run
```bash
npm run build
npm start
```

---

## API Reference & HTTP Status Codes

We strictly adhere to HTTP semantic status codes:
- **`200 OK`**: Successful query or stage advancement
- **`201 Created`**: Resource successfully created (tray, batch, or harvest)
- **`400 Bad Request`**: Malformed payload, schema validation failure, or invalid forward state skip
- **`404 Not Found`**: Target tray or batch does not exist
- **`409 Conflict`**: Tray occupied by active batch, duplicate tray code, invalid state for harvest, or double-harvest

### Endpoints Summary

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `POST` | `/trays` | Creates a new physical tray | `201`, `400`, `409` |
| `GET` | `/trays` | Lists all trays | `200` |
| `GET` | `/trays/:id` | Returns tray by ID | `200`, `404` |
| `POST` | `/batches` | Seeds a batch into a tray | `201`, `400`, `404`, `409` |
| `GET` | `/batches` | Lists batches with filters (`stage`, `crop`, `zone`) & pagination (`page`, `limit`) | `200` |
| `GET` | `/batches/:id` | Returns single batch details (with joined tray code & zone) | `200`, `404` |
| `PATCH` | `/batches/:id/stage` | Advances batch by exactly one stage forward | `200`, `400`, `404`, `409` |
| `POST` | `/batches/:id/harvest` | Records harvest, closes batch to `HARVESTED`, frees tray. Supports `Idempotency-Key` | `201`, `400`, `404`, `409` |
| `GET` | `/reports/yield` | Yield statistics grouped by `crop` or `zone` for date range `from` to `to` | `200`, `400` |

---

## Business Rules Enforcement: Handlers vs Services vs Database

The prompt specifically asked:
> *"Where do you enforce a rule? In the handler, in the service layer, in the database, or in more than one place? There is no single right answer, but there is a reason for whichever you pick."*

### Our Strategy: **Dual Enforcement (Layered Defense)**

We enforce rules primarily in the **Service Layer** with an infallible **Database Layer** safety net:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. ROUTE / HANDLER LAYER: Syntactic & Schema Validation                 │
│    - Fastify + TypeBox validates types, formats, lengths, enums, & min │
│    - Rejects invalid payloads before hitting business logic (400)      │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. SERVICE LAYER: Business Semantics & Friendly Diagnostics            │
│    - Verifies domain transitions (e.g. SEEDED -> GERMINATION)           │
│    - Checks preconditions (e.g. batch must be in HARVEST_READY)        │
│    - Provides human-readable, actionable error messages                │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. DATABASE LAYER: Concurrency Safety & Inviolable Invariants          │
│    - Partial Unique Index: uq_active_batch_per_tray (WHERE != HARVESTED│
│    - CHECK constraints (capacity > 0, weight > 0)                      │
│    - Atomic Transactions (BEGIN ... SELECT FOR UPDATE ... COMMIT)      │
│    - Infallible: protects against race conditions across API replicas  │
└────────────────────────────────────────────────────────────────────────┘
```

### Detailed Rationale by Rule

| Business Rule | Where Enforced | Rationale |
|---|---|---|
| **Rule 1: Tray Occupancy** *(A tray can hold at most one active batch)* | **Service + Database** | **Service Layer** checks `findActiveByTrayId` to provide a helpful error message: *"Tray T-A-014 is already occupied by batch 123 (stage: GROWING)"*. **Database Layer** enforces `CREATE UNIQUE INDEX uq_active_batch_per_tray ON batches (tray_id) WHERE stage != 'HARVESTED'`. If two concurrent requests arrive at the same millisecond, the DB partial unique index guarantees that exactly one succeeds and the other fails safely with error `23505` (mapped to `409 Conflict`). |
| **Rule 2: Stage Progression** *(Only forward, one step at a time, no skipping)* | **Service Layer** | State machine logic (`SEEDED` → `GERMINATION` → `GROWING` → `HARVEST_READY` → `HARVESTED`) belongs in domain code. The service uses a deterministic `NEXT_STAGE_MAP`. Advancing via `PATCH /stage` past `HARVEST_READY` is rejected because moving to `HARVESTED` requires recording harvest metrics. |
| **Rule 3: Harvest Prerequisites** *(Only recorded for HARVEST_READY batches)* | **Service + Repository Transaction** | The service validates the stage before proceeding. In the repository, `SELECT stage FROM batches WHERE id = $1 FOR UPDATE` locks the batch row within a transaction to prevent race conditions during harvest. |
| **Rule 4: Batch Closure & Tray Reuse** *(Harvesting moves to HARVESTED and frees tray)* | **Database Transaction (Atomic)** | Moving batch stage to `HARVESTED` and inserting into `harvests` must be completely atomic. Enforced inside a PostgreSQL transaction (`BEGIN ... INSERT harvests ... UPDATE batches SET stage = 'HARVESTED' ... COMMIT`). Because the batch is now `HARVESTED`, the partial unique index immediately releases the tray for new seedings. |

---

## Database Schema & Constraint Design

The schema is defined in [`src/db/migrations/001_initial.sql`](src/db/migrations/001_initial.sql):

```sql
-- 1. Custom Enums for strict domain typing
CREATE TYPE batch_stage AS ENUM (
  'SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED'
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

-- CRITICAL CONSTRAINT: Partial Unique Index
-- Allows unlimited historical HARVESTED batches per tray, but AT MOST ONE active batch
CREATE UNIQUE INDEX uq_active_batch_per_tray
  ON batches (tray_id)
  WHERE stage != 'HARVESTED';

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

-- 5. Idempotency Table (Part 3b)
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);
```

---

## Part 3 Solutions & Architectural Deep-Dives

We implemented **all three** Part 3 challenges (`3a`, `3b`, and `3c`).

### 3a. Concurrency Safety & Load-Balancer Behavior

#### The Problem
Two requests arrive at the same instant trying to seed a batch into tray `T-A-014`. Exactly one must succeed (`201 Created`); the other must fail cleanly (`409 Conflict`).

#### Our Solution
We enforce this using PostgreSQL's partial unique index:
```sql
CREATE UNIQUE INDEX uq_active_batch_per_tray ON batches (tray_id) WHERE stage != 'HARVESTED';
```

When two concurrent `POST /batches` requests arrive:
1. Both may pass the application-level `findActiveByTrayId` check if they read before either writes.
2. Both issue `INSERT INTO batches ...`.
3. PostgreSQL acquires a unique index lock during row insertion.
4. Transaction A succeeds and inserts its row.
5. Transaction B detects a unique index collision and immediately aborts with error code `23505` (`unique_violation`).
6. The service layer catches this database violation and maps it cleanly to:
   ```json
   {
     "statusCode": 409,
     "error": "Conflict",
     "message": "Tray 'T-A-014' is already occupied by an active batch."
   }
   ```

#### What happens behind a Load Balancer?
If 10 API instances run behind an Nginx or AWS ALB load balancer:
- **In-memory locks (like Mutexes or Node.js maps) fail completely**, because the requests are routed to different Node.js processes on different servers.
- **Our PostgreSQL approach holds 100%**, because the database is the single shared source of truth. PostgreSQL handles row-level serialization and ACID index enforcement at the storage engine level regardless of how many client connections or API instances exist.

#### Automated Test Proof
In [`tests/concurrency.test.ts`](tests/concurrency.test.ts), we fire 10 simultaneous requests using `Promise.all`:
```ts
const seedPromises = Array.from({ length: 10 }, (_, i) =>
  app.inject({ method: 'POST', url: '/batches', payload: { tray_id: trayId, crop: `Crop-${i}` } })
);
const responses = await Promise.all(seedPromises);
expect(responses.filter(r => r.statusCode === 201)).toHaveLength(1);
expect(responses.filter(r => r.statusCode === 409)).toHaveLength(9);
```

---

### 3b. Idempotent Harvest Recording & TTL Decision

#### The Problem
Field staff record harvests using mobile devices over spotty Wi-Fi / cellular connections. Network drops cause mobile apps to retry requests, potentially creating duplicate harvests.

#### Our Solution
Clients send an `Idempotency-Key` header with `POST /batches/:id/harvest`:
1. **Pre-check**: The service checks `idempotency_keys` table for an existing record with that key where `expires_at > now()`.
2. **Replay (Cache HIT)**: If found, the server immediately returns the cached status code and payload without re-executing any business logic or database writes. The response includes `X-Cache-Lookup: HIT`.
3. **Execution (Cache MISS)**: If not found, the harvest is recorded atomically, and the resulting payload and status code (`201`) are persisted in `idempotency_keys`.

#### Why 24 Hours TTL?
We set key validity to **24 hours** (`expires_at = now() + INTERVAL '24 hours'`).
- **Operational Reality**: Farm field shifts run between 8 to 12 hours. A 24-hour window easily covers device offline queues, shift handoffs, and delayed retries.
- **Storage Hygiene**: Retrying a harvest after 24 hours is no longer a network blip — it is a human workflow error. Expiring keys after 24 hours prevents the table from growing indefinitely while maintaining zero performance overhead.

#### Automated Test Proof
In [`tests/idempotency.test.ts`](tests/idempotency.test.ts), we simulate network retries and verify that:
1. The first call creates the harvest (`201`).
2. The retry returns the exact same harvest ID and data (`201` with `X-Cache-Lookup: HIT`).
3. Exactly one row exists in `harvests`.

---

### 3c. Single-Query Yield Reporting & Walkthrough

#### The Endpoint
`GET /reports/yield?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=crop|zone`

#### The SQL Query
```sql
SELECT
  /* Whitelisted dynamic grouping: b.crop or t.zone */
  b.crop AS group_key,
  COUNT(*)::int                                                 AS batches_harvested,
  ROUND(SUM(h.weight_grams)::numeric, 2)::float                 AS total_weight_grams,
  ROUND(AVG(h.harvested_on - b.seeded_on)::numeric, 1)::float   AS avg_days_to_harvest
FROM harvests h
JOIN batches b ON b.id = h.batch_id
JOIN trays t   ON t.id = b.tray_id
WHERE h.harvested_on >= $1::date AND h.harvested_on <= $2::date
GROUP BY b.crop
ORDER BY total_weight_grams DESC;
```

#### How It Works (Step-by-Step Walkthrough)
1. **Relational Join (`harvests` → `batches` → `trays`)**:
   - `harvests` gives harvest dates and weights (`h.weight_grams`, `h.harvested_on`).
   - `batches` links the harvest to its initial seeding date (`b.seeded_on`) and crop name (`b.crop`).
   - `trays` connects the batch to its physical growing zone (`t.zone`).
2. **Date Filtering (`WHERE h.harvested_on BETWEEN $1 AND $2`)**:
   - Filters only harvests completed within the specified reporting window using indexed date lookups.
3. **Dynamic Grouping (`GROUP BY b.crop` or `GROUP BY t.zone`)**:
   - The repository dynamically selects the group column based on the validated parameter (`crop` or `zone`). Fastify's schema validator guarantees that only `'crop'` or `'zone'` can be passed, eliminating SQL injection risk.
4. **Aggregate Computations**:
   - `COUNT(*)::int`: Total distinct batches harvested in this group.
   - `SUM(h.weight_grams)`: Total yield in grams, rounded to 2 decimal places.
   - `AVG(h.harvested_on - b.seeded_on)`: Direct PostgreSQL date arithmetic (`date - date` yields the integer count of elapsed days), averaged across all batches and rounded to 1 decimal place.
5. **Efficiency**: Executes in a **single query pass** with zero application-side loops or N+1 queries.

---

## Assumptions (Spec Gaps Identified & Resolved)

The prompt noted: *"The spec below has gaps in it. Some are deliberate. When you hit one, either email us and ask, or make a decision and record it in your README under Assumptions."*

Here are the 10 deliberate gaps identified and our architectural decisions:

1. **`capacity_units` on Trays**:
   - *Gap*: The spec includes `capacity_units` on trays, but no business rule mentions plant counts or batch density.
   - *Decision*: Treated as informational facility metadata. Validated as a positive integer (`CHECK (capacity_units > 0)`), but not used to restrict batch seeding.

2. **Uniqueness of Tray `code`**:
   - *Gap*: The spec mentions tray code (e.g. `"T-A-014"`), but doesn't specify if it must be unique.
   - *Decision*: Made strictly unique (`CONSTRAINT uq_trays_code UNIQUE (code)`). In a physical greenhouse, two physical trays sharing identical labels would cause operational chaos.

3. **`expected_harvest_on` at Seeding Time**:
   - *Gap*: The batch shape has `expected_harvest_on`, but seeders may not know exact harvest dates on day 0.
   - *Decision*: Made optional. If provided, a DB CHECK constraint ensures `expected_harvest_on >= seeded_on`.

4. **Advancing Stage from `HARVEST_READY` via `PATCH /stage`**:
   - *Gap*: `PATCH /batches/:id/stage` advances a batch by one stage, but Rule 4 says recording a harvest moves the batch to `HARVESTED`.
   - *Decision*: Advancing `HARVEST_READY` via `PATCH /batches/:id/stage` is rejected with `400 Bad Request`. A batch cannot become `HARVESTED` without recording harvest metrics (`weight_grams`, `grade`) via `POST /batches/:id/harvest`.

5. **`weight_grams` Data Type & Validation**:
   - *Gap*: The data type of harvest weight was not specified.
   - *Decision*: Used `NUMERIC(10, 2)` with a `CHECK (weight_grams > 0)` constraint rather than an integer. Precision scales in commercial farming measure fractional grams (e.g. `450.75g`).

6. **Pagination Defaults**:
   - *Gap*: `GET /batches` requires pagination, but default page sizes and bounds were unspecified.
   - *Decision*: Implemented standard offset pagination with `page` (default 1) and `limit` (default 20, max capped at 100 to prevent DOS). Returns `{ data, pagination: { total, page, limit, totalPages } }`.

7. **Date Representation & Defaults**:
   - *Gap*: Default values for `seeded_on` and `harvested_on` were not defined.
   - *Decision*: Both default to `CURRENT_DATE` if omitted in request bodies, but allow optional ISO date strings (`YYYY-MM-DD`) for backfilling historical entries.

8. **Deletion / Soft Delete**:
   - *Gap*: No delete endpoints were specified for trays, batches, or harvests.
   - *Decision*: Omitted delete endpoints. Added `ON DELETE RESTRICT` foreign key constraints to preserve audit integrity and prevent orphaned agricultural records.

9. **Primary Key Format**:
   - *Gap*: ID format was not specified.
   - *Decision*: Used PostgreSQL UUID v4 (`gen_random_uuid()`) instead of auto-incrementing integers to prevent ID enumeration attacks and enable distributed scale.

10. **Zone Representation**:
    - *Gap*: It was unspecified whether `zone` is a restricted enum or free-form text.
    - *Decision*: Kept as `TEXT` with non-empty validation. Agricultural facilities frequently reconfigure or add micro-zones without requiring database migrations.

---

## What I Did Not Finish & Next Steps with More Time

1. **Bulk Seeding & Harvesting Endpoints**:
   - In large commercial facilities, technicians often seed or harvest 20 trays at once. An endpoint like `POST /batches/bulk` using PostgreSQL `unnest()` or multi-row insert within a transaction would improve operational throughput.
2. **Crop Lifecycle Duration Profiles**:
   - Storing a `crops` lookup table with expected duration per stage (e.g. Basil: 7 days germination, 21 days growing). This would allow automated alerts when a batch spends abnormally long in `GROWING`.
3. **Full Database Migrations Tooling**:
   - Currently, `npm run migrate` runs our modular SQL migration runner. With more time, I would introduce a formal migration library (such as `node-pg-migrate` or `Kysely`) with automated rollback steps (`down` migrations).
4. **Structured JSON Telemetry & Tracing**:
   - Add OpenTelemetry tracing headers to track request latency across microservices and database query execution.

---

## AI Usage Transparency

In accordance with the prompt guidelines:
- **Tool Used**: Antigravity (Claude Opus 4.6 Thinking & Gemini 3.8 Flash)
- **Where It Was Used**:
  - Drafting initial Fastify schema definitions and TypeBox types.
  - Formulating the composite date arithmetic expressions for the Part 3c SQL yield aggregation.
  - Reviewing the `pg-mem` mock database adapter functions for fast in-memory test runner compatibility.
- **Human Verification**:
  - Every line of business logic, database constraint, status code mapping, and concurrency test was reviewed, tested, and verified.
  - Ready to walk through any line of code or live requirement changes during the technical follow-up call.
