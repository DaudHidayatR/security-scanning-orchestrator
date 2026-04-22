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
| Edge | **Orchestrator** (`src/index.ts`) | Webhook receiver, queue router, cron triggers |
| Queue | **scanner-jobs** (`src/workers/scanner-jobs.ts`) | Parses Semgrep JSON + patch regex scan, stores findings, sends alerts |
| Queue | **scanner-jobs** (`src/workers/scanner-jobs.ts`) | Parses Semgrep JSON + patch scan, stores findings, routes AI jobs by severity |
| Queue | **ai-validation** (`src/workers/ai-validation.ts`) | Batched AI assessment for medium/low severity findings |
| Queue | **ai-validation-priority** (`src/workers/ai-validation.ts`) | Immediate AI assessment for critical/high severity findings |
| Queue | **fix-validation** (`src/workers/fix-validation.ts`) | Dynamic Workers sandbox validation |
| Queue | **rule-testing** (`src/workers/rule-testing.ts`) | User-defined rule testing |
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

### 1. Clone and Install

```bash
git clone <repo>
cd <repo>
npm install
```

### 2. Configure Wrangler Resources

Replace placeholder IDs in `wrangler.toml` with real values:

```bash
# D1 Database
wrangler d1 create security-findings
# Copy the database_id into wrangler.toml

# KV Namespace
wrangler kv:namespace create CACHE
# Copy the id into wrangler.toml

# R2 Bucket
wrangler r2 bucket create security-raw-reports

# Queues
wrangler queues create scanner-jobs
wrangler queues create ai-validation
wrangler queues create ai-validation-priority
wrangler queues create fix-validation
wrangler queues create rule-testing

# Workers for Platforms dispatch namespace
wrangler dispatch-namespace create security-sandbox-ns
```

### 3. Apply Database Schema

```bash
wrangler d1 migrations apply security-findings --local   # local dev
wrangler d1 migrations apply security-findings            # production
```

### 4. Set Secrets

```bash
# Cloudflare
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_AI_API_TOKEN

# GitHub App
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_PRIVATE_KEY
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_INSTALLATION_ID

# Sandbox authentication
wrangler secret put SANDBOX_JWT_SECRET
# wrangler secret put AI_MODEL_PREMIUM

# Alert threshold (optional, default: medium)
wrangler secret put ALERT_MIN_SEVERITY
# Alerts - Telegram (recommended for solo dev)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID

# Alerts - Email via SendGrid
wrangler secret put EMAIL_PROVIDER       # value: sendgrid
wrangler secret put SENDGRID_API_KEY
wrangler secret put EMAIL_FROM
wrangler secret put EMAIL_TO

# Alerts - Email via Mailgun (alternative)
# wrangler secret put EMAIL_PROVIDER       # value: mailgun
# wrangler secret put MAILGUN_API_KEY
# wrangler secret put MAILGUN_DOMAIN
# wrangler secret put EMAIL_FROM
# wrangler secret put EMAIL_TO
```

For local development, create `.dev.vars` from `.env.example`:

```bash
cp .env.example .dev.vars
# Edit .dev.vars with your real values
```

### 5. Run Local Development Server

```bash
npm run dev
```

### 6. Deploy to Production

```bash
npm run deploy
```

---

## Configuration Reference

### Wrangler Bindings (Non-Secrets)

Declared in `wrangler.toml` and safe to commit:

| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | AI inference (future phases) |
| `DB` | D1 Database | Findings and webhook deliveries |
| `CACHE` | KV Namespace | Neuron tracking, circuit breaker state |
| `REPORTS` | R2 Bucket | Raw scanner JSON/SARIF output |
| `scannerJobs` | Queue | Standard security scans |
| `aiValidation` | Queue | AI exploitability + fix generation (Phase 3) |
| `aiValidationPriority` | Queue | Priority AI assessment for critical/high findings |
| `fixValidation` | Queue | Sandbox patch validation (Phase 5) |
| `ruleTesting` | Queue | User-defined rule testing (Phase 7) |
| `LOADER` | Dispatch Namespace | Workers for Platforms sandbox (Phase 4) |

### Secrets (Runtime-Injected)

| Secret | Required By | Phase | Notes |
|---|---|---|---|
| `CF_ACCOUNT_ID` | AI REST API calls | 1 | |
| `CF_AI_API_TOKEN` | AI REST API calls | 1 | |
| `AI_MODEL_DEFAULT` | AI inference model | 1 | Set in `[vars]` or secrets |
| `AI_MODEL_PREMIUM` | AI premium model | 1 | Optional, for critical findings |
| `ALERT_MIN_SEVERITY` | Alert threshold | 1 | `critical`, `high`, `medium`, `low`, `info` |
| `GITHUB_APP_ID` | GitHub API auth | 1 | |
| `GITHUB_PRIVATE_KEY` | GitHub App JWT signing | 1 | |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC verification | 1 | |
| `GITHUB_APP_INSTALLATION_ID` | Token exchange | 1 | |
| `SANDBOX_JWT_SECRET` | Sandbox request signing | 4 | |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts | 1 | Get from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram alerts | 1 | Group or user chat ID |
| `EMAIL_PROVIDER` | Email alerts | 1 | `sendgrid` or `mailgun` |
| `SENDGRID_API_KEY` | SendGrid email | 1 | If using SendGrid |
| `MAILGUN_API_KEY` | Mailgun email | 1 | If using Mailgun |
| `MAILGUN_DOMAIN` | Mailgun email | 1 | If using Mailgun |
| `EMAIL_FROM` | Email sender | 1 | Verified sender address |
| `EMAIL_TO` | Email recipient | 1 | Your email |

### AI Model Configuration

Models are configured in `wrangler.toml` under `[vars]` (non-secret, safe to commit) or as secrets:

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

### Project Structure

```
src/
  index.ts                 # Orchestrator: thin delegation layer
  types.ts                 # Shared TypeScript interfaces
  handlers/
    webhook.ts             # GitHub webhook parsing and enqueueing
    queue-router.ts        # Queue dispatch registry
  utils/
    logger.ts              # Structured JSON logging
    crypto.ts              # Web Crypto: HMAC, RS256 JWT, SHA256
    github.ts              # GitHub API: auth, files, comments, PR creation
    github-client.ts       # Shared GitHub API request helper
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
```

### Logging

All workers use structured JSON logging:

```json
{"level":"info","worker":"orchestrator","event":"scanner_job_enqueued","repo":"org/repo","pr_number":42,"file_count":3}
```

View logs: `npm run tail` or `wrangler tail`

---

## Implementation Roadmap

| Phase | Focus | Days | Status |
|---|---|---|---|
| **1** | Infrastructure, GitHub App, Webhook Receiver, D1 Schema, Semgrep JSON Parser, Alerts | 1-2 | **Complete** |
| **2** | Database migrations, schema verification | 3 | Pending |
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
| Findings/day ( Semgrep + regex) | 3 | 10 |
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
