/**
 * =============================================================================
 * REPOSITORIES INDEX
 * =============================================================================
 *
 * Central export point for all repository classes.
 *
 * Repository Pattern Overview:
 * ----------------------------
 * Repositories provide an abstraction layer between the business logic
 * (services) and the data access layer (Prisma). This allows:
 *
 * 1. Easy unit testing with mocked repositories
 * 2. Consistent data access patterns across the application
 * 3. Centralized query logic and optimizations
 * 4. Future flexibility to swap data sources
 *
 * @module repositories
 */

export { BaseRepository } from './base.repository.js';
export { MeetingRepository, type MeetingWithTranscript, type FindMeetingsOptions } from './meeting.repository.js';
export { TaskRepository, type TaskWithRelations, type CreateTaskOptions, type FindTasksOptions } from './task.repository.js';
export { PRDRepository, type PRDWithTickets, type CreatePRDInput } from './prd.repository.js';
