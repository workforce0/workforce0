# Google Docs Integration Setup

This guide explains how to configure Google Docs export for PRDs in Workforce0.

## Overview

The BA Agent can automatically export generated PRDs to Google Docs, creating executive-quality documents with proper formatting, sections, and styling.

## Prerequisites

1. Google Cloud Project with billing enabled
2. Service Account with appropriate permissions
3. **Shared Drive** (NOT a regular folder) - Service accounts require Shared Drives

## Step-by-Step Setup

### 1. Enable Google APIs

Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Library

Enable these APIs:
- **Google Docs API** - For creating and formatting documents
- **Google Drive API** - For file management and folder access

### 2. Create Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Name: `workforce0` (or similar)
4. Description: "Workforce0 PRD Export Service"
5. Click **Create and Continue**
6. Skip role assignment (permissions via Drive sharing)
7. Click **Done**

### 3. Generate Service Account Key

1. Click on the created service account
2. Go to **Keys** tab
3. Click **Add Key → Create new key**
4. Select **JSON** format
5. Download the key file

### 4. Configure Environment

Add the service account JSON to `mvp/.env`:

```bash
# The entire JSON key as a single line
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project",...}

# Your Drive folder ID
GOOGLE_DRIVE_FOLDER_ID=1ABC123xyz_your_folder_id
```

**Important:** The JSON must be on a single line with no extra whitespace.

### 5. Create a Shared Drive (Required)

⚠️ **IMPORTANT:** Service Accounts cannot create files in regular Google Drive folders.
You MUST use a **Shared Drive** (formerly Team Drive).

1. Go to [Google Drive](https://drive.google.com)
2. In the left sidebar, click **Shared drives**
3. Click **+ New** (or right-click in the empty area → "New shared drive")
4. Name it (e.g., "Workforce0 PRDs")
5. Click **Create**

### 6. Add Service Account to Shared Drive

1. Open the Shared Drive you just created
2. Click the dropdown arrow next to the drive name → **Manage members**
3. Click **Add members**
4. Enter the service account email:
   ```
   workforce0@your-project.iam.gserviceaccount.com
   ```
5. Set role to **Contributor** (or Content Manager)
6. Click **Send**

### 7. Get the Shared Drive ID

Copy the ID from the URL when viewing the Shared Drive:
```
https://drive.google.com/drive/u/0/folders/[SHARED_DRIVE_ID]
```

The ID is the string after `/folders/`.

### 8. Verify Configuration

Run the test:

```bash
cd mvp
npm run test:council
```

If Google Docs is configured correctly, you'll see:
```
📄 PRD exported to Google Docs
   Document URL: https://docs.google.com/document/d/...
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes | Full JSON key as single line |
| `GOOGLE_DRIVE_FOLDER_ID` | Yes | **Shared Drive** ID (not regular folder) |

## Document Structure

Exported PRDs include these sections:

1. **Document Header** - Title, metadata, confidence score
2. **Executive Summary** - Overview, value proposition, capabilities
3. **Problem Statement** - Current state, problems, opportunity
4. **Goals & Objectives** - Vision, measurable objectives, success criteria
5. **Scope** - In scope, out of scope, future considerations
6. **User Stories** - Grouped by priority (Must Have, Should Have, Nice to Have)
7. **Functional Requirements** - Grouped by category
8. **Non-Functional Requirements** - Performance, security, scalability, etc.
9. **Success Metrics** - KPIs with targets and measurements
10. **Risks & Mitigations** - With impact/probability ratings
11. **Assumptions** - Key assumptions made
12. **Open Questions** - Items needing stakeholder clarification
13. **Timeline** - If discussed in meeting

## Troubleshooting

### "Google Docs export skipped (not configured)"

- Check `GOOGLE_SERVICE_ACCOUNT_KEY` is set and valid JSON
- Ensure the JSON is on a single line

### "Error: The caller does not have permission"

- Verify the Drive folder is shared with the service account email
- Ensure the service account has **Editor** access

### "Error: Google Docs API has not been used"

- Enable the Google Docs API in Cloud Console
- Wait a few minutes for propagation

### "Error: The user's Drive storage quota has been exceeded"

This error means you're using a **regular folder** instead of a **Shared Drive**.

- Service accounts have NO storage quota
- They can only create files in Shared Drives
- Solution: Create a Shared Drive (see Step 5 above)

### Documents created but not in folder

- Check `GOOGLE_DRIVE_FOLDER_ID` is correct (must be a Shared Drive ID)
- Verify the service account is a member of the Shared Drive

## Security Notes

1. **Never commit** `.env` or service account keys to git
2. Add to `.gitignore`:
   ```
   .env
   *-service-account*.json
   ```
3. Rotate keys periodically
4. Use separate service accounts for dev/staging/prod

## Code References

- Service implementation: [gdocs.service.ts](../src/services/integrations/gdocs.service.ts)
- BA Agent integration: [ba-agent.service.ts](../src/services/agent/ba-agent.service.ts)
- DI container setup: [di-container.ts](../src/lib/di-container.ts)
