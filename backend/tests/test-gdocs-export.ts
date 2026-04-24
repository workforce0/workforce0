/**
 * Test Google Docs Export
 * Run with: npx tsx tests/test-gdocs-export.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🚀 Google Docs Export Test\n');

  // Check config
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!serviceAccountKey) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY not set in .env');
    return;
  }

  if (!folderId) {
    console.error('❌ GOOGLE_DRIVE_FOLDER_ID not set in .env');
    return;
  }

  console.log('✅ Service account configured');
  console.log('📁 Target folder:', folderId);

  // Parse credentials
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountKey);
    console.log('✅ Credentials parsed');
    console.log('   Project:', credentials.project_id);
    console.log('   Email:', credentials.client_email);
  } catch (e) {
    console.error('❌ Failed to parse service account JSON:', (e as Error).message);
    return;
  }

  // Load PRD from previous test
  const prdPath = path.resolve(__dirname, 'prd-output.json');
  if (!fs.existsSync(prdPath)) {
    console.error('❌ PRD output not found. Run test-ai-council.ts first.');
    return;
  }

  const councilResult = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  const prd = councilResult.prd;
  console.log('\n📋 PRD loaded:', prd.title);

  // Initialize Google Docs service
  const { GoogleDocsService } = await import('../src/services/integrations/gdocs.service.js');

  const gdocsService = new GoogleDocsService({
    credentials,
    defaultFolderId: folderId,
  });

  if (!gdocsService.isAvailable()) {
    console.error('❌ Google Docs service not available');
    return;
  }

  console.log('\n✅ Google Docs service initialized');
  console.log('─'.repeat(50));
  console.log('📄 Creating document...\n');

  try {
    const result = await gdocsService.createPRDDocument({
      metadata: prd.metadata,
      title: prd.title,
      executiveSummary: prd.executiveSummary,
      problemStatement: prd.problemStatement,
      goals: prd.goals,
      scope: prd.scope,
      userStories: prd.userStories,
      functionalRequirements: prd.functionalRequirements,
      nonFunctionalRequirements: prd.nonFunctionalRequirements,
      successMetrics: prd.successMetrics,
      risks: prd.risks,
      assumptions: prd.assumptions,
      openQuestions: prd.openQuestions,
      timeline: prd.timeline,
      confidence: prd.confidence,
      reasoning: prd.reasoning,
    });

    console.log('✅ Document created successfully!\n');
    console.log('─'.repeat(50));
    console.log('📄 Document ID:', result.documentId);
    console.log('🔗 Document URL:', result.documentUrl);
    console.log('─'.repeat(50));
    console.log('\n👆 Open the URL above to view the PRD in Google Docs');

  } catch (error) {
    console.error('\n❌ Failed to create document:', (error as Error).message);
    console.error((error as Error).stack);
  }
}

main().catch(console.error);
