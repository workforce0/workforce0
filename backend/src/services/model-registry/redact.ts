/**
 * =============================================================================
 * REDACTION — strip PII / secrets / tokens before they leave the server
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent `agent/redact.py`.
 *
 * Every prompt that flows to an AI provider passes through here first, and
 * every log line that might contain a transcript also passes through here.
 * The goal is a hard compliance story: **Workforce0 never sends a customer
 * credit card to Anthropic**, even if a transcript contains one.
 *
 * Detection is deliberately conservative — false positives (over-redact)
 * are always preferable to false negatives (leak). Callers can opt out
 * per-category if they're sure the content is safe.
 *
 * @module services/model-registry/redact
 */

export type RedactionCategory =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'api_key'
  | 'aws_key'
  | 'private_key'
  | 'jwt'
  | 'url_credentials'
  | 'ipv4';

export interface RedactionReport {
  redacted: string;
  counts: Partial<Record<RedactionCategory, number>>;
  total: number;
}

interface Rule {
  category: RedactionCategory;
  pattern: RegExp;
  placeholder: (match: string) => string;
}

// Ordered so more-specific rules run first (e.g. AWS keys before generic api keys).
const RULES: Rule[] = [
  {
    category: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    placeholder: () => '[REDACTED:PRIVATE_KEY]',
  },
  {
    category: 'aws_key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    placeholder: () => '[REDACTED:AWS_KEY]',
  },
  {
    category: 'jwt',
    // 3 base64url segments separated by dots; first 2 ≥10 chars to avoid false positives
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    placeholder: () => '[REDACTED:JWT]',
  },
  {
    category: 'api_key',
    // AIza keys use no separator (AIzaSy...); others use - or _
    pattern: /\bAIza[0-9A-Za-z_-]{16,}\b/g,
    placeholder: () => '[REDACTED:API_KEY]',
  },
  {
    category: 'api_key',
    // Separator-prefixed API-key shapes: sk-..., xoxb-..., xoxp-..., gh[pousr]_..., lin_api_..., secret_..., github_pat_..., workforce0_...
    pattern: /\b(?:sk|pk|xoxb|xoxp|xapp|github_pat|gh[pousr]|lin_api|secret|workforce0)[-_][A-Za-z0-9_-]{16,}\b/g,
    placeholder: () => '[REDACTED:API_KEY]',
  },
  {
    category: 'credit_card',
    // Visa / Mastercard / Amex / Discover (loose Luhn-aware spacing)
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))(?:[ -]?\d{4}){2}(?:[ -]?\d{3,4})\b/g,
    placeholder: () => '[REDACTED:CREDIT_CARD]',
  },
  {
    category: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: () => '[REDACTED:SSN]',
  },
  {
    category: 'url_credentials',
    // https://user:pass@host/... — preserve scheme in the replacement
    pattern: /(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/g,
    placeholder: (match) => {
      const scheme = match.startsWith('https://') ? 'https://' : 'http://';
      return `${scheme}[REDACTED:CREDS]@`;
    },
  },
  {
    category: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    placeholder: (m) => {
      // Preserve domain for debugging context; redact local part.
      const at = m.indexOf('@');
      return at > 0 ? `[REDACTED:EMAIL]${m.slice(at)}` : '[REDACTED:EMAIL]';
    },
  },
  {
    category: 'phone',
    // E.164 and common US formats. Avoid redacting things like "2024-04-18" by
    // requiring at least a + or parens/dash context.
    pattern: /(?:\+?\d{1,3}[ -]?)?(?:\(\d{3}\)|\d{3})[ -]\d{3}[ -]\d{4}\b/g,
    placeholder: () => '[REDACTED:PHONE]',
  },
  {
    category: 'ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g,
    placeholder: () => '[REDACTED:IP]',
  },
];

/**
 * Redact sensitive text. Returns the scrubbed string plus a report of
 * what was removed so callers can log metrics.
 *
 * `skip` lets a caller disable specific categories when they're certain
 * it's safe (e.g., inside an admin audit console that must show real IPs).
 */
export function redact(
  input: string,
  opts: { skip?: RedactionCategory[] } = {},
): RedactionReport {
  const skip = new Set(opts.skip ?? []);
  const counts: Partial<Record<RedactionCategory, number>> = {};
  let total = 0;
  let out = input;

  for (const rule of RULES) {
    if (skip.has(rule.category)) continue;
    out = out.replace(rule.pattern, (match) => {
      counts[rule.category] = (counts[rule.category] ?? 0) + 1;
      total += 1;
      return rule.placeholder(match);
    });
  }

  return { redacted: out, counts, total };
}

/**
 * Recursively redact any string fields inside a JSON-ish value.
 * Useful for redacting a full prompt payload (messages, metadata).
 */
export function redactDeep<T>(value: T, opts?: { skip?: RedactionCategory[] }): T {
  if (typeof value === 'string') {
    return redact(value, opts).redacted as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, opts)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, opts);
    }
    return out as unknown as T;
  }
  return value;
}
