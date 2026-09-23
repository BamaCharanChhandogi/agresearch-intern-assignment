import { Type, Static } from '@sinclair/typebox';

export const CreateTraySchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Unique code for tray e.g. T-A-014' }),
  zone: Type.String({ minLength: 1, maxLength: 50, description: 'Facility zone e.g. Zone-A' }),
  capacity_units: Type.Integer({ minimum: 1, description: 'Growing capacity in units' }),
}, { additionalProperties: false });

export type CreateTrayInput = Static<typeof CreateTraySchema>;

export const TrayIdParamSchema = Type.Object({
  id: Type.String({ minLength: 1, description: 'Tray UUID' }),
});

export type TrayIdParam = Static<typeof TrayIdParamSchema>;
