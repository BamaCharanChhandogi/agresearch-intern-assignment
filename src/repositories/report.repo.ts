import { query } from '../db/pool.js';
import { YieldReportRow } from '../types.js';

export interface IReportRepository {
  getYieldReport(params: {
    from: string;
    to: string;
    groupBy: 'crop' | 'zone';
  }): Promise<YieldReportRow[]>;
}

export class PostgresReportRepository implements IReportRepository {
  async getYieldReport(params: {
    from: string;
    to: string;
    groupBy: 'crop' | 'zone';
  }): Promise<YieldReportRow[]> {
    // Whitelist group column to eliminate any SQL injection vector while ensuring standard SQL aggregation
    const groupColumn = params.groupBy === 'crop' ? 'b.crop' : 't.zone';

    // Single consolidated SQL query:
    // - Computes total weight, batch counts, and average growth duration in days
    // - Zero loops, zero multiple round-trips
    const sql = `
      SELECT
        ${groupColumn} AS group_key,
        COUNT(*)::int AS batches_harvested,
        ROUND(SUM(h.weight_grams)::numeric, 2)::float AS total_weight_grams,
        ROUND(AVG(h.harvested_on - b.seeded_on)::numeric, 1)::float AS avg_days_to_harvest
      FROM harvests h
      JOIN batches b ON b.id = h.batch_id
      JOIN trays t ON t.id = b.tray_id
      WHERE h.harvested_on >= $1::date AND h.harvested_on <= $2::date
      GROUP BY ${groupColumn}
      ORDER BY total_weight_grams DESC;
    `;

    const res = await query<YieldReportRow>(sql, [params.from, params.to]);
    return res.rows.map((row) => ({
      group_key: row.group_key,
      batches_harvested: Number(row.batches_harvested),
      total_weight_grams: Number(row.total_weight_grams),
      avg_days_to_harvest: Number(row.avg_days_to_harvest),
    }));
  }
}

export const reportRepository = new PostgresReportRepository();
