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

### Gotcha 2: `OptInRequired` on a brand-new AWS account

First deploy can fail with `OptInRequired` ("The AWS Access Key Id needs a
subscription for the service") — this is **not** a per-region opt-in
toggle (`ap-south-1`/Mumbai is not one of AWS's opt-in regions, unlike
e.g. `ap-east-1` or `il-central-1`, which do need one). It's a temporary,
**account-wide** identity/fraud-verification hold on a brand-new account
that blocks most services in every region simultaneously — confirmed by
the fact that the identical error hit `us-east-1` too, `iam:ListUsers`
kept working throughout (IAM is exempt), and even `aws ce
get-cost-and-usage` (Cost Explorer, unrelated to CloudFormation) was
blocked with the same error. It normally clears within a few hours,
occasionally up to ~24-48h. Check the signup email / Billing console for a
verification prompt, and just retry once it clears — nothing on the deploy
side needs to change.

### Gotcha 3: Bedrock's separate, additional verification hold

Even after the account-wide hold above clears, a first `bedrock-runtime
invoke-model` call can still fail with `AccessDeniedException: Your
account is currently being verified...` — this is a **second, Bedrock-
specific** fraud check, independent of the general account verification.
Per AWS's own error message it "normally takes less than 2 hours." Retry
the smoke test's embed call once that clears.

## First deploy

```bash
source .venv/Scripts/activate          # see Gotcha 1
cd infra

npx cdk bootstrap aws://<account-id>/ap-south-1     # one-time, creates the CDK bootstrap bucket+role
npx cdk deploy --region ap-south-1
```

`cdk deploy` creates the whole stack (Cognito pool + client, DynamoDB
table, 2 HTTP APIs, 2 ARM Lambdas). No SSM parameters are created by CDK —
CloudFormation can't create `SecureString` parameters at all, so the
Paddle secrets below are set directly via the AWS CLI instead.
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
**`UserPoolClientId`**, **`CognitoDomain`** (and `BillingTable` for the
smoke test below).

## Post-deploy wiring

### 1. No provider secrets needed for AI at all

Answer generation is BYOK (the extension calls Anthropic/OpenAI/Groq/Ollama
directly with the user's own key — nothing to configure here), and
embeddings use Bedrock, which is IAM-only (no key/secret). The only secrets
this stack needs are Paddle's, added in the Paddle step below — the stack
deploys and `/api/embed` works fine before that (Paddle just isn't wired
up for billing yet).

### 2. Extension auth config

Fill `extension/src/shared/authConfig.ts` using the **`CognitoDomain`**
stack output directly (do not construct it from `UserPoolId` — the Hosted
UI domain is a separately-provisioned managed domain with its own prefix,
`snag-<account-id>`, not derived from the pool ID):

```ts
apiBaseUrl:  "<ApiUrl output>",
cognitoDomain: "<CognitoDomain output>",
clientId: "<UserPoolClientId output>",
```

Rebuild both `ui/` (`npm run build`, then copy `ui/build/*` into
`extension/sidebar/`) and `extension/` (`npm run build`), then reload the
unpacked extension. The Cognito client already has
`https://devtools-window.chromiumapp.org/oauth-callback` as its
callback (the deploy-time checklist in `infra/README.md` covers adding
the published `chrome-extension://` callback after CWS submission).

### 3. Paddle (when taking payments)

1. Vendor account → create the single **$5/month** subscription item.
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

4. Approve a drafted answer (this is what triggers the license-gated
   `/api/embed` call). Expected: the sidebar shows the subscribe wall / a
   "subscription required" error before the put, and the answer saves with
   a real embedding after. Delete the item to re-test the gate. Note:
   answer *generation* itself is BYOK and works regardless of subscription
   status (nothing to test against this backend there) — only `/api/embed`
   is backend-gated.

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
| `OptInRequired` on bootstrap/deploy/any AWS CLI call | Brand-new account, general verification hold — account-wide, not region-specific (Gotcha 2) |
| `AccessDeniedException: ...account is currently being verified` on `bedrock-runtime invoke-model` | Bedrock's separate verification hold (Gotcha 3) |
| `cdk deploy` prompts for `ExtensionCallbackUrl` | Pass `--parameters '{"ExtensionCallbackUrl": "..."}'` |
| Extension: `fetch failed` / CORS in the background console | `authConfig.apiBaseUrl` region/host mismatch the manifest's `host_permissions` — both regions are listed; make sure the URL matches one |
| `402 subscription_required` persists after put | Wrong table, wrong `sub`, or `status` not exactly `"active"` |
| Cognito sign-in redirect error | Callback URL not on the client's allow list (checklist item 1) |
