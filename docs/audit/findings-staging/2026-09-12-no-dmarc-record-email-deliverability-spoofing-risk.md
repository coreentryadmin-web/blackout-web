## 2026-09-12 — [FINDING, P2 infra/email-deliverability, NOT FIXED — requires DNS zone authorization] No DMARC record exists anywhere in the `blackouttrades.com` domain tree — email spoofing exposure + a real deliverability risk for the Resend-sent member emails

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — no active outage today (Resend-sent mail authenticates fine via SPF+DKIM), but a real, live gap with two independent downside paths: (1) **brand/phishing exposure** — nothing stops a third party from sending phishing/spoofing mail claiming to be `@blackouttrades.com`, since there is no domain-level policy telling receiving mail servers what to do with an unaligned message; (2) **deliverability risk that gets worse over time, not better** — Gmail/Yahoo's 2024+ bulk-sender requirements explicitly want DMARC (not just SPF/DKIM) for domains sending any real volume, and BlackOut sends real per-member volume (welcome sequence, billing/lifecycle emails — `scripts/audit/email-template-send.mjs`'s own inventory lists 14 live templates). Requires a DNS zone change, not a code change — flagged as a write-up per my standing brief's "never touch anything requiring user authorization," not attempted here. |
| **Status** | REPORTED, NOT FIXED — DNS-zone infrastructure change, outside this lane's code-fix/PR pipeline and outside my standing authorization. |

### What was checked (read-only DNS queries, Cloudflare DoH `cloudflare-dns.com/dns-query`, plus the live Resend account via the `Resend` MCP — no writes, no zone edits)

1. **Apex `blackouttrades.com` TXT records** — three present: `zoho-verification=...`, `google-site-verification=...`, `tiktok-developers-site-verification=...`. **No `v=spf1` record at the apex at all.**
2. **`_dmarc.blackouttrades.com` TXT** — **NXDOMAIN-shaped response** (DoH `Answer` section absent, only an `Authority`/SOA record) — no DMARC policy published for the organizational domain.
3. **The real sending domain, confirmed via the live Resend account (`mcp__Resend__list-domains`/`get-domain`)**: `send.blackouttrades.com`, status `verified`, sending `enabled`. Its own DNS records are correctly configured — `resend._domainkey.send` DKIM TXT **verified**, `send.send` SPF TXT (`v=spf1 include:amazonses.com ~all`) **verified**, plus an SPF-adjacent MX record for SES feedback (`feedback-smtp.us-east-1.amazonses.com`) also verified. So the actual member-facing mail (Resend → SES) authenticates correctly today via SPF+DKIM — this is NOT an active delivery failure.
4. **`_dmarc.send.blackouttrades.com` TXT** — also **NXDOMAIN-shaped** (no DMARC on the sending subdomain either).
5. **Apex MX records** — `mx.zoho.com` / `mx2.zoho.com` / `mx3.zoho.com` (Zoho Mail, presumably the operator's own corporate inbox) — confirming the apex domain is a real, actively-used mail domain, not a parked one, which makes the missing SPF/DMARC at the apex a real spoofing surface (not "nobody would email from apex anyway").

### Why this wasn't dismissed as "SPF+DKIM already pass, so it's fine"

SPF and DKIM alone authenticate that a *specific* sending path is legitimate; they do nothing to tell a receiving mail server what to do with a message that does NOT come through that path (i.e., a spoofed message with a forged `From: someone@blackouttrades.com` header sent through some other/no authenticated path). That's specifically DMARC's job — `p=quarantine`/`p=reject` closes exactly that gap. Absence of a DMARC record does not just mean "no strict policy" — most receiving providers (Gmail, Outlook, etc.) still check for a DMARC record's *existence* as a domain-reputation/trust signal even before evaluating alignment, so the gap affects legitimate mail's inbox placement too, not only spoofed mail's fate.

### Why this is a write-up, not a direct fix

This is a **DNS zone record**, not application code — there is no `fix/<slug>` branch, test, or PR that applies here the way the rest of this file's pipeline assumes. CLAUDE.md's own "Access reality" section documents that the `CF_API_TOKEN` available in this sandbox is scoped to cache purge + cache-ruleset read/write, **not** DNS zone edit — and even if it could write DNS, a change to the apex domain's mail-authentication posture is squarely the kind of "changes the user explicitly flags as deploy-risky" / "requires user authorization" territory the standing issue-handling policy carves out, given the operator's own corporate inbox (Zoho MX) sits on the same apex domain and a misconfigured DMARC policy (e.g. `p=reject` before every legitimate sending path is enrolled) can silently drop real mail.

### Recommended remediation (for whoever has DNS zone access — Cloudflare dashboard or an authorized API token)

Start permissive and tighten over time — the standard safe rollout:
1. Add `_dmarc.blackouttrades.com` TXT: `v=DMARC1; p=none; rua=mailto:<an inbox the operator monitors>; fo=1` (monitor-only — collects aggregate reports, enforces nothing, zero risk of dropping legitimate mail).
2. After a few weeks of clean aggregate reports (all legitimate mail — Resend/SES via `send.blackouttrades.com`, and Zoho apex mail — showing aligned), tighten to `p=quarantine`, then eventually `p=reject`.
3. Optionally add an apex `v=spf1 ... ~all` covering Zoho's SPF include (`include:zoho.com` — Zoho publishes this) if the apex itself ever sends mail directly (as opposed to just receiving via the MX records), which closes the apex-spoofing gap SPF-side too.

No code change, no test, no PR — this is a DNS-console action item for the operator or whoever holds Cloudflare DNS-zone credentials.
