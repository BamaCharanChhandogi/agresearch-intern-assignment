import { IBatchRepository, batchRepository } from '../repositories/batch.repo.js';
import { ITrayRepository, trayRepository } from '../repositories/tray.repo.js';
import { CreateBatchInput, ListBatchesQuery } from '../schemas/batch.schema.js';
import { Batch, BatchStage, NEXT_STAGE_MAP } from '../types.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';

export interface PaginatedBatchesResponse {
  data: Batch[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class BatchService {
  constructor(
    private readonly batchRepo: IBatchRepository = batchRepository,
    private readonly trayRepo: ITrayRepository = trayRepository
  ) {}

  async seedBatch(input: CreateBatchInput): Promise<Batch> {
    // 1. Verify target tray exists
    const tray = await this.trayRepo.findById(input.tray_id);
    if (!tray) {
      throw new NotFoundError(`Tray with ID '${input.tray_id}' was not found.`);
    }

    // 2. Business Rule 1 (Service Layer Check):
    // "A tray can hold at most one active batch. A batch is active until it reaches HARVESTED."
    const activeBatch = await this.batchRepo.findActiveByTrayId(input.tray_id);
    if (activeBatch) {
      throw new ConflictError(
        `Tray '${tray.code}' (${tray.id}) is already occupied by active batch '${activeBatch.id}' (stage: ${activeBatch.stage}). Trays can hold at most one active batch.`
      );
    }

    // 3. Insert into database
    // Concurrency Safety / Rule 1 (DB Layer Check):
    // If two requests race past the activeBatch check, the PostgreSQL partial unique index
    // `uq_active_batch_per_tray` will reject the second with error code 23505.
    try {
      return await this.batchRepo.create(input);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictError(
          `Tray '${tray.code}' (${tray.id}) is already occupied by an active batch.`
        );
      }
      throw err;
    }
  }

  async advanceStage(batchId: string, requestedTargetStage?: BatchStage): Promise<Batch> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new NotFoundError(`Batch with ID '${batchId}' was not found.`);
    }

    // Business Rule 2:
    // "Stage transitions only move forward, and only one step at a time. You cannot skip GROWING, and you cannot go back."
    if (batch.stage === 'HARVESTED') {
      throw new ConflictError(`Batch '${batchId}' has already reached HARVESTED and cannot be advanced.`);
    }

    // Rule 3 & 4: HARVESTED cannot be reached via stage advancement
    if (batch.stage === 'HARVEST_READY') {
      throw new BadRequestError(
        `Batch '${batchId}' is in HARVEST_READY. To move to HARVESTED, a harvest must be recorded via POST /batches/${batchId}/harvest.`
      );
    }

    const nextStage = NEXT_STAGE_MAP[batch.stage];
    if (!nextStage) {
      throw new BadRequestError(`Cannot advance batch from stage '${batch.stage}'.`);
    }

    // If caller explicitly provided a target stage in the body, validate that it matches the strictly expected next step
    if (requestedTargetStage && requestedTargetStage !== nextStage) {
      throw new BadRequestError(
        `Invalid stage transition: cannot move from '${batch.stage}' to '${requestedTargetStage}'. Transitions must move forward exactly one step at a time (${batch.stage} -> ${nextStage}).`
      );
    }

    const updated = await this.batchRepo.updateStage(batchId, nextStage);
    if (!updated) {
      throw new NotFoundError(`Batch with ID '${batchId}' was not found.`);
    }

    return updated;
  }

  async getBatchById(id: string): Promise<Batch> {
    const batch = await this.batchRepo.findById(id);
    if (!batch) {
      throw new NotFoundError(`Batch with ID '${id}' was not found.`);
    }
    return batch;
  }

  async listBatches(query: ListBatchesQuery): Promise<PaginatedBatchesResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const offset = (page - 1) * limit;

    const { batches, total } = await this.batchRepo.findAll({
      stage: query.stage,
      crop: query.crop,
      zone: query.zone,
      limit,
      offset,
    });

    return {
      data: batches,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

export const batchService = new BatchService();
