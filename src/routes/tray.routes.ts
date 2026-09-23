import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { trayService } from '../services/tray.service.js';
import {
  CreateTraySchema,
  CreateTrayInput,
  TrayIdParamSchema,
  TrayIdParam,
} from '../schemas/tray.schema.js';

export const trayRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /trays creates a tray
  app.post<{ Body: CreateTrayInput }>(
    '/trays',
    {
      schema: {
        body: CreateTraySchema,
      },
    },
    async (request, reply) => {
      const tray = await trayService.createTray(request.body);
      return reply.status(201).send(tray);
    }
  );

  // GET /trays lists trays
  app.get('/trays', async (_request, reply) => {
    const trays = await trayService.listTrays();
    return reply.status(200).send({ data: trays, count: trays.length });
  });

  // GET /trays/:id returns one tray, or a 404
  app.get<{ Params: TrayIdParam }>(
    '/trays/:id',
    {
      schema: {
        params: TrayIdParamSchema,
      },
    },
    async (request, reply) => {
      const tray = await trayService.getTrayById(request.params.id);
      return reply.status(200).send(tray);
    }
  );
};
