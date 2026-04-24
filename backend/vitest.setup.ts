/**
 * Vitest setup file - runs before all tests
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load .env file for tests
config({ path: join(__dirname, '.env') });

// Set default test environment variables if not set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-that-is-long-enough-32chars';
