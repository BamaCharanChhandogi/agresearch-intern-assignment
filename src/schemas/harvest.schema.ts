import { Type, Static } from '@sinclair/typebox';

export const HarvestGradeEnum = Type.Union([
  Type.Literal('A'),
  Type.Literal('B'),
  Type.Literal('C'),
]);

export const RecordHarvestSchema = Type.Object({
  harvested_on: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' })),
  weight_grams: Type.Number({ exclusiveMinimum: 0, description: 'Harvested weight in grams (> 0)' }),
  grade: HarvestGradeEnum,
}, { additionalProperties: false });

export type RecordHarvestInput = Static<typeof RecordHarvestSchema>;

export const HarvestHeadersSchema = Type.Object({
  'idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
}, { additionalProperties: true });

export type HarvestHeaders = Static<typeof HarvestHeadersSchema>;
