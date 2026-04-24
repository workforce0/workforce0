import { PrismaClient } from '../prisma/generated/client/index.js';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/workforce0' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const prds = await prisma.pRD.findMany({
    where: { meetingId: 'cmkvry2zb00000wvjbmcut7k0' },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Found ${prds.length} PRDs for meeting\n`);

  for (const prd of prds) {
    console.log('📄 PRD:');
    console.log('   ID:', prd.id);
    console.log('   Title:', prd.title);
    console.log('   Status:', prd.status);
    console.log('   Confidence:', (prd.confidence * 100).toFixed(1) + '%');
    console.log('   Google Doc:', prd.googleDocId ? `https://docs.google.com/document/d/${prd.googleDocId}/edit` : 'Not exported');
    console.log('   Version:', prd.version);
    console.log('');
    console.log('📋 Summary:');
    console.log('  ', String(prd.summary || '').substring(0, 300));
    console.log('');

    const reqs = prd.requirements as Array<{ title?: string; priority?: string }>;
    if (reqs && Array.isArray(reqs)) {
      console.log(`📌 Requirements (${reqs.length} total):`);
      for (const r of reqs.slice(0, 5)) {
        console.log(`   - [${r.priority || 'N/A'}] ${r.title || 'Untitled'}`);
      }
      if (reqs.length > 5) console.log(`   ... and ${reqs.length - 5} more`);
    }
    console.log('\n---\n');
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
