/**
 * Diagnostic test for Google Drive access
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🔍 Google Drive Access Diagnostic\n');

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!serviceAccountKey || !folderId) {
    console.error('❌ Missing config');
    return;
  }

  const credentials = JSON.parse(serviceAccountKey);
  console.log('Service Account:', credentials.client_email);
  console.log('Project:', credentials.project_id);
  console.log('Folder ID:', folderId);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
    ],
  });

  const drive = google.drive({ version: 'v3', auth });

  console.log('\n--- Test 1: Check folder access ---');
  try {
    const folderInfo = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,owners',
      supportsAllDrives: true,
    });
    console.log('✅ Folder accessible');
    console.log('   Name:', folderInfo.data.name);
    console.log('   Owner:', folderInfo.data.owners?.[0]?.emailAddress || 'N/A');
  } catch (e: any) {
    console.error('❌ Folder access failed:', e.message);
    if (e.message.includes('not enabled')) {
      console.log('\n⚠️  You need to enable Google Drive API in Cloud Console:');
      console.log(`   https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${credentials.project_id}`);
    }
    return;
  }

  console.log('\n--- Test 2: List folder contents ---');
  try {
    const list = await drive.files.list({
      q: `'${folderId}' in parents`,
      fields: 'files(id,name,mimeType)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    console.log('✅ Can list folder');
    console.log('   Files in folder:', list.data.files?.length || 0);
  } catch (e: any) {
    console.error('❌ List failed:', e.message);
  }

  console.log('\n--- Test 3: Create empty test file ---');
  try {
    const file = await drive.files.create({
      requestBody: {
        name: 'TEST-DELETE-ME.txt',
        mimeType: 'text/plain',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: 'Test content',
      },
      fields: 'id,name',
      supportsAllDrives: true,
    });
    console.log('✅ File created:', file.data.name);
    console.log('   ID:', file.data.id);

    // Clean up
    await drive.files.delete({
      fileId: file.data.id!,
      supportsAllDrives: true
    });
    console.log('✅ Test file deleted');
  } catch (e: any) {
    console.error('❌ Create failed:', e.message);
    if (e.message.includes('quota')) {
      console.log('\n⚠️  Quota error suggests:');
      console.log('   1. Google Drive API may not be enabled');
      console.log('   2. Service account needs Editor access to folder');
      console.log(`\n   Enable Drive API: https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${credentials.project_id}`);
    }
  }

  console.log('\n--- Test 4: Create Google Doc ---');
  try {
    const doc = await drive.files.create({
      requestBody: {
        name: 'TEST-DOC-DELETE-ME',
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });
    console.log('✅ Google Doc created:', doc.data.name);
    console.log('   ID:', doc.data.id);
    console.log('   URL:', doc.data.webViewLink);

    // Clean up
    await drive.files.delete({
      fileId: doc.data.id!,
      supportsAllDrives: true
    });
    console.log('✅ Test doc deleted');
  } catch (e: any) {
    console.error('❌ Doc creation failed:', e.message);
  }
}

main().catch(console.error);
