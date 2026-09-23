import { IHarvestRepository, harvestRepository } from '../repositories/harvest.repo.js';
import { IBatchRepository, batchRepository } from '../repositories/batch.repo.js';
import {
  IIdempotencyRepository,
  idempotencyRepository,
} from '../repositories/idempotency.repo.js';
import { RecordHarvestInput } from '../schemas/harvest.schema.js';
import { Harvest } from '../types.js';
import { ConflictError, NotFoundError } from '../errors.js';

export interface HarvestExecutionResult {
  isReplay: boolean;
  statusCode: number;
  data: Harvest | Record<string, any>;
}

export class HarvestService {
  constructor(
    private readonly harvestRepo: IHarvestRepository = harvestRepository,
    private readonly batchRepo: IBatchRepository = batchRepository,
    private readonly idempotencyRepo: IIdempotencyRepository = idempotencyRepository
  ) {}

  async recordHarvest(
    batchId: string,
    input: RecordHarvestInput,
    idempotencyKey?: string
  ): Promise<HarvestExecutionResult> {
    // Part 3b: Idempotency Check
    if (idempotencyKey) {
      const existing = await this.idempotencyRepo.findByKey(idempotencyKey);
      if (existing) {
        return {
          isReplay: true,
          statusCode: existing.response_status,
          data: existing.response_body,
        };
      }
    }

    // Pre-flight check for clear, friendly error messages
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new NotFoundError(`Batch with ID '${batchId}' was not found.`);
    }

    // Business Rule 3:
    // "A harvest can only be recorded for a batch in HARVEST_READY."
    if (batch.stage !== 'HARVEST_READY') {
      if (batch.stage === 'HARVESTED') {
        throw new ConflictError(
          `Cannot record harvest: batch '${batchId}' is already in HARVESTED state.`
        );
      }
      throw new ConflictError(
        `Cannot record harvest: batch '${batchId}' is currently in '${batch.stage}'. A harvest can only be recorded when the batch is in 'HARVEST_READY'.`
      );
    }

    // Business Rule 4:
    // "Recording a harvest moves the batch to HARVESTED and frees the tray for reuse."
    // Handled in a single atomic database transaction inside the repository
    const harvest = await this.harvestRepo.createHarvestAndCloseBatch({
      batch_id: batchId,
      weight_grams: input.weight_grams,
      grade: input.grade,
      harvested_on: input.harvested_on,
    });

    // Part 3b: Save idempotency record for 24-hour replay window
    if (idempotencyKey) {
      await this.idempotencyRepo.save({
        key: idempotencyKey,
        batch_id: batchId,
        response_status: 201,
        response_body: harvest,
      });
    }

    return {
      isReplay: false,
      statusCode: 201,
      data: harvest,
    };
  }

  async getHarvestByBatchId(batchId: string): Promise<Harvest> {
    const harvest = await this.harvestRepo.findByBatchId(batchId);
    if (!harvest) {
      throw new NotFoundError(`No harvest found for batch '${batchId}'.`);
    }
    return harvest;
  }
}

export const harvestService = new HarvestService();
