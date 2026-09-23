import { ITrayRepository, trayRepository } from '../repositories/tray.repo.js';
import { CreateTrayInput } from '../schemas/tray.schema.js';
import { Tray } from '../types.js';
import { ConflictError, NotFoundError } from '../errors.js';

export class TrayService {
  constructor(private readonly repo: ITrayRepository = trayRepository) {}

  async createTray(input: CreateTrayInput): Promise<Tray> {
    // 1. Application-level check for clear feedback
    const existing = await this.repo.findByCode(input.code);
    if (existing) {
      throw new ConflictError(`A tray with code '${input.code}' already exists.`);
    }

    try {
      return await this.repo.create(input);
    } catch (err: any) {
      // 2. Database-level safety net (PostgreSQL unique_violation code 23505)
      if (err.code === '23505') {
        throw new ConflictError(`A tray with code '${input.code}' already exists.`);
      }
      throw err;
    }
  }

  async listTrays(): Promise<Tray[]> {
    return this.repo.findAll();
  }

  async getTrayById(id: string): Promise<Tray> {
    const tray = await this.repo.findById(id);
    if (!tray) {
      throw new NotFoundError(`Tray with ID '${id}' was not found.`);
    }
    return tray;
  }
}

export const trayService = new TrayService();
