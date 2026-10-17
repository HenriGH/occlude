# Connect the Supabase project

The project URL and publishable key in `.env.example` are public browser settings.
No secret/service-role key is needed by this app. If an elevated secret key was
shared outside trusted administration, revoke it in Supabase's project settings.

## 1. Apply the database migration

1. Open the project in the Supabase dashboard.
2. Choose **SQL Editor**, then **New query**.
3. Copy the entire contents of
   `supabase/migrations/202610170001_initial_sync.sql` into the editor.
4. Click **Run**. Apply this version once. It creates the tables, RLS, private
   `occlude-images` bucket, and the two transactional RPCs.
5. Confirm success. If the editor shows an error, retain the complete error and
   stop; the transaction rolls back rather than leaving a partial schema.

The migration is additive to a fresh project and does not require a database
password in the frontend. Future schema changes must use new migration files.
No SQL has been applied to the hosted project by the coding agent.

## 2. Configure email authentication

1. Under **Authentication → Providers / Sign In**, enable **Email**.
2. Under **Authentication → URL Configuration**, set the Site URL to the app's
   origin. For local development that is `http://localhost:5173`.
3. Add that exact origin to allowed Redirect URLs. After hosting on Cloudflare,
   add the actual HTTPS website origin as well; do not allow arbitrary websites.
4. Supabase's default email delivery has development rate limits. Use its supported
   custom SMTP configuration when needed. No SMTP credentials belong in this repo.

The app requests a passwordless email only when the user presses the login button.
It can verify a numeric code directly. If using a link instead, open it in the SAME
browser/profile and website origin that requested it (PKCE).

### Production address and email-code recovery

For this deployment, use these settings in **Authentication → URL Configuration**:

- Site URL: `https://occlude.henschau2005.workers.dev/`
- Redirect URLs: `https://occlude.henschau2005.workers.dev/**` and
  `http://localhost:5173/**` if development login is still needed.

The wildcard is confined to the exact owned host and allows the SDK's callback
query parameters. Do not use a wildcard permitting arbitrary websites. A localhost
session uses a different browser origin/storage from the deployed website; closing
it or switching recipients does not reset project-wide mail quotas.

The app also accepts a numeric email OTP without following a verification link.
In **Authentication → Email → Templates**, add the contents of
`supabase/email-template.html` to both **Magic Link** and **Confirm signup** templates.
Use a subject such as “Dein Occlude-Anmeldecode”. `{{ .Token }}` is Supabase's
template variable: leave it literally as shown. Request one NEW email after saving
the templates; previously sent emails cannot be changed. Enter its code beside the
same email address in the app. This avoids redirect and link-scanner dependencies.
The code is not written to application storage. If retaining a clickable link,
use Supabase's `{{ .ConfirmationURL }}` rather than constructing an API path by hand.

### Mail limits and a custom SMTP provider

Supabase's built-in SMTP is intended for testing, has a very low project-wide
quota, and restricts recipients to authorized project-team addresses. It is not a
reliable production sender for arbitrary university addresses. Quotas can change;
check the current project settings and official SMTP/rate-limit documentation:

- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits

Configure a supported SMTP provider (for example Brevo, Resend, or an existing
transactional mail service) under **Authentication → Email / SMTP Settings**.
Verify its sender/domain as required by that provider; a `workers.dev` website
address does not give you ownership of a sender's mail domain. Enter SMTP host,
port, username/password, sender email and name ONLY in the Supabase dashboard.
No SMTP credentials or elevated API keys belong in Vite variables or this repo.

After enabling custom SMTP, set **Authentication → Rate Limits → Email sending**
to a suitable value, initially 30–60 messages per hour for this personal app,
within the provider's own quota. Increasing a frontend setting cannot raise this
limit, and enabling SMTP may not immediately clear a currently exhausted bucket.
The app enforces a 60-second local send pause across reloads, recipient changes,
and tabs on the same origin. It explains rate-limit errors, but this pause does
not promise that the server quota resets after one minute. Existing codes can be
verified during the pause, without requesting another email.

“Requested path is invalid” while opening a mail link does not by itself prove
which setting is wrong. Check the Site URL, allowed redirects and link template;
the code option is a recovery path. The agent could not inspect live dashboard
settings because this environment's proxy denied the hosted project/website.

## 3. Update the app on Ubuntu

Run these in the terminal from the existing checkout:

```sh
cd ~/occlude
git pull --ff-only
nvm install 24
nvm use 24
npm ci
```

If you do not already have `.env.local`, run `cp .env.example .env.local`.
Otherwise preserve the file and edit its two public settings. `.env.local` must
never contain an elevated secret key. Run `npm run dev`; restart Vite after editing
environment variables.

In the app, open **Einstellungen → Cloud-Synchronisierung**, enter your email,
and press **Anmelde-E-Mail senden**. Enter its code (or open the link in that browser), then press
**Dieses Gerät verbinden**. Existing local cards and history are adopted only
after explicit confirmation. If the migration is missing, connection shows a
specific error and the existing local workspace remains usable.

For the Codex cloud environment, the draft declares the project hostname and the
two public variable requirements. Review/save the domain change in environment
settings to enable requests from that machine; publishing alone does not apply
SQL to Supabase. The current machine has a local ignored `.env.local` with only
the public settings. Never paste secret values into chat.

## 4. Verify on two devices

1. Sign into the same account on A and B and explicitly connect each browser.
2. Create an image and masks on A. Wait until all changes synchronize.
3. Open B; verify metadata and the image load, then review a card.
4. Return to A and synchronize; verify its history and schedule update.
5. For concurrent reviews, load/cache the same card on both devices, disconnect
   both WITHOUT reloading the app, rate it independently, then reconnect in opposite
   orders. Both events should remain and schedules should converge.
6. Create a second test user in a different browser profile. It must not see the
   first user's decks or retrieve its images. A single browser profile is bound
   to one workspace, so sign-out does not silently switch cached accounts.

Full installed-PWA restart offline and verified deck downloads are still Phase 3.
The local tests in TESTING.md do not replace these hosted-service checks.

## Retention and orphaned images

Private content is immutable: authenticated clients cannot overwrite or delete
objects. Failed uploads may leave objects without metadata. After at least seven
days, an administrator may identify objects having **no** matching `images`
storage_path for that owner and delete them through the supported Storage API/UI.
Recheck references immediately before deletion. Never delete Storage metadata
rows directly; that does not delete backing object bytes safely.

Tombstoned images that still have card or review references are retained. This
version does not automatically purge them. A later retention/export migration
must archive history and validate references before permanent collection. This
conservative policy uses more storage but prevents loss of referenced originals.
