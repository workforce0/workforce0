# Google Drive & Docs Integration Setup Guide

## Overview

Workforce0 exports AI-generated PRDs (Product Requirements Documents) directly to Google Docs in your Google Drive. This integration provides:

- **Executive-Quality Documents**: Professionally formatted PRDs
- **Real-Time Collaboration**: Team can review and comment in Google Docs
- **Version History**: Google Docs tracks all changes
- **Easy Sharing**: Share PRDs with stakeholders using Google's permissions

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GOOGLE DRIVE INTEGRATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐                      ┌─────────────────┐           │
│  │   Workforce0    │   Service Account    │  Shared Drive   │           │
│  │   Backend       │ ──────────────────>  │  (Team Drive)   │           │
│  │                 │   Creates PRD Docs   │                 │           │
│  │                 │                      │  📄 PRD v1.0    │           │
│  │                 │                      │  📄 PRD v1.1    │           │
│  │                 │                      │  📄 PRD v2.0    │           │
│  └─────────────────┘                      └─────────────────┘           │
│                                                 │                        │
│                                                 │ Shared with team       │
│                                                 ▼                        │
│                                           ┌─────────────────┐           │
│                                           │  Team Members   │           │
│                                           │  (View/Edit)    │           │
│                                           └─────────────────┘           │
│                                                                          │
│  Why Shared Drive?                                                       │
│  • Service accounts have NO storage quota                               │
│  • Files must be created in Shared Drives                               │
│  • Team collaboration built-in                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Setup Guide

### Part 1: Google Cloud Project Setup

#### Step 1.1: Create or Select Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown at the top
3. Click **New Project** (or select existing)
4. Configure:
   - **Project name**: `workforce0` (or your company name)
   - **Organization**: Your organization (if applicable)
   - **Location**: Select your organization folder
5. Click **Create**
6. Wait for project creation (may take a minute)

**Screenshot location for UI**: Project selector dropdown → New Project button

#### Step 1.2: Enable Required APIs

1. In your project, click **APIs & Services** in the left menu
2. Click **+ ENABLE APIS AND SERVICES** at the top
3. Search and enable each API:

**Google Drive API:**
1. Search "Google Drive API"
2. Click on **Google Drive API**
3. Click **Enable**
4. Wait for activation

**Google Docs API:**
1. Click **+ ENABLE APIS AND SERVICES** again
2. Search "Google Docs API"
3. Click on **Google Docs API**
4. Click **Enable**
5. Wait for activation

**Verification:**
- Go to **APIs & Services** → **Enabled APIs**
- Confirm both APIs appear in the list

---

### Part 2: Service Account Setup

#### Step 2.1: Create Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **+ CREATE SERVICE ACCOUNT** at the top
3. Fill in details:
   - **Service account name**: `workforce0-drive`
   - **Service account ID**: `workforce0-drive` (auto-filled)
   - **Description**: "Workforce0 Google Drive/Docs integration"
4. Click **CREATE AND CONTINUE**
5. **Skip** the "Grant access" step (click **CONTINUE**)
6. **Skip** the "Grant users access" step (click **DONE**)

**Screenshot location for UI**: IAM & Admin → Service Accounts → Create Service Account form

#### Step 2.2: Generate Service Account Key

1. Find your service account in the list
2. Click the **email** to open details
3. Click **KEYS** tab
4. Click **ADD KEY** → **Create new key**
5. Select **JSON** format
6. Click **CREATE**
7. **Important**: A JSON file downloads automatically - save this securely!

**Key file looks like:**
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "workforce0-drive@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  ...
}
```

**Important:** Note the `client_email` - you'll need this to share the Drive folder.

---

### Part 3: Google Drive Shared Drive Setup

#### Why Shared Drives?

**Critical Information:**
- Service accounts do **NOT** have their own Google Drive storage
- They cannot create files in regular folders (even if shared)
- You **MUST** use a **Shared Drive** (formerly Team Drive)
- This is a Google limitation, not a Workforce0 limitation

#### Step 3.1: Create Shared Drive

1. Go to [Google Drive](https://drive.google.com)
2. In the left sidebar, look for **Shared drives**
   - If you don't see it, click **More** to expand
3. Click **Shared drives**
4. Right-click in the empty area → **New shared drive**
   - Or use the **+ New** button if available
5. Name it: `Workforce0 PRDs`
6. Click **Create**

**Screenshot location for UI**: Google Drive left sidebar → Shared drives section

#### Step 3.2: Add Service Account to Shared Drive

1. Open the **Workforce0 PRDs** Shared Drive
2. Click the **dropdown arrow** next to the drive name (top-left)
3. Select **Manage members**
4. Click **Add members**
5. In the email field, paste your service account email:
   ```
   workforce0-drive@your-project.iam.gserviceaccount.com
   ```
6. Set access level: **Contributor** (or **Content Manager**)
7. Click **Send**

**Access Levels Explained:**
| Level | Can Create | Can Edit | Can Delete | Can Share |
|-------|-----------|----------|------------|-----------|
| Viewer | ❌ | ❌ | ❌ | ❌ |
| Commenter | ❌ | ❌ | ❌ | ❌ |
| **Contributor** | ✅ | ✅ | Own files | ❌ |
| Content Manager | ✅ | ✅ | ✅ | ❌ |
| Manager | ✅ | ✅ | ✅ | ✅ |

**Recommended**: Use **Contributor** for least-privilege access.

#### Step 3.3: Get Shared Drive ID

1. Open the Shared Drive in your browser
2. Look at the URL:
   ```
   https://drive.google.com/drive/u/0/folders/1ABC123xyz_THIS_IS_THE_ID
   ```
3. Copy the ID after `/folders/`

**Example:**
- URL: `https://drive.google.com/drive/u/0/folders/10Z9g84BnLmWIgF5RGCJBerhUyvgvgwy9`
- ID: `10Z9g84BnLmWIgF5RGCJBerhUyvgvgwy9`

---

### Part 4: Configure Workforce0

#### Step 4.1: Prepare the Credentials

The service account JSON key needs to be converted to a single line for the environment variable.

**Option A: Manual Conversion**
1. Open the JSON key file in a text editor
2. Remove all newlines (make it one line)
3. Escape newlines in the private key: Replace actual newlines with `\n`

**Option B: Use a Script**
```bash
# macOS/Linux
cat your-key-file.json | jq -c '.'

# Or using node
node -e "console.log(JSON.stringify(require('./your-key-file.json')))"
```

#### Step 4.2: Set Environment Variables

Add to your `.env` file:

```bash
# Google Drive/Docs Integration
# Service account key as single-line JSON
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project",...}

# Shared Drive ID (from Part 3, Step 3.3)
GOOGLE_DRIVE_FOLDER_ID=10Z9g84BnLmWIgF5RGCJBerhUyvgvgwy9
```

**Important:**
- The JSON must be on a single line
- No quotes around the JSON value
- The ID is the Shared Drive ID, not a folder inside it

#### Step 4.3: Via Workforce0 UI (Coming Soon)

The Workforce0 settings UI will provide:
1. **Upload JSON Key**: Upload the key file directly
2. **Connect to Drive**: OAuth flow to select Shared Drive
3. **Test Connection**: Verify setup works
4. **View Documents**: See created PRDs

---

### Part 5: Verification

#### Step 5.1: Test the Connection

Run the diagnostic test:

```bash
cd mvp
npx tsx tests/test-drive-access.ts
```

**Expected Output:**
```
🔍 Google Drive Access Diagnostic

Service Account: workforce0-drive@your-project.iam.gserviceaccount.com
Project: your-project
Folder ID: 10Z9g84BnLmWIgF5RGCJBerhUyvgvgwy9

--- Test 1: Check folder access ---
✅ Folder accessible
   Name: Workforce0 PRDs
   Owner: N/A

--- Test 2: List folder contents ---
✅ Can list folder
   Files in folder: 0

--- Test 3: Create empty test file ---
✅ File created: TEST-DELETE-ME.txt
   ID: 1ABC123...
✅ Test file deleted

--- Test 4: Create Google Doc ---
✅ Google Doc created: TEST-DOC-DELETE-ME
   ID: 1XYZ789...
   URL: https://docs.google.com/document/d/1XYZ789.../edit
✅ Test doc deleted
```

#### Step 5.2: Test PRD Export

Run the full PRD export test:

```bash
cd mvp
npx tsx tests/test-gdocs-export.ts
```

**Expected Output:**
```
🚀 Google Docs Export Test

✅ Service account configured
📁 Target folder: 10Z9g84BnLmWIgF5RGCJBerhUyvgvgwy9
✅ Credentials parsed
   Project: your-project
   Email: workforce0-drive@your-project.iam.gserviceaccount.com

📋 PRD loaded: Your PRD Title

✅ Google Docs service initialized
📄 Creating document...

✅ Document created successfully!
──────────────────────────────────────────────────
📄 Document ID: 1ABC123xyz...
🔗 Document URL: https://docs.google.com/document/d/1ABC123xyz.../edit
──────────────────────────────────────────────────
```

---

## Troubleshooting

### Error: "The user's Drive storage quota has been exceeded"

**Cause:** You're using a regular folder instead of a Shared Drive.

**Solution:**
1. Create a Shared Drive (Part 3)
2. Add service account to the Shared Drive
3. Use the Shared Drive ID (not a folder inside it)

### Error: "The caller does not have permission"

**Causes & Solutions:**
1. **Service account not added**: Add service account to Shared Drive
2. **Wrong email**: Double-check the service account email
3. **Insufficient access**: Ensure "Contributor" or higher role
4. **Wrong folder**: Ensure ID is for a Shared Drive, not regular folder

### Error: "Google Docs API has not been used in project"

**Solution:**
1. Go to Google Cloud Console
2. Enable Google Docs API (Part 1, Step 1.2)
3. Wait 2-3 minutes for propagation

### Error: "Invalid JSON in GOOGLE_SERVICE_ACCOUNT_KEY"

**Causes & Solutions:**
1. JSON has newlines - must be single line
2. Extra quotes around the value
3. Corrupted key file - regenerate from Google Cloud Console

### Documents not appearing in Shared Drive

**Check:**
1. Correct Shared Drive ID in `GOOGLE_DRIVE_FOLDER_ID`
2. Service account is a member
3. No errors in server logs

---

## Document Output Format

PRDs exported to Google Docs include:

### Document Structure

```
┌────────────────────────────────────────────────────────────┐
│  PRODUCT REQUIREMENTS DOCUMENT                             │
│  [Product Title]                                           │
├────────────────────────────────────────────────────────────┤
│  Version: 1.0.0  |  Generated: Jan 15, 2024               │
│  Confidence: 85%  |  Meeting: Product Planning Call        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. EXECUTIVE SUMMARY                                      │
│     1.1 Overview                                           │
│     1.2 Value Proposition                                  │
│     1.3 Core Capabilities                                  │
│                                                            │
│  2. PROBLEM STATEMENT                                      │
│     2.1 Current State                                      │
│     2.2 Problems to Solve                                  │
│                                                            │
│  3. GOALS & OBJECTIVES                                     │
│     3.1 Vision                                             │
│     3.2 Measurable Objectives                              │
│     3.3 Success Criteria                                   │
│                                                            │
│  4. SCOPE                                                  │
│     4.1 In Scope                                           │
│     4.2 Out of Scope                                       │
│                                                            │
│  5. USER STORIES                                           │
│     5.1 Must Have (P0)                                     │
│     5.2 Should Have (P1)                                   │
│     5.3 Nice to Have (P2)                                  │
│                                                            │
│  6. FUNCTIONAL REQUIREMENTS                                │
│                                                            │
│  7. NON-FUNCTIONAL REQUIREMENTS                            │
│                                                            │
│  8. SUCCESS METRICS                                        │
│                                                            │
│  9. RISKS & MITIGATIONS                                    │
│                                                            │
│  10. ASSUMPTIONS                                           │
│                                                            │
│  11. OPEN QUESTIONS (ACTION REQUIRED)                      │
│      Q1. [Question needing answer]                         │
│      Q2. [Another question]                                │
│                                                            │
│  12. TIMELINE                                              │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  Generated by Workforce0 AI                                │
│  2024-01-15T10:30:00.000Z                                 │
└────────────────────────────────────────────────────────────┘
```

### Formatting Features

- **Color-coded confidence**: Green (high), Yellow (medium), Red (low)
- **Priority indicators**: Red (P0), Orange (P1), Green (P2)
- **Checkboxes** for success criteria
- **Risk ratings** with impact/probability colors
- **Section headers** with consistent styling

---

## Security Best Practices

### Service Account Key Security

1. **Never commit keys to git**
   ```bash
   # Add to .gitignore
   *-service-account*.json
   *.json  # if in credentials folder
   .env
   ```

2. **Use environment variables**
   - Store key in `.env` (not committed)
   - Use secrets manager in production

3. **Rotate keys periodically**
   - Create new key
   - Update environment
   - Delete old key

4. **Separate accounts per environment**
   - Dev: `workforce0-drive-dev@...`
   - Staging: `workforce0-drive-staging@...`
   - Prod: `workforce0-drive-prod@...`

### Shared Drive Access

1. **Principle of least privilege**
   - Use "Contributor" not "Manager"
   - Service account only needs create/edit

2. **Audit access regularly**
   - Review who has access to Shared Drive
   - Remove unused service accounts

3. **Monitor activity**
   - Google Admin Console shows Drive audit logs
   - Track document creation/access

---

## UI Integration Points

For building the Workforce0 settings UI:

### Configuration Form Fields

| Field | Type | Validation | Help Text |
|-------|------|------------|-----------|
| Service Account Key | File Upload / Textarea | Valid JSON with required fields | "Upload the JSON key file from Google Cloud Console" |
| Shared Drive ID | Text Input | Non-empty, valid format | "Found in the URL when viewing your Shared Drive" |

### API Endpoints

```
# Test connection
POST /api/settings/integrations/google-drive/test
Body: { serviceAccountKey: "...", sharedDriveId: "..." }
Response: { success: true, driveName: "Workforce0 PRDs" }

# Save configuration
POST /api/settings/integrations/google-drive/configure
Body: { serviceAccountKey: "...", sharedDriveId: "..." }
Response: { success: true }

# Get status
GET /api/settings/integrations/google-drive/status
Response: {
  enabled: true,
  driveName: "Workforce0 PRDs",
  documentsCount: 15,
  lastCreatedAt: "2024-01-15T10:30:00Z"
}
```

### Setup Wizard Steps

1. **Welcome**: Explain what the integration does
2. **Project Setup**: Guide to create/select Google Cloud project
3. **Enable APIs**: Direct links to enable Docs and Drive APIs
4. **Service Account**: Guide to create and download key
5. **Shared Drive**: Guide to create and configure
6. **Configure**: Input fields for key and drive ID
7. **Test**: Verify connection works
8. **Complete**: Show success and what happens next

---

## Code References

- Service: [gdocs.service.ts](../src/services/integrations/gdocs.service.ts)
- Test: [test-drive-access.ts](../tests/test-drive-access.ts)
- Test: [test-gdocs-export.ts](../tests/test-gdocs-export.ts)
- Config: [config/index.ts](../src/config/index.ts)
