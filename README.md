# Security Scanning Orchestrator

Cloudflare Workers security scanning pipeline with AI-powered auto-remediation, fix-patch validation via Workers for Platforms sandbox, and user-defined rule generation.

**Target:** 10-15 pushes/day, ~$5/month total cost, solo developer workflow.

---

## Architecture

```
GitHub Push/PR ----> Webhook Receiver (Worker) ----> Queue System ----> Scanner Jobs
                           |                              |
                           |                              v
                           |                       AI Validation Worker
                           |                              |
                           |                              v
                           |                       Fix Validation Sandbox
                           |                              |
                           v                              v
                  D1 Database <------ Report Aggregator
```

### Components

| Layer | Worker | Responsibility |
|---|---|---|
| Edge | **Orchestrator** (`src/index.ts`) | Thin delegation layer: webhook routing, queue dispatch, cron triggers |
| Handler | **webhook.ts** (`src/handlers/webhook.ts`) | Webhook parsing, file fetching, job enqueueing |
| Handler | **queue-router.ts** (`src/handlers/queue-router.ts`) | Map-based queue consumer registry |
| Queue | **scanner-jobs** (`src/workers/scanner-jobs.ts`) | Semgrep JSON + regex patch scan, D1 storage, alerts |
| Queue | **ai-validation** (`src/workers/ai-validation.ts`) | Batched AI assessment stub (Phase 3+) |
| Queue | **ai-validation-priority** (`src/workers/ai-validation.ts`) | Immediate AI assessment for critical/high findings (Phase 3+) |
| Queue | **fix-validation** (`src/workers/fix-validation.ts`) | Dynamic Workers sandbox validation stub (Phase 5+) |
| Queue | **rule-testing** (`src/workers/rule-testing.ts`) | User-defined rule testing stub (Phase 7+) |

### Semgrep Integration

Semgrep runs in your CI pipeline (e.g. GitHub Actions) using the standard Docker image and produces JSON output:

```yaml
# .github/workflows/security-scan.yml
- name: Run Semgrep
  run: |
    docker run --rm -v "$PWD:/project" -w /project \
      semgrep/semgrep:latest semgrep scan \
      --config p/default \
      --config p/owasp-top-ten \
      --config p/cwe-top-25 \
      --config p/secrets \
      --metrics=off \
      --json \
      --output semgrep-report.json
    # Send semgrep-report.json to worker for processing and storage
```

The scanner-jobs worker accepts `semgrep_json` directly from the queue message and parses it using `src/utils/semgrep.ts`. If no Semgrep JSON is provided, a lightweight regex fallback scans patch content for common issues (eval, secrets, SQLi, insecure crypto).

For local testing, see `test-security-app.sh` for a complete container-based pipeline including Semgrep, Trivy, Grype, GitLeaks, and Syft.

---

## Prerequisites

- Node.js 20+
- Cloudflare account with Workers Paid plan ($5/month)
- GitHub App with repository access
- Wrangler CLI installed globally: `npm install -g wrangler`

---

## Quick Start

> **Two phases:** [One-Time Setup](#one-time-setup) (do this once), then [Daily Workflow](#daily-workflow) (dev → deploy).

---

### One-Time Setup

#### 1. Clone and Install Dependencies

```bash
git clone <repo>
cd <repo>
npm install
```

#### 2. Log In to Cloudflare

```bash
npx wrangler login
```

This opens a browser tab. Authorize Wrangler to manage your Cloudflare account.

#### 3. Create Cloudflare Resources

Run each command below. After each creation command, **copy the returned ID into `wrangler.toml`** as shown.

**D1 Database:**
```bash
npx wrangler d1 create security-findings
```

Expected output:
```
✅ Successfully created DB 'security-findings' in region EEUR
Created your database using D1's new storage backend. The new storage backend is not yet recommended for production workloads,
but can improve access latencies by up to 20x. To learn more about the new storage backend visit
https://developers.cloudflare.com/d1/build-with-d1/d1-new-storage/

[[d1_databases]]
binding = "DB"
database_name = "security-findings"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value into `wrangler.toml` line 17.

**KV Namespace:**
```bash
npx wrangler kv:namespace create CACHE
```

Expected output:
```
✨ Success!
Add the following to your configuration file:
[[kv_namespaces]]
binding = "CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Copy the `id` value into `wrangler.toml` line 28.

**Queues:**
```bash
npx wrangler queues create scanner-jobs
npx wrangler queues create ai-validation
npx wrangler queues create ai-validation-priority
npx wrangler queues create fix-validation
npx wrangler queues create rule-testing
```

No IDs to copy for queues — they bind automatically by name.

#### 4. Apply Database Schema (Local)

```bash
npx wrangler d1 migrations apply security-findings --local
```

#### 5. Create a GitHub App

You need a GitHub App so the worker can read PRs, post comments, and create remediation PRs.

1. Go to [github.com/settings/apps](https://github.com/settings/apps) and click **"New GitHub App"**
2. Fill in:
   - **GitHub App name:** `security-scan-orchestrator` (must be unique)
   - **Homepage URL:** Your repo URL or any valid URL
   - **Webhook URL:** Leave blank for now (you will set this after first deploy)
   - **Webhook secret:** Run `openssl rand -hex 32` and save the output
3. Under **Repository permissions**, set:
   - `Contents` → Read & write
   - `Pull requests` → Read & write
   - `Issues` → Read & write
   - `Checks` → Read
4. Under **Subscribe to events**, check:
   - [x] Pull request
   - [x] Push
5. Click **Create GitHub App**
6. At the top of the app settings page, note the **App ID** (e.g., `3462265`)
7. Scroll to **"Private keys"** and click **"Generate a private key"**. A `.pem` file will download.
8. Save the `.pem` file in your project root (e.g., `security-scan-orchestrator.private-key.pem`)

#### 6. Collect Your Values

Before the next step, gather these values:

| Value | Where to Find It | Example |
|---|---|---|
| **GitHub App ID** | Top of your GitHub App settings page | `3462265` |
| **GitHub Private Key** | The `.pem` file you downloaded | `security-scan-orchestrator.private-key.pem` |
| **GitHub Webhook Secret** | The secret you generated in Step 5 | `a1b2c3d4...` |
| **Cloudflare Account ID** | Cloudflare Dashboard → right sidebar | `343d4232b14d12df60e2934f4a2b902b` |
| **Cloudflare AI API Token** | Dashboard → My Profile → API Tokens → Create Token → Use "Workers AI - Read" template | `cfut_...` |

#### 7. Configure Local Development Secrets

Create `.dev.vars` from the example:

```bash
cp .env.example .dev.vars
```

Edit `.dev.vars` and fill in the values you collected above. At minimum, set these 6:

```bash
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_AI_API_TOKEN=your_workers_ai_token
GITHUB_APP_ID=your_app_id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret
ALERT_MIN_SEVERITY=medium
```

> **Note:** For `GITHUB_PRIVATE_KEY`, open the `.pem` file and replace each newline with `\n` so it fits on one line.

#### 8. Run Local Development Server

```bash
npm run dev
```

The worker is now running at `http://localhost:8787`. Test it:

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{"status":"ok","version":"0.1.0","phase":1}
```

#### 9. Deploy to Production

```bash
npm run deploy
```

After deploy, Wrangler prints your production URL:
```
Deployed security-scan-orchestrator triggers
  https://security-scan-orchestrator.your-subdomain.workers.dev
```

#### 10. Finish GitHub App Setup

1. Go back to your GitHub App settings
2. Set **Webhook URL** to: `https://security-scan-orchestrator.your-subdomain.workers.dev/webhook`
3. Click **Save changes**
4. In the left sidebar, click **"Install App"**
5. Select your user/organization and the repositories you want to scan
6. Click **Install**
7. After installing, look at the browser URL. It will be:
   ```
   https://github.com/settings/installations/126047661
   ```
   The number at the end (`126047661`) is your **Installation ID**.

#### 11. Set Production Secrets

Now that you have your Installation ID, set all production secrets:

```bash
# Cloudflare
echo "your_account_id" | npx wrangler secret put CF_ACCOUNT_ID
echo "your_ai_token" | npx wrangler secret put CF_AI_API_TOKEN

# GitHub App
echo "your_app_id" | npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_PRIVATE_KEY < security-scan-orchestrator.private-key.pem
echo "your_webhook_secret" | npx wrangler secret put GITHUB_WEBHOOK_SECRET
echo "your_installation_id" | npx wrangler secret put GITHUB_APP_INSTALLATION_ID

# Sandbox (generate a fresh secret)
openssl rand -hex 32 | npx wrangler secret put SANDBOX_JWT_SECRET

# Alert threshold
echo "medium" | npx wrangler secret put ALERT_MIN_SEVERITY

# Alerts - Telegram (optional, recommended)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# Alerts - Email via SendGrid (optional)
# echo "sendgrid" | npx wrangler secret put EMAIL_PROVIDER
# npx wrangler secret put SENDGRID_API_KEY
# npx wrangler secret put EMAIL_FROM
# npx wrangler secret put EMAIL_TO
```

> **Tip:** For secrets where you have the value in a variable or file, pipe it with `echo` or `<` as shown above. For secrets you need to type interactively (like API tokens you want to paste), run the command without piping:
> ```bash
> npx wrangler secret put TELEGRAM_BOT_TOKEN
> # Then paste your token when prompted
> ```

#### 12. Verify Everything

```bash
npm run check:env
npx wrangler secret list
```

---

### Daily Workflow

After one-time setup, your daily workflow is:

```bash
# Start local dev server
npm run dev

# Type-check before committing
npm run typecheck

# Deploy to production
npm run deploy

# Stream production logs
npm run tail
```

---

## Configuration Reference

### Wrangler Bindings (Non-Secrets)

Declared in `wrangler.toml` and safe to commit:

| Binding | Type | Purpose | Status |
|---|---|---|---|
| `AI` | Workers AI | AI inference (Phase 3+) | Active |
| `DB` | D1 Database | Findings and webhook deliveries | Active |
| `CACHE` | KV Namespace | Neuron tracking, circuit breaker state | Active |
| `scannerJobs` | Queue | Standard security scans | Active |
| `aiValidation` | Queue | AI exploitability + fix generation (Phase 3) | Active |
| `aiValidationPriority` | Queue | Priority AI assessment for critical/high findings | Active |
| `fixValidation` | Queue | Sandbox patch validation (Phase 5) | Active |
| `ruleTesting` | Queue | User-defined rule testing (Phase 7) | Active |
| `REPORTS` | R2 Bucket | Raw scanner JSON/SARIF output | Disabled — enable in Dashboard |
| `LOADER` | Dispatch Namespace | Workers for Platforms sandbox (Phase 4) | Disabled — Enterprise feature |

### Secrets (Runtime-Injected)

| Secret | Required By | Phase | Notes |
|---|---|---|---|
| `CF_ACCOUNT_ID` | AI REST API calls | 1 | Cloudflare dashboard right sidebar |
| `CF_AI_API_TOKEN` | AI REST API calls | 1 | Dashboard → API Tokens → Workers AI - Read |
| `AI_MODEL_DEFAULT` | AI inference model | 1 | Set in `[vars]` or secrets |
| `AI_MODEL_PREMIUM` | AI premium model | 1 | Set in `[vars]` or secrets |
| `ALERT_MIN_SEVERITY` | Alert threshold | 1 | `critical`, `high`, `medium`, `low`, `info` |
| `GITHUB_APP_ID` | GitHub API auth | 1 | App settings page |
| `GITHUB_PRIVATE_KEY` | GitHub App JWT signing | 1 | `.pem` file downloaded from app settings |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC verification | 1 | Same secret used in GitHub App settings |
| `GITHUB_APP_INSTALLATION_ID` | Token exchange | 1 | From `github.com/settings/installations/XXXXX` |
| `SANDBOX_JWT_SECRET` | Sandbox request signing | 4 | Generate with `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts | 1 | Get from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram alerts | 1 | Group or user chat ID |
| `EMAIL_PROVIDER` | Email alerts | 1 | `sendgrid` or `mailgun` |
| `SENDGRID_API_KEY` | SendGrid email | 1 | If using SendGrid |
| `MAILGUN_API_KEY` | Mailgun email | 1 | If using Mailgun |
| `MAILGUN_DOMAIN` | Mailgun email | 1 | If using Mailgun |
| `EMAIL_FROM` | Email sender | 1 | Verified sender address |
| `EMAIL_TO` | Email recipient | 1 | Your email |

### AI Model Configuration

Models are configured in `wrangler.toml` under `[vars]` (non-secret, safe to commit):

```toml
[vars]
AI_MODEL_DEFAULT = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"
AI_MODEL_PREMIUM = "@cf/qwen/qwen2.5-coder-32b-instruct"
```

| Variable | Purpose | Fallback |
|---|---|---|
| `AI_MODEL_DEFAULT` | Default model for all AI tasks | Required |
| `AI_MODEL_PREMIUM` | Used for critical/high severity findings | `AI_MODEL_DEFAULT` |

**Selection logic** (`src/utils/ai-config.ts`):
1. Premium model for `critical` / `high` severity findings
2. Default model for everything else

### Tiered Escalation Strategy

Findings are routed through different processing tiers based on severity:

| Severity | Queue | Timeout | Model | Alerts |
|---|---|---|---|---|
| **Critical** | `ai-validation-priority` | 5s | Premium | Telegram + Email immediate |
| **High** | `ai-validation-priority` | 5s | Premium | Telegram immediate |
| **Medium** | `ai-validation` | 60s | Default | Email digest only |
| **Low/Info** | `ai-validation` | 60s | Default | Dashboard only |

**Rationale:**
- Critical/high findings get immediate AI assessment and instant phone alerts via Telegram
- Medium findings are batched to conserve neurons and sent as email digests
- Low findings get dashboard-only tracking to avoid alert fatigue
- Two queues prevent critical findings from waiting behind low-priority batch fills

Configure the alert threshold with `ALERT_MIN_SEVERITY` (default: `medium`).

**Available Workers AI models:**
- `@cf/meta/llama-3.1-8b-instruct-fp8-fast` — fast, cheap, good for daily use
- `@cf/qwen/qwen2.5-coder-32b-instruct` — higher quality for critical issues
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — best quality, higher cost

---

## API Endpoints

### `GET /health`

Health check. Returns status, version, and current phase.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "phase": 1
}
```

### `POST /webhook`

GitHub webhook endpoint. Accepts `pull_request` and `push` events.

**Headers:**
- `X-GitHub-Event`: Event type (`pull_request`, `push`)
- `X-GitHub-Delivery`: Unique delivery ID
- `X-Hub-Signature-256`: HMAC-SHA256 signature

**Verified actions:**
- `pull_request:opened` - Enqueue scanner jobs for new PRs
- `pull_request:synchronize` - Re-scan updated PRs
- `push` (main/master only) - Scan direct pushes

---

## Alerting

The scanner-jobs worker sends alerts when critical or high-severity findings are detected.

### Telegram (Recommended)

- Instant push notifications to your phone
- No email infrastructure needed
- Free
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

### Email (SendGrid or Mailgun)

- Good for audit trails and digests
- Set `EMAIL_PROVIDER`, `SENDGRID_API_KEY` (or Mailgun keys), `EMAIL_FROM`, `EMAIL_TO`

---

## Database Schema

### `findings` (Core)

Stores security findings from Semgrep and the regex fallback scanner.

Key fields:
- `repo`, `pr_number`, `commit_sha`, `file`, `line` - Location
- `tool`, `rule_id`, `severity`, `message` - Scanner output
- `status` - `open`, `dismissed`, `fixed`

### `webhook_deliveries`

Audit log of all webhook events for debugging and replay.

---

## Development

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start local dev server via Wrangler |
| `npm run deploy` | Deploy to Cloudflare production |
| `npm run tail` | Stream production logs |
| `npm run typecheck` | Run TypeScript compiler (no emit) |
| `npm run d1:migrate:local` | Apply D1 migrations locally |
| `npm run d1:migrate` | Apply D1 migrations to production |
| `npm run check:env` | Verify all secrets and resources are configured |

### Project Structure

```
src/
  index.ts                 # Orchestrator: thin delegation layer (~48 lines)
  types.ts                 # Shared TypeScript interfaces + narrow sub-interfaces
  handlers/
    webhook.ts             # GitHub webhook parsing, file fetching, job enqueueing
    queue-router.ts        # Map-based queue consumer registry
  utils/
    logger.ts              # Structured JSON logging (single log() function)
    crypto.ts              # Web Crypto: HMAC, RS256 JWT, SHA256
    github.ts              # GitHub API: auth, files, comments, PR creation
    github-client.ts       # Shared GitHub API request helper (injects auth headers)
    semgrep.ts             # Semgrep CLI JSON parser
    finding.ts             # Finding factory with default field initialisation
    severity.ts            # Severity parsing, ranking, and queue routing
    path-filter.ts         # File skip patterns for scannable files
    webhook-log.ts         # Webhook delivery audit logging helper
    alerts.ts              # Unified alert dispatcher (strategy pattern)
    alerts/
      telegram.ts          # Telegram Bot API sender
      sendgrid.ts          # SendGrid email sender
      mailgun.ts           # Mailgun email sender
    ai-config.ts           # AI model selection and tier configuration
  workers/
    scanner-jobs.ts        # Queue consumer: Semgrep JSON + patch scan + alerts
    ai-validation.ts       # Queue consumer: AI assessment stub (Phase 3+)
    fix-validation.ts      # Queue consumer: sandbox validation stub (Phase 5+)
    rule-testing.ts        # Queue consumer: rule tests stub (Phase 7+)
scripts/
  check-env.sh             # Automated environment verification
```

### Logging

All workers use structured JSON logging via the shared `log()` utility:

```json
{"level":"info","worker":"orchestrator","event":"scanner_job_enqueued","repo":"org/repo","pr_number":42,"file_count":3}
```

View logs: `npm run tail` or `npx wrangler tail`

---

## Implementation Roadmap

| Phase | Focus | Days | Status |
|---|---|---|---|
| **1** | Infrastructure, GitHub App, Webhook Receiver, D1 Schema, Semgrep JSON Parser, Alerts | 1-2 | **Complete** |
| **2** | Database migrations, schema verification | 3 | Complete |
| **3** | AI Validation REST API, PR comments, real scanner integrations | 4-8 | Pending |
| **4** | Workers for Platforms sandbox (diff parser, TS compiler) | 9-12 | Pending |
| **5** | Fix validation pipeline integration | 13-14 | Pending |
| **6** | User-defined rules (optional) | 15-18 | Pending |
| **8** | Monitoring, circuit breakers, load testing | 21-24 | Pending |
| **9** | Documentation, runbooks, handoff | 25-26 | Pending |

---

## Cost Estimate

### Scenario: 10-15 Pushes/Day (Solo Developer, Realistic)

Solo developers push frequently to main with incremental changes. Each push typically touches 2-4 files.

| Metric | Conservative | Realistic |
|---|---|---|
| Push events/day | 10 | 15 |
| Changed files/push | 2 | 4 |
| Total files scanned/day | 20 | 60 |
| Findings/day (Semgrep + regex) | 3 | 10 |
| AI validation calls/day | 3 | 10 |
| Fix generation calls/day | 1 | 3 |

### Daily Neuron Consumption

| Operation | Conservative | Realistic | Neurons/Call |
|---|---|---|---|
| AI validation | 3 x 0.77 = 2.3 | 10 x 0.77 = 7.7 | ~0.77 |
| Fix generation | 1 x 2.12 = 2.1 | 3 x 2.12 = 6.4 | ~2.12 |
| **Total/day** | **~4.4** | **~14.1** | |
| **% of 10K free quota** | **0.04%** | **0.14%** | |

### Monthly Cost Breakdown

| Component | Monthly Cost |
|---|---|
| Workers Paid Plan | $5.00 |
| Workers AI (10K Neurons/day free) | $0.00 |
| D1, Queues, R2, KV | $0.00 |
| Telegram API | $0.00 |
| SendGrid (100 emails/day free) | $0.00 |
| **Total** | **$5.00/month** |

### Scaling Headroom

At 15 pushes/day with realistic load, you use only **0.14%** of the 10,000 Neurons/day free quota. You could scale to:

- **~10,000+ pushes/day** before hitting the AI quota limit
- **~500+ PRs/day** if using Llama 3.1 8B fp8-fast

### vs. Proprietary Alternatives

| Service | Cost for 1 developer |
|---|---|
| GitHub Copilot + Security | ~$19-39/month |
| Snyk Auto-Fix | ~$52-99/month |
| **This Architecture** | **$5/month** |
| **Savings** | **~75-95%** |

---

## Security Considerations

- Webhook signatures verified with HMAC-SHA256 on every request
- GitHub App authentication uses RS256 JWT (not PATs)
- Sandbox runs with `globalOutbound: null` (no network egress)
- Sandbox JWTs have 5-minute expiry
- No secrets logged in Worker outputs
- D1 has no public access; only Workers bindings can query
- Telegram bot tokens and email API keys are encrypted at rest by Cloudflare

---

## License

MIT
