import { Type, Static } from '@sinclair/typebox';

export const YieldReportQuerySchema = Type.Object({
  from: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date YYYY-MM-DD' }),
  to: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date YYYY-MM-DD' }),
  group_by: Type.Union([Type.Literal('crop'), Type.Literal('zone')], {
    description: 'Grouping dimension: crop or zone',
  }),
}, { additionalProperties: false });

export type YieldReportQuery = Static<typeof YieldReportQuerySchema>;
