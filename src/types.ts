/**
 * Shared types for the security scanning pipeline.
 */

export interface Env {
  // Cloudflare bindings
  AI: unknown;
  DB: D1Database;
  REPORTS: R2Bucket;
  CACHE: KVNamespace;

  // Queue bindings
  scannerJobs: Queue<ScannerJobMessage>;
  aiValidation: Queue<AIValidationMessage>;
  aiValidationPriority: Queue<AIValidationMessage>;
  fixValidation: Queue<FixValidationMessage>;
  ruleTesting: Queue<RuleTestingMessage>;

  // Workers for Platforms dispatch namespace
  LOADER: DispatchNamespace;

  // Secrets (injected at runtime)
  CF_ACCOUNT_ID: string;
  CF_AI_API_TOKEN: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_INSTALLATION_ID: string;
  SANDBOX_JWT_SECRET: string;

  // AI model configuration (set in wrangler.toml [vars] or secrets)
  AI_MODEL_DEFAULT: string;
  AI_MODEL_PREMIUM?: string;

  // Alert secrets
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  EMAIL_PROVIDER?: string;
  SENDGRID_API_KEY?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  EMAIL_FROM?: string;
  EMAIL_TO?: string;

  // Alert severity threshold (default: medium)
  ALERT_MIN_SEVERITY?: string;

  // Environment variables
  ENVIRONMENT: string;
}

// --- Narrow interfaces for ISP ---

export interface GitHubEnv {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_INSTALLATION_ID: string;
}

export interface AlertEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  EMAIL_PROVIDER?: string;
  SENDGRID_API_KEY?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  EMAIL_FROM?: string;
  EMAIL_TO?: string;
  ALERT_MIN_SEVERITY?: string;
}

export interface AIEnv {
  CF_ACCOUNT_ID: string;
  CF_AI_API_TOKEN: string;
  AI_MODEL_DEFAULT: string;
  AI_MODEL_PREMIUM?: string;
}

// --- GitHub Webhook Payloads ---

export interface GitHubPullRequestPayload {
  action: 'opened' | 'synchronize' | 'closed' | 'reopened';
  number: number;
  pull_request: {
    number: number;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      sha: string;
      ref: string;
    };
    user: {
      login: string;
    };
    html_url: string;
  };
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
}

export interface GitHubPushPayload {
  ref: string;
  before: string;
  after: string;
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
  commits: Array<{
    id: string;
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
}

// --- Queue Messages ---

export interface ScannerJobMessage {
  repo: string;
  owner: string;
  pr_number: number;
  commit_sha: string;
  base_ref: string;
  head_ref: string;
  files: ChangedFile[];
  delivery_id?: string;
  /**
   * Optional Semgrep CLI JSON output.
   * When provided, the scanner parses this directly instead of running regex fallback.
   * Typical source: GitHub Action runs `semgrep --config=auto --json` and passes output.
   */
  semgrep_json?: unknown;
}

export interface AIValidationMessage {
  finding_id: number;
  repo: string;
  owner: string;
  pr_number: number;
  tool: string;
  rule_id: string | null;
  severity: string;
  message: string;
  file: string;
  line: number;
  code_context: string;
  language: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface FixValidationMessage {
  finding_id: number;
  original_code: string;
  patch: string;
  language: string;
  file_path: string;
}

export interface RuleTestingMessage {
  rule_id: string;
  rule_yaml: string;
  positive_tests: string[];
  negative_tests: string[];
  language: string;
}

// --- Domain Models ---

export interface ChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  patch?: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
  language?: string;
}

export interface Finding {
  id?: number;
  repo: string;
  pr_number: number;
  commit_sha: string;
  file: string;
  line: number | null;
  tool: string;
  rule_id: string | null;
  severity: string | null;
  message: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface WebhookDelivery {
  id?: number;
  delivery_id: string | null;
  event: string;
  action: string | null;
  repo: string;
  pr_number: number | null;
  payload_hash: string | null;
  status: string;
  error_message: string | null;
  created_at?: string;
}

// --- API Responses ---

export interface ValidateFixRequest {
  originalCode: string;
  patch: string;
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'rust';
  testCommand?: string;
  dependencies?: string[];
}

export interface ValidateFixResponse {
  patchAppliesCleanly: boolean;
  compiles: boolean;
  testsPass: boolean;
  securityRegressionPass: boolean;
  errorOutput: string;
  fixedCode: string;
  safeToSuggest: boolean;
  safeToAutoApply: boolean;
}

// --- GitHub API Types ---

export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

export interface GitHubPullRequestFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}
