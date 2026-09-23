import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { reportService } from '../services/report.service.js';
import {
  YieldReportQuerySchema,
  YieldReportQuery,
} from '../schemas/report.schema.js';

export const reportRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /reports/yield taking from, to and group_by (either crop or zone)
  app.get<{ Querystring: YieldReportQuery }>(
    '/reports/yield',
    {
      schema: {
        querystring: YieldReportQuerySchema,
      },
    },
    async (request, reply) => {
      const { from, to, group_by } = request.query;
      const report = await reportService.getYieldReport({
        from,
        to,
        groupBy: group_by,
      });

      return reply.status(200).send({
        query: { from, to, group_by },
        ...report,
      });
    }
  );
};
