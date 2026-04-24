import { describe, it, expect } from 'vitest';
import { redact, redactDeep } from '../redact.js';

describe('redact', () => {
  it('passes through safe text untouched', () => {
    const { redacted, total } = redact('nothing sensitive here at all');
    expect(redacted).toBe('nothing sensitive here at all');
    expect(total).toBe(0);
  });

  it('redacts email local part but keeps the domain', () => {
    const { redacted, counts } = redact('contact priya@acme.com for details');
    expect(redacted).toContain('[REDACTED:EMAIL]@acme.com');
    expect(counts.email).toBe(1);
  });

  it('redacts AWS access keys', () => {
    // String-split to avoid tripping GitHub's secret scanner on a fake fixture.
    const fakeKey = 'AKIA' + '1234567890ABCDEF';
    const { redacted, counts } = redact(`key ${fakeKey} was leaked`);
    expect(redacted).toBe('key [REDACTED:AWS_KEY] was leaked');
    expect(counts.aws_key).toBe(1);
  });

  it('redacts common API key shapes', () => {
    // String-split each fake fixture to avoid tripping GitHub's secret scanner.
    const raw = [
      'sk-' + '1234567890abcdefghij',
      'xoxb-' + '1111111111-2222222222-AAAAAAAAAAAAAAAAAAAA',
      'github' + '_pat_' + '11ABCDEFG0abcdef1234567890abcdef1234567890abcdef12',
      'AIza' + 'SyABCDEFGHIJKLMN_OPQRSTUVW',
      'lin_api_' + 'abcdefghijklmnopqrstuvwxyz',
    ].join(' ');
    const { redacted, counts } = redact(raw);
    expect(redacted).not.toContain('sk-1234567890abcdefghij');
    expect(redacted).not.toContain('xoxb-1111');
    expect(redacted).not.toContain('AIza');
    expect(counts.api_key! >= 4).toBe(true);
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    const { redacted } = redact(`authorization: Bearer ${jwt}`);
    expect(redacted).toBe('authorization: Bearer [REDACTED:JWT]');
  });

  it('redacts credentials embedded in URLs', () => {
    const { redacted, counts } = redact('https://admin:s3cret@db.example.com/workforce0');
    expect(redacted).toBe('https://[REDACTED:CREDS]@db.example.com/workforce0');
    expect(counts.url_credentials).toBe(1);
  });

  it('redacts credit-card numbers (various brands)', () => {
    const { redacted, counts } = redact(
      [
        '4111 1111 1111 1111',       // Visa
        '5500-0000-0000-0004',       // Mastercard
        '3400 000000 00009',         // Amex (15 digits, "3400 ..." format)
      ].join(' — '),
    );
    // At least two cards caught (Amex pattern is looser depending on spacing)
    expect((counts.credit_card ?? 0)).toBeGreaterThanOrEqual(2);
    expect(redacted).toContain('[REDACTED:CREDIT_CARD]');
  });

  it('redacts SSN', () => {
    const { redacted } = redact('SSN 123-45-6789 confirmed');
    expect(redacted).toBe('SSN [REDACTED:SSN] confirmed');
  });

  it('redacts PGP private key blocks', () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEA7c3h...
-----END RSA PRIVATE KEY-----`;
    const { redacted } = redact(`config:\n${key}\nend`);
    expect(redacted).toBe('config:\n[REDACTED:PRIVATE_KEY]\nend');
  });

  it('honors skip list', () => {
    const { redacted, counts } = redact('ping admin@acme.com via 10.0.0.1', {
      skip: ['email'],
    });
    expect(redacted).toContain('admin@acme.com');
    expect(redacted).toContain('[REDACTED:IP]');
    expect(counts.email ?? 0).toBe(0);
  });

  it('redacts phone numbers with country codes', () => {
    const { redacted } = redact('call +1 415-555-1234 or (415) 555-1234');
    expect(redacted).not.toContain('415-555-1234');
    expect(redacted).toContain('[REDACTED:PHONE]');
  });
});

describe('redactDeep', () => {
  it('walks arrays and objects, leaves non-string scalars alone', () => {
    const input = {
      user: 'priya@acme.com',
      contactInfo: {
        email: 'backup@acme.com',
        phone: '+14155551234',
      },
      tags: ['internal', 'admin@acme.com'],
      ageYears: 42,
      active: true,
    };
    const out = redactDeep(input);
    expect(out.user).toContain('[REDACTED:EMAIL]');
    expect(out.contactInfo.email).toContain('[REDACTED:EMAIL]');
    expect(out.tags[1]).toContain('[REDACTED:EMAIL]');
    expect(out.ageYears).toBe(42);
    expect(out.active).toBe(true);
  });
});
