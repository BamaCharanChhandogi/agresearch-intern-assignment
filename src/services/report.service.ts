import { IReportRepository, reportRepository } from '../repositories/report.repo.js';
import { YieldReportRow } from '../types.js';
import { BadRequestError } from '../errors.js';

export class ReportService {
  constructor(private readonly repo: IReportRepository = reportRepository) {}

  async getYieldReport(params: {
    from: string;
    to: string;
    groupBy: 'crop' | 'zone';
  }): Promise<{ data: YieldReportRow[]; count: number }> {
    if (params.from > params.to) {
      throw new BadRequestError(
        `Invalid date range: 'from' (${params.from}) cannot be after 'to' (${params.to}).`
      );
    }

    const rows = await this.repo.getYieldReport({
      from: params.from,
      to: params.to,
      groupBy: params.groupBy,
    });

    return {
      data: rows,
      count: rows.length,
    };
  }
}

export const reportService = new ReportService();
