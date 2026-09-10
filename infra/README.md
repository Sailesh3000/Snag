# Snag — AWS Serverless Backend (CDK)

Thin, stateless proxy backend for the Snag Chrome extension. It is **not** a
data store: all durable user data (profile, resumes, answer memory, embeddings)
lives in the extension's local IndexedDB. The only things authoritative
server-side are **subscription status** and **usage counters** (DynamoDB), plus
the secrets the LLM provider proxy needs (SSM Parameter Store).

## Layout

```
infra/
├── app.py                       # CDK app entrypoint
├── cdk.json
├── requirements.txt             # aws-cdk-lib + constructs
├── snag_infra/
│   └── stack.py                 # SnagStack: Cognito, DynamoDB, SSM, 2 HTTP APIs, 2 Lambdas
└── lambdas/
    ├── snag_api/main.py         # /api/me + /api/answer/generate (SSE) + /api/embed — subscription-gated
    └── snag_paddle_webhook/main.py  # Paddle webhook: HMAC-verified, idempotent subscription event processing
```

## What the stack creates

| Resource | Notes |
|---|---|
| Cognito User Pool + public OAuth client | Hosted UI, PKCE authorization-code flow (no client secret) |
| DynamoDB `SnagBillingTable` | on-demand, `pk`/`sk` keys — subscription + usage counters only |
| SSM Parameter Store (SecureString) | `/snag/anthropic_api_key`, `/snag/openai_api_key`, `/snag/paddle_api_key`, `/snag/paddle_webhook_secret` |
| API Gateway **HTTP** API `SnagApi` | catch-all route gated by a Cognito **JWT authorizer** — the extension's `/api/*` calls |
| API Gateway **HTTP** API `SnagWebhookApi` | catch-all route, unauthenticated (HMAC verified in-Lambda) — Paddle webhooks |
| Lambda `snag-api` | ARM, 256MB, 60s — reads subscription, writes usage counters, reads 2 provider keys from SSM |
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
aws ssm put-parameter --name /snag/anthropic_api_key --type SecureString --value "<key>"
aws ssm put-parameter --name /snag/openai_api_key    --type SecureString --value "<key>"
aws ssm put-parameter --name /snag/paddle_api_key    --type SecureString --value "<key>"
aws ssm put-parameter --name /snag/paddle_webhook_secret --type SecureString --value "<secret>"
```

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
| `GET /api/me` | — | `{sub, email, subscriptionStatus, currentPeriodEnd}` |
| `POST /api/answer/generate` | 402 unless `status: active`; 429 at 300 calls/day | Anthropic `claude-sonnet-4-5`, response is `text/event-stream`: `data: {"text": "..."}` events + `data: [DONE]` |
| `POST /api/embed` | 402 unless `status: active`; 429 at 500 calls/day | OpenAI `text-embedding-3-small` → `{"embedding": [...]}` |

The daily ceilings (`GENERATE_CAP_PER_DAY` / `EMBED_CAP_PER_DAY` in
`main.py`) are abuse/cost protection only, not a marketed limit. Usage
counters live in `USAGE#<YYYY-MM>` items (plan A2): new month = new item,
the daily window is re-baselined lazily via conditional updates.

**Why a plain handler, not FastAPI+Mangum** (revises the Phase 1 note):
Mangum's ASGI adapter buffers the full response body in the classic Lambda
path, so it would add three dependencies and asset-bundling risk for zero
streaming benefit. The SSE *contract* is identical either way; incremental
(token-by-token) delivery is a Lambda + API Gateway response-streaming
runtime feature to enable/verify at deploy time — it changes no request or
response contract here. Stdlib-only (`urllib` for provider calls) also keeps
the zip bundling trivial from any host (Windows included) for the ARM_64
runtime.

## Deploy-time configuration checklist

The extension ships with `REPLACE_WITH_*` placeholders on the client side;
the infra outputs (`ApiUrl`, `WebhookApiUrl`, `UserPoolId`,
`UserPoolClientId`) feed them. After the first `cdk deploy`:

1. **Cognito client callback URLs** — register BOTH on the OAuth client's
   domain allow list:
   - `https://devtools-window.chromiumapp.org/oauth-callback.html`
     (developer / unpacked builds)
   - `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/oauth-callback.html`
     (store build — the ID is pinned by the manifest `key` field, so it is
     known before submission; private key kept outside the repo at
     `C:\Users\Sailesh\snag-extension-key.pem`)
2. **Paddle vendor account**:
   - Create the single $10/month subscription item; copy its checkout URL
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
4. **Lambda response streaming** — enable on `snag-api` (Lambda + API
   Gateway runtime feature) so `/api/answer/generate` streams
   token-by-token instead of returning the buffered SSE body.
5. **CfnParameter `ExtensionCallbackUrl`** — pass the published
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
