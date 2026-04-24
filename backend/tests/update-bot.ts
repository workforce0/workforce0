import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Update existing meeting with new bot ID
  const meeting = await prisma.meeting.update({
    where: { id: 'cmkvq6ff3000048vjc4kwk2o1' },
    data: {
      externalId: 'c95fb9e2-9624-4107-80b2-a6e8754d4cda',
      status: 'joining'
    }
  });
  console.log('Updated meeting:', meeting.id);
  console.log('New External ID:', meeting.externalId);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
