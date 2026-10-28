/**
 * Pure helper for the "new member signed up" ops notification — split out of the Clerk
 * `user.created` webhook route so the formatting logic is unit-testable without the route's
 * signature-verification/DB machinery, same pattern as whop-cancellation-notify.ts.
 *
 * Builds Discord EMBED fields (Email / Name / Clerk User ID), not a flat content string —
 * the flat-string version this replaced rendered as one unstructured line
 * ("a@b.com — Name · clerk_user_id=user_x") next to Whop's own native "Membership was
 * generated" embed, which is a properly labeled card. `notifyOpsDiscord` now accepts
 * `fields` and renders them the same way.
 *
 * SECURITY: Discord embeds render Markdown inside field values — INCLUDING `[label](url)`
 * masked links, which plain message `content` does not support. `firstName`/`lastName` are
 * fully attacker-controlled (any Clerk sign-up can set them to anything at account creation,
 * before any human ever reviews the account) and `email`'s local-part may legally contain
 * Markdown-special characters per RFC 5321 (`*_~|^` are all valid unquoted local-part chars).
 * Without escaping, a sign-up named e.g. `[Verify your billing](https://evil.example/phish)`
 * renders as a live, clickable link inside the internal ops Discord channel the moment the
 * webhook fires — a direct social-engineering vector against whoever is watching that channel,
 * and the exact "unescaped user-controlled text reaching a rendered-as-markup surface" bug
 * shape as the welcome-sequence.ts firstName HTML-XSS gap fixed in PR #6929, just on the
 * Discord-markdown surface instead of HTML. No shared Discord-markdown-escaping helper existed
 * anywhere in the codebase (every other Discord notifier only ever interpolates
 * server-computed tickers/numbers, never free-text a member can set), so `escapeDiscordMarkdown`
 * is introduced here rather than reused.
 */

export interface OpsNotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Neutralizes every Discord Markdown control character so a value renders as the literal text
 * typed, never as formatting or a masked link. Backslash is escaped FIRST so a user-supplied
 * `\` doesn't double-escape (or de-escape) the characters inserted below it. Covers: emphasis
 * (`*`, `_`), strikethrough/spoiler (`~`, `|`), inline code/code block (`` ` ``), blockquote
 * (`>` at line start, escaped unconditionally — harmless mid-line), and masked-link/mention
 * syntax (`[`, `]`, `<`, `>`) — `<@123>`/`<#123>`/`<@&123>` mention syntax and `[label](url)`
 * links both require one of these characters, so escaping them closes both surfaces at once.
 */
function escapeDiscordMarkdown(value: string): string {
  return value.replace(/[\\*_~`|<>[\]]/g, (ch) => `\\${ch}`);
}

export function buildNewMemberNotificationFields(input: {
  email: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  clerkUserId: string;
}): OpsNotificationField[] {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const fields: OpsNotificationField[] = [
    {
      name: "Email",
      value: input.email ? escapeDiscordMarkdown(input.email) : "*no email on account*",
    },
  ];
  if (name) fields.push({ name: "Name", value: escapeDiscordMarkdown(name) });
  fields.push({ name: "Clerk User ID", value: `\`${input.clerkUserId}\`` });
  return fields;
}
