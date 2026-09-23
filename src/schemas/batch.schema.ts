import { Type, Static } from '@sinclair/typebox';

export const BatchStageEnum = Type.Union([
  Type.Literal('SEEDED'),
  Type.Literal('GERMINATION'),
  Type.Literal('GROWING'),
  Type.Literal('HARVEST_READY'),
  Type.Literal('HARVESTED'),
]);

export const CreateBatchSchema = Type.Object({
  tray_id: Type.String({ minLength: 1, description: 'Target Tray UUID' }),
  crop: Type.String({ minLength: 1, maxLength: 100, description: 'Crop type e.g. Butterhead Lettuce' }),
  seeded_on: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' })),
  expected_harvest_on: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' })),
}, { additionalProperties: false });

export type CreateBatchInput = Static<typeof CreateBatchSchema>;

export const BatchIdParamSchema = Type.Object({
  id: Type.String({ minLength: 1, description: 'Batch UUID' }),
});

export type BatchIdParam = Static<typeof BatchIdParamSchema>;

export const ListBatchesQuerySchema = Type.Object({
  stage: Type.Optional(BatchStageEnum),
  crop: Type.Optional(Type.String({ minLength: 1 })),
  zone: Type.Optional(Type.String({ minLength: 1 })),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
}, { additionalProperties: false });

export type ListBatchesQuery = Static<typeof ListBatchesQuerySchema>;
