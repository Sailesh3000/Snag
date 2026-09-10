# Snag — Deployment Guide

End-to-end: from a clean machine to a deployed, testable backend, then to
re-deploys and the CI/CD path. The stack is defined in [`infra/`](../infra)
(CDK, Python 3.12); this guide covers the commands, the deploy-time
wiring, and the gotchas.

**Deployed region: `ap-south-1` (Mumbai).** The extension manifest allows
both `ap-south-1` and `us-east-1` API hosts; the CI default is
`ap-south-1` (override with the `AWS_REGION` GitHub variable).

## Prerequisites

| Tool | Check |
|---|---|
| AWS CLI v2 | `aws --version` |
| AWS credentials | `aws sts get-caller-identity` (use `aws login` for SSO/IAM-user browser sign-in) |
| Python 3.12 venv with CDK deps | `python -m pip install -r infra/requirements.txt` (the repo `.venv` already has it) |
| CDK CLI v2 | `npx cdk --version` (or `npm install -g aws-cdk@2`) |

### Gotcha 1: `cdk` must run with the venv's `python`

`npx cdk` spawns `python app.py` (per `infra/cdk.json`) with whatever
`python` is first on `PATH`. If that's your system Python you get
`ModuleNotFoundError: No module named 'aws_cdk'`. Activate the repo venv
first:

```bash
# Git Bash / MINGW
source .venv/Scripts/activate

# PowerShell
. .venv\Scripts\Activate.ps1

# Windows cmd
.venv\Scripts\activate.bat
```

Then `python app.py` (and `cdk`) resolve to the venv.

### Gotcha 2: ap-south-1 is an opt-in region

First deploy to ap-south-1 fails with `OptInRequired` ("The AWS Access Key
Id needs a subscription for the service") until the account opts in:

AWS Console → **Account Management** (top-right account menu) →
**AWS Regions** → **Request access to additional AWS Regions** → check
**Asia Pacific (Mumbai)** → Request. Usually minutes for new accounts,
occasionally a few hours. Retry bootstrap once it shows as available.

## First deploy

```bash
source .venv/Scripts/activate          # see Gotcha 1
cd infra

npx cdk bootstrap aws://<account-id>/ap-south-1     # one-time, creates the CDK bootstrap bucket+role
npx cdk deploy --region ap-south-1
```

`cdk deploy` creates the whole stack (Cognito pool + client, DynamoDB
table, 4 SSM SecureString placeholders, 2 HTTP APIs, 2 ARM Lambdas).
The `ExtensionCallbackUrl` parameter defaults to the
`devtools-window.chromiumapp.org` callback, which is correct for
developer/unpacked builds — no prompt needed. Pass the published
`chrome-extension://` callback later via
`--parameters '{"ExtensionCallbackUrl": "chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/oauth-callback"}'`.

### Capture the outputs

```bash
npx cdk list && aws cloudformation describe-stacks --stack-name SnagStack \
  --region ap-south-1 --query 'Stacks[0].Outputs'
```

You need: **`ApiUrl`**, **`WebhookApiUrl`**, **`UserPoolId`**,
**`UserPoolClientId`** (and `BillingTable` for the smoke test below).

## Post-deploy wiring

### 1. Provider secrets (required for answer generation / embeddings)

```bash
aws ssm put-parameter --region ap-south-1 --name /snag/anthropic_api_key --type SecureString --value "<key>"
aws ssm put-parameter --region ap-south-1 --name /snag/openai_api_key    --type SecureString --value "<key>"
```

(Paddle keys are added in the Paddle step; the stack deploys fine before
that — the placeholders just keep the API 500-ing on gated calls.)

### 2. Extension auth config

Fill `extension/src/shared/authConfig.ts`:

```ts
apiBaseUrl:  "<ApiUrl output>",
cognitoDomain: "https://<UserPoolId>.auth.ap-south-1.amazoncognito.com",
clientId: "<UserPoolClientId output>",
```

Rebuild (`cd extension && npm run build`) and reload the unpacked
extension. The Cognito client already has
`https://devtools-window.chromiumapp.org/oauth-callback.html` as its
callback (the deploy-time checklist in `infra/README.md` covers adding
the published `chrome-extension://` callback after CWS submission).

### 3. Paddle (when taking payments)

1. Vendor account → create the single **$10/month** subscription item.
2. Checkout **confirmation page** →
   `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/checkout-done.html`
3. Add a webhook for `subscription.created` / `subscription.updated` /
   `subscription.canceled` → `WebhookApiUrl`; its HMAC secret must be the
   same value you put in `/snag/paddle_webhook_secret`:

   ```bash
   aws ssm put-parameter --region ap-south-1 --name /snag/paddle_api_key         --type SecureString --value "<key>"
   aws ssm put-parameter --region ap-south-1 --name /snag/paddle_webhook_secret  --type SecureString --value "<secret>"
   ```

4. Copy the checkout URL into `extension/src/shared/pricing.ts`
   (`PADDLE_CHECKOUT_URL`) and the customer-center URL into all three
   `PADDLE_PORTAL_URL` copies (`extension/src/shared/pricing.ts`,
   `ui/src/lib/pricing.ts`, `extension/src/settings/index.ts`).
5. Fill `FEEDBACK_EMAIL` in `ui/src/components/FeedbackModal.tsx`.

## Smoke test (no real payment needed)

1. Load the unpacked extension (`chrome://extensions` → Developer mode →
   Load unpacked → `extension/`), open any application form, sign in from
   the sidebar (Cognito Hosted UI, self-sign-up).
2. Get your Cognito `sub` (sidebar → DevTools, or the Cognito console).
3. Plant an active subscription:

   ```bash
   aws dynamodb put-item --region ap-south-1 --table-name "<BillingTable>" \
     --item '{"pk":{"S":"USER#<sub>"}, "sk":{"S":"SUBSCRIPTION"}, "status":{"S":"active"}, "currentPeriodEnd":{"S":"2026-12-31T00:00:00Z"}}'
   ```

4. Generate an answer. Expected: 402/`subscription_required` before the
   put, a streamed draft after. Delete the item to re-test the gate.

## Re-deploys

```bash
source .venv/Scripts/activate && cd infra
npx cdk deploy --region ap-south-1
```

Safe to run repeatedly after stack changes; CDK diffs the template.
To remove everything: `npx cdk destroy --region ap-south-1` (destroys
the Cognito pool, table, APIs, and Lambdas — SSM parameters remain).

## CI/CD deploys (after the one-time OIDC setup)

See `infra/README.md` → "CI/CD (GitHub Actions) setup". Once the
`snag-ci-deploy` role exists and `AWS_DEPLOY_ROLE_ARN` is set, every
push to `main` runs `cdk deploy` (region `ap-south-1` by default), and
`v*` tags produce a zipped extension artifact. Until then, the `deploy`
job fails by design — the `test` job (pytest + vitest + synth) is the
useful gate.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ModuleNotFoundError: No module named 'aws_cdk'` during cdk | System Python on PATH — activate the venv (Gotcha 1) |
| `OptInRequired` on bootstrap/deploy | Region not opted in (Gotcha 2) |
| `cdk deploy` prompts for `ExtensionCallbackUrl` | Pass `--parameters '{"ExtensionCallbackUrl": "..."}'` |
| Extension: `fetch failed` / CORS in the background console | `authConfig.apiBaseUrl` region/host mismatch the manifest's `host_permissions` — both regions are listed; make sure the URL matches one |
| `402 subscription_required` persists after put | Wrong table, wrong `sub`, or `status` not exactly `"active"` |
| Cognito sign-in redirect error | Callback URL not on the client's allow list (checklist item 1) |
