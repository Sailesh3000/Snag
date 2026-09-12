# Snag — AWS Serverless Backend (CDK)

Thin, stateless proxy backend for the Snag Chrome extension. It is **not** a
data store: all durable user data (profile, resumes, answer memory, embeddings)
lives in the extension's local IndexedDB. The only things authoritative
server-side are **subscription status** and **usage counters** (DynamoDB).

LLM *generation* is BYOK — the extension calls Anthropic/OpenAI/Groq/Ollama
directly with the user's own key, so this backend never sees a prompt and
holds no LLM provider key at all. The subscription instead gates (a) using
Snag at all (a license check via `/api/me`) and (b) the one thing still
centralized: semantic "similar past answers" matching via **Amazon Bedrock
Titan Embeddings** (`/api/embed`), which is IAM-only — no external API key,
no secret in SSM.

## Layout

```
infra/
├── app.py                       # CDK app entrypoint
├── cdk.json
├── requirements.txt             # aws-cdk-lib + constructs
├── snag_infra/
│   └── stack.py                 # SnagStack: Cognito, DynamoDB, SSM, 2 HTTP APIs, 2 Lambdas
└── lambdas/
    ├── snag_api/main.py         # /api/me (license check) + /api/embed (Bedrock Titan) — subscription-gated
    └── snag_paddle_webhook/main.py  # Paddle webhook: HMAC-verified, idempotent subscription event processing
```

## What the stack creates

| Resource | Notes |
|---|---|
| Cognito User Pool + public OAuth client | Hosted UI, PKCE authorization-code flow (no client secret) |
| DynamoDB `SnagBillingTable` | on-demand, `pk`/`sk` keys — subscription + usage counters only |
| SSM Parameter Store (SecureString) | `/snag/paddle_api_key`, `/snag/paddle_webhook_secret` (no LLM/embedding provider keys — Bedrock is IAM-only) |
| API Gateway **HTTP** API `SnagApi` | catch-all route gated by a Cognito **JWT authorizer** — the extension's `/api/*` calls |
| API Gateway **HTTP** API `SnagWebhookApi` | catch-all route, unauthenticated (HMAC verified in-Lambda) — Paddle webhooks |
| Lambda `snag-api` | ARM, 256MB, 15s — reads subscription, writes usage counters, calls Bedrock via IAM (`bedrock:InvokeModel`, no secret) |
| Lambda `snag-paddle-webhook` | ARM, 128MB, reads the webhook secret from SSM |

## Prerequisites

- Python 3.12 venv with `pip install -r requirements.txt`
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS credentials (`aws configure` or an assumed role) for `deploy`

## Commands

```bash
cd infra
python app.py            # entrypoint (used by cdk)
cdk synth                # emit CloudFormation to cdk.out/ (no AWS creds needed)
cdk deploy               # deploy (needs AWS creds; ExtensionCallbackUrl has a dev default)
```

> **Full end-to-end walkthrough** (first deploy, region opt-in, venv
> gotchas, post-deploy wiring, smoke test, re-deploys, CI/CD,
> troubleshooting): **[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)**.
> Note: `npx cdk` must run with the repo venv's `python` on `PATH`
> (activate the venv first), and `ap-south-1` requires a one-time
> region opt-in.

## Secrets (set out-of-band, never in CI)

```bash
aws ssm put-parameter --name /snag/paddle_api_key    --type SecureString --value "<key>"
aws ssm put-parameter --name /snag/paddle_webhook_secret --type SecureString --value "<secret>"
```

No Anthropic/OpenAI key is needed here — generation is BYOK (the extension
holds the user's own key) and embeddings use Bedrock (IAM-only).

## DynamoDB item shape

| Item | pk | sk | Fields |
|---|---|---|---|
| Subscription | `USER#<sub>` | `SUBSCRIPTION` | `status` (`active`/`cancelled`/`past_due`), `currentPeriodEnd`, `paddleSubscriptionId` |
| Usage counter | `USER#<sub>` | `USAGE#<YYYY-MM>` | `generateCount`, `embedCount` (atomic conditional increments) |
| Webhook idempotency | `WEBHOOK#<paddleEventId>` | `RECEIVED` | `receivedAt` (TTL ~30d, Phase 3) |

## Endpoints (`snag-api`)

All routes sit behind the Cognito JWT authorizer; `sub` from the verified
claims is the only per-user key.

| Route | Gating | Behavior |
|---|---|---|
| `GET /api/me` | — | `{sub, email, subscriptionStatus, currentPeriodEnd}` — the license check the extension gates all usage on |
| `POST /api/embed` | 402 unless `status: active`; 429 at 500 calls/day | Bedrock `amazon.titan-embed-text-v2:0` → `{"embedding": [...]}` |

LLM generation (`answer:generate` in the extension) never reaches this
backend at all — see `extension/src/llm/client.ts`, which calls the user's
own configured provider directly. The daily ceiling on `/api/embed`
(`EMBED_CAP_PER_DAY` in `main.py`) is abuse/cost protection on the Bedrock
spend only, not a marketed limit. Usage counters live in `USAGE#<YYYY-MM>`
items: new month = new item, the daily window is re-baselined lazily via
conditional updates.

**Why a plain handler, not FastAPI+Mangum**: with generation gone (BYOK),
there's no streaming response left in this backend at all — `/api/embed`
is a single small JSON round-trip. A plain handler keeps the Lambda
stdlib+boto3-only (no Mangum/FastAPI/Pydantic dependencies to bundle),
which keeps zip packaging trivial from any host (Windows included) for the
ARM_64 runtime.

## Deploy-time configuration checklist

The extension ships with `REPLACE_WITH_*` placeholders on the client side;
the infra outputs (`ApiUrl`, `WebhookApiUrl`, `UserPoolId`,
`UserPoolClientId`) feed them. After the first `cdk deploy`:

1. **Cognito client callback URLs** — register BOTH on the OAuth client's
   domain allow list:
   - `https://devtools-window.chromiumapp.org/oauth-callback`
     (developer / unpacked builds)
   - `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/oauth-callback`
     (store build — the ID is pinned by the manifest `key` field, so it is
     known before submission; private key kept outside the repo at
     `C:\Users\Sailesh\snag-extension-key.pem`)
2. **Paddle vendor account**:
   - Create the single $5/month subscription item; copy its checkout URL
     into `extension/src/shared/pricing.ts` (`PADDLE_CHECKOUT_URL`). The
     extension appends `custom_data[cognitoSub]=<sub>` at runtime, which the
     webhook uses to link the subscription to the Cognito user.
   - Set the checkout **confirmation page URL** to
     `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/checkout-done.html`
     — that page pings the background for an immediate `/api/me` re-poll
     (the 30s alarm is the fallback for webhook latency).
   - Copy the customer-center URL into `extension/src/shared/pricing.ts`
     (`PADDLE_PORTAL_URL`), `ui/src/lib/pricing.ts`, **and**
     `extension/src/settings/index.ts` (keep all three in sync).
   - Add a webhook for `subscription.created` / `updated` / `canceled`
     pointing at `WebhookApiUrl`; its HMAC secret must match
     `/snag/paddle_webhook_secret` in SSM.
3. **Extension placeholders** — fill after deploy:
   `extension/src/shared/authConfig.ts` (apiBaseUrl, cognitoDomain,
   clientId), the Paddle URLs above, and
   `ui/src/components/FeedbackModal.tsx` (`FEEDBACK_EMAIL`).
4. **CfnParameter `ExtensionCallbackUrl`** — pass the published
   `chrome-extension://` callback URL on (re)deploy once the store ID exists
   (or set the `EXTENSION_CALLBACK_URL` GitHub secret so CI deploys pass it
   automatically — see below).

## CI/CD (GitHub Actions) setup

`.github/workflows/ci.yml` runs on every PR (`pytest` + `vitest` + `cdk
synth`), deploys on push to `main` via **GitHub OIDC** (no AWS keys in CI),
and builds a zipped extension artifact on `v*` tags. One-time setup:

1. **Bootstrap CDK** (once, per account/region):

   ```bash
   cd infra && npx cdk bootstrap aws://<account-id>/us-east-1
   ```

2. **Create the OIDC provider + deploy role in AWS** (IAM console or CLI):

   - OIDC provider for `token.actions.githubusercontent.com` (AWS shows the
     current thumbprint to paste).
   - Role `snag-ci-deploy` with a trust policy restricted to this repo and
     branch:

     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:<github-owner>/job-apply-agent:ref:refs/heads/main"
           }
         }
       }]
     }
     ```

   - Permission policy — scoped to the services this stack uses (personal
     account, role assumable only by this repo's `main` branch):

     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{
         "Effect": "Allow",
         "Action": [
           "cloudformation:CreateStack", "cloudformation:UpdateStack",
           "cloudformation:DeleteStack", "cloudformation:DescribeStacks",
           "cloudformation:DescribeStackEvents", "cloudformation:DescribeStackResource",
           "cloudformation:DescribeStackResources", "cloudformation:GetTemplate",
           "cloudformation:ValidateTemplate",
           "iam:PassRole", "iam:CreateRole", "iam:GetRole", "iam:DeleteRole",
           "iam:PutRolePolicy", "iam:DeleteRolePolicy",
           "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListRolePolicies",
           "lambda:*", "cognito-idp:*", "dynamodb:*", "apigateway:*", "logs:*",
           "ssm:PutParameter", "ssm:GetParameter", "ssm:DescribeParameters",
           "s3:GetObject", "s3:PutObject", "s3:ListBucket",
           "s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:PutBucketVersioning"
         ],
         "Resource": "*"
       }]
     }
     ```

     (S3 actions cover CDK's bootstrap bucket for Lambda asset uploads.)

3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `AWS_DEPLOY_ROLE_ARN` | the role's ARN |
   | `EXTENSION_CALLBACK_URL` | *(optional)* the published `chrome-extension://…/oauth-callback` URL; when set, deploys pass it as the `ExtensionCallbackUrl` parameter |

   Optional variable: `AWS_REGION` (defaults to `us-east-1`). The workflow
   also references the `production` GitHub environment — create it (repo →
   Settings → Environments) to gate deploys behind required reviewers if
   desired.
