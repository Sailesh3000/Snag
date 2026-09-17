# Snag — AWS Serverless Backend (CDK)

Thin, stateless proxy backend for the Snag Chrome extension. It is **not** a
data store: all durable user data (profile, resumes, answer memory, embeddings)
lives in the extension's local IndexedDB. Free product, no billing — the only
thing authoritative server-side is a small **usage counter** (DynamoDB) that
caps daily Bedrock embedding calls as cost protection.

LLM *generation* is BYOK — the extension calls Anthropic/OpenAI/Groq/Ollama
directly with the user's own key, so this backend never sees a prompt and
holds no LLM provider key at all. The one thing still centralized here is
semantic "similar past answers" matching via **Amazon Bedrock Titan
Embeddings** (`/api/embed`), which is IAM-only — no external API key, no
secret anywhere.

## Layout

```
infra/
├── app.py                       # CDK app entrypoint
├── cdk.json
├── requirements.txt             # aws-cdk-lib + constructs
├── snag_infra/
│   └── stack.py                 # SnagStack: Cognito, DynamoDB, 1 HTTP API, 1 Lambda
└── lambdas/
    └── snag_api/main.py         # /api/me (identity check) + /api/embed (Bedrock Titan)
```

## What the stack creates

| Resource | Notes |
|---|---|
| Cognito User Pool + public OAuth client | Hosted UI, PKCE authorization-code flow (no client secret) |
| DynamoDB `SnagBillingTable` | on-demand, `pk`/`sk` keys — usage counters only |
| API Gateway **HTTP** API `SnagApi` | catch-all route gated by a Cognito **JWT authorizer** — the extension's `/api/*` calls |
| Lambda `snag-api` | ARM, 256MB, 15s — checks the signed-in `sub`, writes usage counters, calls Bedrock via IAM (`bedrock:InvokeModel`, no secret) |

No SSM parameters, no secrets at all — Bedrock is IAM-only and there is
nothing else this backend needs to authenticate to.

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

## DynamoDB item shape

| Item | pk | sk | Fields |
|---|---|---|---|
| Usage counter | `USER#<sub>` | `USAGE#<YYYY-MM>` | `embedCount`, `embedDay`, `embedDayCount` (atomic conditional increments) |

## Endpoints (`snag-api`)

All routes sit behind the Cognito JWT authorizer; `sub` from the verified
claims is the only per-user key.

| Route | Gating | Behavior |
|---|---|---|
| `GET /api/me` | — | `{sub, email}` — confirms the token is valid |
| `POST /api/embed` | 401 unless signed in; 429 at 500 calls/day | Bedrock `amazon.titan-embed-text-v2:0` → `{"embedding": [...]}` |

LLM generation (`answer:generate` in the extension) never reaches this
backend at all — see `extension/src/llm/client.ts`, which calls the user's
own configured provider directly. The daily ceiling on `/api/embed`
(`EMBED_CAP_PER_DAY` in `main.py`) is abuse/cost protection on the Bedrock
spend only — the product is free, there's no paid tier to protect. Usage
counters live in `USAGE#<YYYY-MM>` items: new month = new item, the daily
window is re-baselined lazily via conditional updates.

**Why a plain handler, not FastAPI+Mangum**: there's no streaming response
in this backend at all — `/api/embed` is a single small JSON round-trip. A
plain handler keeps the Lambda stdlib+boto3-only (no Mangum/FastAPI/Pydantic
dependencies to bundle), which keeps zip packaging trivial from any host
(Windows included) for the ARM_64 runtime.

## Deploy-time configuration checklist

The extension ships with `REPLACE_WITH_*` placeholders on the client side;
the infra outputs (`ApiUrl`, `UserPoolId`, `UserPoolClientId`,
`CognitoDomain`) feed them. After the first `cdk deploy`:

1. **Cognito client callback URL** — one URL covers both dev and prod:
   `https://jobacpbllhlmlidhnhoaobcdidjfknif.chromiumapp.org/oauth-callback`.
   `chrome.identity.getRedirectURL()` always returns
   `https://<extension-id>.chromiumapp.org/<path>`, and the ID is pinned by
   the manifest `key` field (private key kept outside the repo at
   `C:\Users\Sailesh\snag-extension-key.pem`), so it's the SAME
   deterministic ID whether loaded unpacked or installed from the Chrome
   Web Store — no dev/prod split needed, and this is already the CDK
   stack's `ExtensionCallbackUrl` default (deployed).
2. **Extension placeholders** — fill after deploy:
   `extension/src/shared/authConfig.ts` (apiBaseUrl, cognitoDomain from the
   `CognitoDomain` output — not derived from `UserPoolId`, clientId), and
   `ui/src/components/FeedbackModal.tsx` (`FEEDBACK_EMAIL`).

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
   | `EXTENSION_CALLBACK_URL` | *(optional, rarely needed)* override for the `ExtensionCallbackUrl` parameter — the deployed default (`https://jobacpbllhlmlidhnhoaobcdidjfknif.chromiumapp.org/oauth-callback`) is already correct for both dev and prod since the manifest `key` pins a deterministic extension ID; only set this if that key ever changes |

   Optional variable: `AWS_REGION` (defaults to `us-east-1`). The workflow
   also references the `production` GitHub environment — create it (repo →
   Settings → Environments) to gate deploys behind required reviewers if
   desired.
