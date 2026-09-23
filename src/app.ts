import fastify, { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';
import { trayRoutes } from './routes/tray.routes.js';
import { batchRoutes } from './routes/batch.routes.js';
import { reportRoutes } from './routes/report.routes.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
    ajv: {
      customOptions: {
        removeAdditional: false,
        allErrors: true,
      },
    },
  });

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  // Register domain route plugins
  app.register(trayRoutes);
  app.register(batchRoutes);
  app.register(reportRoutes);

  // Global Error Handler strictly distinguishing 400, 404, 409, and 500
  app.setErrorHandler((error: any, request, reply) => {
    // 1. Fastify schema validation errors -> 400 Bad Request
    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request validation failed: ' + error.message,
        details: error.validation,
      });
    }

    // 2. Custom Application Errors (BadRequestError, NotFoundError, ConflictError)
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name,
        code: error.code,
        message: error.message,
      });
    }

    // 3. PostgreSQL Database Errors
    const pgError = error as any;
    if (pgError.code === '23505') {
      // unique_violation
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: `Resource conflict: duplicate value violates unique constraint (${pgError.constraint || 'unique'}).`,
      });
    }

    if (pgError.code === '23503') {
      // foreign_key_violation
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Referenced entity does not exist: ${pgError.detail || 'foreign key constraint failed'}.`,
      });
    }

    // 4. Default 500 Internal Server Error
    request.log.error(error);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected internal error occurred.',
    });
  });

  return app;
}
