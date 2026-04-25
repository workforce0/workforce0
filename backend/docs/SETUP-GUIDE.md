# Workforce0 MVP - Developer Setup Guide

This guide will help you set up the Workforce0 MVP on your local machine.

---

## Prerequisites

### Required Software

| Software | Version | Download |
|----------|---------|----------|
| **Node.js** | 20.x or higher | [nodejs.org](https://nodejs.org/) |
| **Docker Desktop** | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Git** | Latest | [git-scm.com](https://git-scm.com/) |

### API Keys (Required)

| Service | Purpose | Get Key |
|---------|---------|---------|
| **Gemini API** | AI processing | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

### API Keys (Optional - for full features)

| Service | Purpose | Get Key |
|---------|---------|---------|
| **OpenAI API** | Voice bot (Realtime API) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Twilio** | Dial-in voice bot | [twilio.com/console](https://www.twilio.com/console) |
| **Vexa** (BYO) | Meeting bot (optional, self-hosted) | [Vexa-ai/vexa](https://github.com/Vexa-ai/vexa) — set `VEXA_API_URL` |
| **Jira** | Ticket creation | [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| **Google Chat** | Notifications | Google Workspace Admin |

---

## Setup Instructions

### Step 1: Clone the Repository

```bash
git clone https://github.com/workforce0/workforce0.git
cd workforce0/mvp
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Start Docker Containers

Start PostgreSQL and Redis:

```bash
docker-compose up -d
```

Verify containers are running:

```bash
docker ps
```

You should see:
- `workforce0-mvp-postgres` on port 5432
- `workforce0-mvp-redis` on port 6379

### Step 4: Configure Environment Variables

Copy the example environment file:

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**Mac/Linux:**
```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# REQUIRED - Get from https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# REQUIRED - Generate a random 32+ character string
JWT_SECRET=your-secret-key-at-least-32-characters-long

# These are pre-configured for Docker
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce0
REDIS_URL=redis://localhost:6379/0

# OPTIONAL - Voice Bot (Twilio dial-in + OpenAI Realtime)
OPENAI_API_KEY=sk-your-openai-key
TWILIO_ACCOUNT_SID=ACxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

> **Voice Bot Setup:** To use the dial-in voice bot, you need a Twilio account with a phone number and an OpenAI API key. You also need a public URL for webhooks - use [ngrok](https://ngrok.com/) during development: `ngrok http 3000`

### Step 5: Initialize Database

Generate Prisma client:

```bash
npx prisma generate
```

Run database migrations:

```bash
npx prisma migrate dev --name init
```

### Step 6: Start Development Server

```bash
npm run dev
```

The API will be available at: `http://localhost:3000`

---

## Verification

### Check API Health

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"ok"}
```

### View Database (Optional)

Open Prisma Studio to browse the database:

```bash
npx prisma studio
```

This opens a web UI at `http://localhost:5555`

---

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema changes (no migration) |
| `npm run db:studio` | Open Prisma Studio |
| `docker-compose up -d` | Start Docker containers |
| `docker-compose down` | Stop Docker containers |
| `docker-compose logs -f` | View container logs |

---

## Platform-Specific Notes

### Windows

1. **Docker Desktop**: Enable WSL2 backend for better performance
   - Settings → General → "Use WSL 2 based engine"

2. **PowerShell Execution Policy**: If scripts fail, run:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

3. **Line Endings**: Configure Git to handle line endings:
   ```bash
   git config --global core.autocrlf true
   ```

### macOS

1. **Docker Desktop**: Allocate sufficient resources
   - Settings → Resources → Memory: 4GB minimum

2. **Homebrew** (optional but recommended):
   ```bash
   brew install node@20
   ```

### Linux (Ubuntu/Debian)

1. **Docker**: Install Docker Engine (not Desktop):
   ```bash
   sudo apt update
   sudo apt install docker.io docker-compose
   sudo usermod -aG docker $USER
   # Log out and back in for group changes to take effect
   ```

2. **Node.js via nvm** (recommended):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 20
   nvm use 20
   ```

---

## Troubleshooting

### Docker Issues

**"Cannot connect to Docker daemon"**
- Ensure Docker Desktop is running
- On Linux, check: `sudo systemctl status docker`

**Port already in use**
```bash
# Find process using port 5432
# Windows
netstat -ano | findstr :5432

# Mac/Linux
lsof -i :5432
```

### Database Issues

**"Connection refused" to PostgreSQL**
1. Check Docker container is running: `docker ps`
2. Check logs: `docker-compose logs postgres`
3. Verify DATABASE_URL in `.env`

**Migration fails**
```bash
# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Prisma Issues

**"Cannot find module '@prisma/client'"**
```bash
npx prisma generate
```

**Schema out of sync**
```bash
npx prisma db push --force-reset
```

### Node.js Issues

**"Module not found" errors**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Wrong Node version**
```bash
node --version  # Should be 20.x or higher
```

---

## Project Structure

```
mvp/
├── prisma/
│   ├── schema.prisma      # Database schema
│   ├── migrations/        # Migration files
│   └── generated/         # Generated Prisma client
├── src/
│   ├── config/            # Environment configuration
│   ├── lib/               # Shared utilities
│   ├── repositories/      # Data access layer
│   ├── routes/            # API endpoints
│   ├── services/          # Business logic
│   ├── types/             # TypeScript types
│   ├── voice/             # Gemini Live API
│   └── index.ts           # Entry point
├── docs/                  # Documentation
├── .env                   # Environment variables (create from .env.example)
├── .env.example           # Example environment file
├── docker-compose.yml     # Docker services
├── package.json           # Dependencies
├── prisma.config.ts       # Prisma 7 configuration
└── tsconfig.json          # TypeScript configuration
```

---

## Next Steps

After setup is complete:

1. **Explore the API**: Check `src/routes/` for available endpoints
2. **Read the Architecture**: See `docs/ARCHITECTURE-RECOMMENDATION.md`
3. **Configure Integrations**: Add Jira, Google Chat keys to `.env`. For live meeting capture, set `VEXA_API_URL` if you self-host Vexa (see [meeting-bot docs](https://docs.workforce0.com/integrations/meeting-bot/))
4. **Voice Bot**: Add Twilio + OpenAI keys, run ngrok, then POST to `/api/voice/dial-in`

---

## Getting Help

- **Issues**: Check existing [GitHub Issues](https://github.com/workforce0/workforce0/issues)
- **Documentation**: See `docs/` folder
- **Team**: Reach out on Slack #workforce0-dev

---

*Last updated: 2026-01-27*
