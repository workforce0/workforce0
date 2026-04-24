import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const meeting = await prisma.meeting.create({
    data: {
      title: 'Full Integration Test',
      tenantId: 'test-tenant-real',
      status: 'joining',
      externalId: '23a50ade-ef17-4199-bf4e-d3ef11d6de57',
      startTime: new Date(),
      meetingUrl: 'https://meet.google.com/qsh-bnyw-fyt',
      metadata: {
        platform: 'google_meet'
      }
    }
  });
  console.log('Created meeting:', meeting.id);
  console.log('External ID:', meeting.externalId);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
