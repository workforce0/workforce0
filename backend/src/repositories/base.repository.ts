/**
 * =============================================================================
 * BASE REPOSITORY
 * =============================================================================
 *
 * Abstract base class for all repositories implementing the Repository Pattern.
 *
 * What is the Repository Pattern?
 * -------------------------------
 * The Repository Pattern provides an abstraction layer between the business
 * logic and the data access layer. Benefits include:
 *
 * 1. **Testability**: Easy to mock repositories in unit tests
 * 2. **Flexibility**: Can swap data sources without changing business logic
 * 3. **Consistency**: All data access goes through a unified interface
 * 4. **Encapsulation**: Database queries are encapsulated in one place
 *
 * How to Use:
 * -----------
 * 1. Create a new repository extending BaseRepository
 * 2. Implement required methods (if any abstract methods exist)
 * 3. Add domain-specific query methods
 *
 * @example
 * ```typescript
 * // Creating a new repository
 * class UserRepository extends BaseRepository<User, 'User'> {
 *   constructor(prisma: PrismaClient) {
 *     super(prisma, 'User');
 *   }
 *
 *   // Add domain-specific methods
 *   async findByEmail(email: string): Promise<User | null> {
 *     return this.model.findFirst({ where: { email } });
 *   }
 * }
 * ```
 *
 * @module repositories/base
 */

import { PrismaClient } from '../../prisma/generated/client/index.js';
import { logger, createChildLogger } from '../lib/logger.js';

/**
 * Generic type for Prisma model delegates.
 *
 * This extracts the correct model type from PrismaClient based on the model name.
 * For example: PrismaDelegate<PrismaClient, 'Meeting'> gives us the Meeting model.
 */
type PrismaDelegate<T extends PrismaClient, K extends keyof T> = T[K];

/**
 * Base repository class providing common CRUD operations.
 *
 * @typeParam T - The entity type (e.g., Meeting, Task)
 * @typeParam ModelName - The Prisma model name as a string literal
 */
export abstract class BaseRepository<T, ModelName extends string> {
  protected readonly prisma: PrismaClient;
  protected readonly modelName: ModelName;
  protected readonly logger: ReturnType<typeof createChildLogger>;

  /**
   * Creates an instance of BaseRepository.
   *
   * @param prisma - Prisma client instance
   * @param modelName - Name of the Prisma model (e.g., 'Meeting', 'Task')
   */
  constructor(prisma: PrismaClient, modelName: ModelName) {
    this.prisma = prisma;
    this.modelName = modelName;
    this.logger = createChildLogger({ repository: modelName });
  }

  /**
   * Gets the Prisma model delegate for this repository.
   *
   * This is a helper to access the correct Prisma model with type safety.
   *
   * @returns The Prisma model delegate
   */
  protected get model(): any {
    return (this.prisma as any)[this.modelName.toLowerCase()];
  }

  /**
   * Find a single record by ID.
   *
   * @param id - The record ID
   * @returns The found record or null
   *
   * @example
   * ```typescript
   * const meeting = await meetingRepository.findById('meeting_123');
   * if (!meeting) {
   *   throw Errors.notFound('Meeting', 'meeting_123');
   * }
   * ```
   */
  async findById(id: string): Promise<T | null> {
    this.logger.debug('Finding by ID', { id });
    return this.model.findUnique({ where: { id } });
  }

  /**
   * Find all records matching the given filter.
   *
   * @param filter - Prisma where clause
   * @param options - Additional options (pagination, sorting)
   * @returns Array of matching records
   *
   * @example
   * ```typescript
   * const meetings = await meetingRepository.findMany(
   *   { tenantId: 'tenant_123', status: 'completed' },
   *   { take: 10, skip: 0, orderBy: { createdAt: 'desc' } }
   * );
   * ```
   */
  async findMany(
    filter: Record<string, unknown> = {},
    options: {
      take?: number;
      skip?: number;
      orderBy?: Record<string, 'asc' | 'desc'>;
    } = {}
  ): Promise<T[]> {
    this.logger.debug('Finding many', { filter, options });
    return this.model.findMany({
      where: filter,
      ...options,
    });
  }

  /**
   * Create a new record.
   *
   * @param data - The data to create
   * @returns The created record
   *
   * @example
   * ```typescript
   * const meeting = await meetingRepository.create({
   *   tenantId: 'tenant_123',
   *   title: 'Sprint Planning',
   *   meetingUrl: 'https://meet.google.com/abc-defg-hij',
   *   startTime: new Date(),
   * });
   * ```
   */
  async create(data: Partial<T>): Promise<T> {
    this.logger.debug('Creating record', { data });
    const result = await this.model.create({ data });
    this.logger.info('Record created', { id: result.id });
    return result;
  }

  /**
   * Update an existing record.
   *
   * @param id - The record ID to update
   * @param data - The data to update
   * @returns The updated record
   *
   * @example
   * ```typescript
   * const meeting = await meetingRepository.update('meeting_123', {
   *   status: 'completed',
   *   endTime: new Date(),
   * });
   * ```
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    this.logger.debug('Updating record', { id, data });
    const result = await this.model.update({
      where: { id },
      data,
    });
    this.logger.info('Record updated', { id });
    return result;
  }

  /**
   * Delete a record by ID.
   *
   * @param id - The record ID to delete
   * @returns The deleted record
   *
   * @example
   * ```typescript
   * await meetingRepository.delete('meeting_123');
   * ```
   */
  async delete(id: string): Promise<T> {
    this.logger.debug('Deleting record', { id });
    const result = await this.model.delete({ where: { id } });
    this.logger.info('Record deleted', { id });
    return result;
  }

  /**
   * Count records matching the filter.
   *
   * @param filter - Prisma where clause
   * @returns Number of matching records
   */
  async count(filter: Record<string, unknown> = {}): Promise<number> {
    return this.model.count({ where: filter });
  }

  /**
   * Check if a record exists.
   *
   * @param filter - Prisma where clause
   * @returns True if at least one record exists
   */
  async exists(filter: Record<string, unknown>): Promise<boolean> {
    const count = await this.model.count({ where: filter, take: 1 });
    return count > 0;
  }

  /**
   * Execute operations in a transaction.
   *
   * Use this when you need to ensure multiple operations succeed or fail together.
   *
   * @param fn - Function containing operations to run in transaction
   * @returns Result of the transaction
   *
   * @example
   * ```typescript
   * await meetingRepository.transaction(async (tx) => {
   *   const meeting = await tx.meeting.create({ data: meetingData });
   *   await tx.transcript.create({ data: { ...transcriptData, meetingId: meeting.id } });
   *   return meeting;
   * });
   * ```
   */
  async transaction<R>(
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<R>
  ): Promise<R> {
    this.logger.debug('Starting transaction');
    return this.prisma.$transaction(fn);
  }
}
