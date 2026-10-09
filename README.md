# Deriv Trading Bot

A self-hosted, visual trading-bot builder on the Deriv WebSocket API. Drag-and-drop
strategy building with Blockly, an interactive SmartCharts chart, automated strategy
execution, and dashboard/tutorials.

> **Note:** Unlike the other templates in this repo (Rise/Fall, Accumulators, Digits)
> which are **Next.js** apps, the bot is a **[Rsbuild](https://rsbuild.dev) + React
> Router** single-page app. The commands, build output, and environment variables
> below differ accordingly.

## Prerequisites

- Node.js 18.18 or later

## Step 1: Register Your App ID

1. Log in to your Deriv account and go to the [API Token page](https://app.deriv.com/account/api-token) to create a token with the required scopes.
2. Navigate to [App Registration](https://developers.deriv.com/dashboard/) and register a new application.
3. Set the **Redirect URI** to the URL where you will host this app (e.g. `http://localhost:4003` for local development).
4. Copy the **App ID** shown after registration — you will need it in the next step.

## Step 2: Configure `.env`

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
# Required: Deriv app id — drives OAuth login/sign-up and WebSocket connections.
NEXT_PUBLIC_DERIV_APP_ID=your_app_id_here

# Optional: environment + affiliate attribution.
NEXT_PUBLIC_DERIV_ENV=production
NEXT_PUBLIC_DERIV_REFERRAL_LINK=your_referral_link_here

# Optional: Google Drive integration (leave blank to disable).
GD_CLIENT_ID=
GD_APP_ID=
GD_API_KEY=
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_DERIV_APP_ID` | Deriv app id issued for your registered app. Drives OAuth login/sign-up and WebSocket connections. Without it, Log in / Sign up stay disabled. |
| `NEXT_PUBLIC_DERIV_ENV` | `production` for live Deriv endpoints; `preview` (or `staging`) for staging. Read by both the bot's URL resolver and `@deriv/core` for OAuth. |
| `NEXT_PUBLIC_DERIV_REFERRAL_LINK` | Affiliate referral link — appended as `affiliate_token` / `utm_campaign` on OAuth (optional). |
| `GD_CLIENT_ID` / `GD_APP_ID` / `GD_API_KEY` | Google Drive integration credentials for saving/loading strategies (optional). |

> These variables are injected at **build time** via Rsbuild's `source.define`
> (see `rsbuild.config.ts`), so re-build after changing them.

## Branding (`brand.config.json`)

The App Builder also writes branding into `brand.config.json`. Relevant `platform` keys:

| Key | Description |
|---|---|
| `platform.name` | In-app display name (header, tab title, favicon). Set in App Builder Customise. Overridden by `NEXT_PUBLIC_DERIV_APP_NAME` when that env var is set. |
| `platform.show_name` | `true` (default) shows the name next to the logo on desktop; `false` hides it |

Tab title and favicon use `NEXT_PUBLIC_DERIV_APP_NAME` when set, otherwise `platform.name` (with a generic fallback), and are not blanked when `show_name` is false. OAuth/consent registration name is separate and is not written into these fields by App Builder.

## Step 3: Local Development

```bash
npm install
npm run dev
```

The app is available at `http://localhost:4003`. (`npm install` and `npm run dev`
also regenerate brand CSS — see Branding below.)

## Step 4: Build for Production

```bash
npm run build
```

This produces a static build in the `dist/` directory (Rsbuild output — there is no
`.next`/`out`). Serve the contents of `dist/` from any web server or static host.
SmartCharts engine assets are copied into `dist/js/smartcharts/` during the build.

## Google Drive integration (optional)

Saving/loading strategies to Google Drive stays disabled unless `GD_CLIENT_ID`,
`GD_APP_ID`, and `GD_API_KEY` are all set. **If it's not set up in your host
environment yet:**

1. **Get the credentials** — follow Google's [Picker set-up guide](https://developers.google.com/workspace/drive/picker/guides/web-picker#set-up-environment):
   enable the **Google Picker API** + **Drive API**, then create an **OAuth 2.0
   Client ID** (Web application) and an **API key**. Use the project number as `GD_APP_ID`.
2. **Authorize your domain** — add your deployed URL (e.g. `https://your-app.vercel.app`)
   to the OAuth client's **Authorized JavaScript origins** (exact origin; no wildcards).
3. **Set them in your host env — not in source** — add the three vars to your host
   (Vercel → Settings → Environment Variables; Heroku → Settings → Config Vars).
   Don't commit them to the repo.
4. **Rebuild** — they're baked in at build time (`source.define`), so trigger a new build/deploy.

> Deploying via Deriv App Builder? Open your app in **Edit** mode and enter these
> three values — App Builder injects them into your host environment for you
> (never into the app source).

## Bulk Purchase (Netlify deployment)

Bulk Purchase is served by the Netlify Functions in `netlify/functions/`; it is
available only when this static app is deployed with Netlify Functions. The
separate Deriv App Builder Cloudflare BFF is not part of this repository, so its
deployment does not receive these functions or secrets.

### Server configuration

Enable Netlify Identity for the site and use invite-only registration. Grant the
`bulk-purchase` Identity role only to trusted operators who are allowed to submit
trades. The function checks that role on every account-list and purchase request.
Configure these variables in Netlify's site environment, never as `NEXT_PUBLIC_*`
variables:

```env
DERIV_BULK_PURCHASE_APP_ID=your_deriv_app_id
DERIV_BULK_PURCHASE_ACCOUNTS='[{"account_id":"VRTC1234567","label":"Demo account","account_type":"demo","token":"trade_scoped_demo_pat"},{"account_id":"CR1234567","label":"Real account","account_type":"real","token":"trade_scoped_real_pat"}]'
```

Each configured account needs its own trade-scoped Deriv PAT, paired with the
account that PAT owns. The account list endpoint returns only account IDs,
labels, and environment; it never returns a PAT. The purchase function builds
Deriv's exact `contract_parameters` and `accounts` request body on the server and
sends the `Deriv-App-ID` header. No OAuth bearer token is sent to Deriv's bulk
endpoint. Deriv credentials are never logged. Configure values separately in
each Netlify deploy context. Rotate a PAT in Deriv and update the corresponding
server environment value if it is revoked or expires.

### Demo use

After deployment, sign in with an invited Netlify Identity user assigned the
`bulk-purchase` role. Choose **Demo**, select one or more configured demo
accounts, and enter a JSON object containing the options contract parameters
accepted by Deriv. The same contract is submitted to every selected account.
The endpoint accepts 1–100 account/token pairs; it does not accept different
contracts per account in a single request. Deriv validates the contract fields.

### Real-account safety

Real accounts are shown only when configured as `real`; switching environments
clears the account selection. Submitting a real purchase requires a separate
confirmation. Keep real PATs limited to accounts and operators that are
authorized for trading. A timeout or lost network response can occur after Deriv
has processed a purchase, so the feature never retries automatically; check the
account's contract activity before submitting again.

### Changed files

- `netlify/functions/bulk-purchase.ts` validates the request, checks the
  Identity role, injects server-only account PATs, calls the documented Deriv
  endpoint once, and returns sanitized per-account results.
- `netlify/functions/bulk-purchase-accounts.ts` returns configured account
  labels and IDs without exposing credentials.
- `netlify/functions/_bulk-purchase-config.ts` validates the server-only account
  mapping, PAT lengths, account types, and duplicate IDs for both functions.
- `src/components/bulk-purchase/*` implements the UI, Identity login, validation,
  real-account confirmation, duplicate-submit guard, and result display.
- `src/utils/bulk-purchase.ts` contains request and response validation shared by
  the UI and tests.
- `src/pages/main/main.tsx` adds the control alongside the existing run controls
  without using or changing the bot WebSocket lifecycle.
- `netlify.toml` enables the function directory, and this section documents its
  required server configuration and limitations.

Run checks with:

```bash
npm test -- --runInBand
npm run type-check
npm run lint
npm run build
```

The repository did not previously define a lint script; `npm run lint` checks
the new Bulk Purchase stylesheet. The repository-wide Stylelint config currently
reports existing errors in unrelated stylesheets.

## Branding & White-labeling

Branding (logo, primary color, fonts, app name) is driven by **`brand.config.json`**,
not Next.js config:

- **Colors / fonts / app name** — edit `brand.config.json`, then run
  `npm run generate:brand-css` to bake the values into the theme CSS variables. This
  runs automatically on `npm install`, `npm run dev`, and `npm run build`.
- **Logo** — drop a `public/logo.<png|jpg|jpeg|webp>` to set the header logo; it is also
  used as the favicon. Without it, a letter badge (the app name's first letter) is shown.
- **Theme** — a light/dark toggle lives in the header; the chart re-themes with it.

When assembled by the App Builder, these are configured for you (logo upload, color,
font, and app name are injected at deploy time).
