import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/workforce0',
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('Checking tenants...');
  const tenants = await prisma.tenant.findMany();
  console.log('Found tenants:', tenants);

  const existing = tenants.find(t => t.id === 'test-tenant-real');
  if (!existing) {
    console.log('Creating test-tenant-real...');
    const tenant = await prisma.tenant.create({
      data: {
        id: 'test-tenant-real',
        name: 'Test Tenant Real',
        settings: {},
      },
    });
    console.log('Created tenant:', tenant);
  } else {
    console.log('Tenant test-tenant-real already exists');
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
