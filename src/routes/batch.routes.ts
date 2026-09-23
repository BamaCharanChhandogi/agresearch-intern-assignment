import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { batchService } from '../services/batch.service.js';
import { harvestService } from '../services/harvest.service.js';
import {
  CreateBatchSchema,
  CreateBatchInput,
  BatchIdParamSchema,
  BatchIdParam,
  ListBatchesQuerySchema,
  ListBatchesQuery,
  BatchStageEnum,
} from '../schemas/batch.schema.js';
import {
  RecordHarvestSchema,
  RecordHarvestInput,
  HarvestHeadersSchema,
  HarvestHeaders,
} from '../schemas/harvest.schema.js';
import { BatchStage } from '../types.js';

export const batchRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /batches seeds a new batch into a tray
  app.post<{ Body: CreateBatchInput }>(
    '/batches',
    {
      schema: {
        body: CreateBatchSchema,
      },
    },
    async (request, reply) => {
      const batch = await batchService.seedBatch(request.body);
      return reply.status(201).send(batch);
    }
  );

  // GET /batches supports filtering by stage, crop and zone, plus pagination
  app.get<{ Querystring: ListBatchesQuery }>(
    '/batches',
    {
      schema: {
        querystring: ListBatchesQuerySchema,
      },
    },
    async (request, reply) => {
      const result = await batchService.listBatches(request.query);
      return reply.status(200).send(result);
    }
  );

  // GET /batches/:id returns one batch or 404
  app.get<{ Params: BatchIdParam }>(
    '/batches/:id',
    {
      schema: {
        params: BatchIdParamSchema,
      },
    },
    async (request, reply) => {
      const batch = await batchService.getBatchById(request.params.id);
      return reply.status(200).send(batch);
    }
  );

  // PATCH /batches/:id/stage advances a batch by one stage, rejecting invalid transitions
  app.patch<{
    Params: BatchIdParam;
    Body?: { target_stage?: BatchStage };
  }>(
    '/batches/:id/stage',
    {
      schema: {
        params: BatchIdParamSchema,
      },
    },
    async (request, reply) => {
      const targetStage = request.body?.target_stage;
      const updated = await batchService.advanceStage(request.params.id, targetStage);
      return reply.status(200).send(updated);
    }
  );

  // POST /batches/:id/harvest records a harvest and closes out the batch
  // Supports Part 3b Idempotency-Key header for safe retries
  app.post<{
    Params: BatchIdParam;
    Body: RecordHarvestInput;
    Headers: HarvestHeaders;
  }>(
    '/batches/:id/harvest',
    {
      schema: {
        params: BatchIdParamSchema,
        body: RecordHarvestSchema,
        headers: HarvestHeadersSchema,
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      const result = await harvestService.recordHarvest(
        request.params.id,
        request.body,
        idempotencyKey
      );

      if (result.isReplay) {
        reply.header('X-Cache-Lookup', 'HIT');
      }

      return reply.status(result.statusCode).send(result.data);
    }
  );
};
