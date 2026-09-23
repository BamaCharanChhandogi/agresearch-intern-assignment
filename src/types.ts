export type BatchStage =
  | 'SEEDED'
  | 'GERMINATION'
  | 'GROWING'
  | 'HARVEST_READY'
  | 'HARVESTED';

export type HarvestGrade = 'A' | 'B' | 'C';

export interface Tray {
  id: string;
  code: string;
  zone: string;
  capacity_units: number;
  created_at: Date | string;
}

export interface Batch {
  id: string;
  tray_id: string;
  crop: string;
  seeded_on: string; // ISO date string (YYYY-MM-DD)
  stage: BatchStage;
  expected_harvest_on: string | null;
  created_at: Date | string;
  // Joined fields when querying:
  tray_code?: string;
  zone?: string;
}

export interface Harvest {
  id: string;
  batch_id: string;
  harvested_on: string; // ISO date string (YYYY-MM-DD)
  weight_grams: number;
  grade: HarvestGrade;
  created_at: Date | string;
}

export interface IdempotencyRecord {
  key: string;
  batch_id: string;
  response_status: number;
  response_body: Record<string, any>;
  created_at: Date | string;
  expires_at: Date | string;
}

export interface YieldReportRow {
  group_key: string;
  batches_harvested: number;
  total_weight_grams: number;
  avg_days_to_harvest: number;
}

// Ordered Stage Machine: forward-only, one step at a time
export const STAGE_FLOW: readonly BatchStage[] = [
  'SEEDED',
  'GERMINATION',
  'GROWING',
  'HARVEST_READY',
  'HARVESTED',
] as const;

export const NEXT_STAGE_MAP: Record<BatchStage, BatchStage | null> = {
  SEEDED: 'GERMINATION',
  GERMINATION: 'GROWING',
  GROWING: 'HARVEST_READY',
  HARVEST_READY: 'HARVESTED',
  HARVESTED: null, // Final state, cannot advance further
};
