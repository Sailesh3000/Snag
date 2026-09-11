"""Snag serverless backend — CDK stack.

Thin proxy, not a data store (see the migration plan, Part A):
  - Cognito User Pool + public OAuth client (Hosted UI, PKCE auth-code flow)
  - One tiny DynamoDB table: subscription status + usage counters, nothing else
  - SSM Parameter Store (SecureString) placeholders for provider/webhook secrets
  - API Gateway HTTP API with a built-in Cognito JWT authorizer on the
    $default route; the Paddle webhook route is unauthenticated (HMAC-verified
    in-Lambda)
  - Two Lambdas: snag-api (JWT-gated) and snag-paddle-webhook (HMAC-gated)

No S3, no profile/resume/answer storage, no per-user session state — user data
lives in the extension's IndexedDB.
"""
import os

from aws_cdk import CfnOutput, CfnParameter, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigatewayv2 as apigwv2
from aws_cdk import aws_apigatewayv2_authorizers as apigwv2_auth
from aws_cdk import aws_apigatewayv2_integrations as apigwv2_int
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_dynamodb as ddb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as _lambda
from aws_cdk import aws_logs as logs

LAMBDA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "lambdas")


class SnagStack(Stack):
    def __init__(self, scope, id, **kwargs):
        super().__init__(scope, id, **kwargs)

        # The extension's OAuth redirect URI (the chromiumapp.org URL Chrome
        # generates for the pinned extension key). Overridden at deploy time
        # once the published extension ID is known.
        callback_url = CfnParameter(
            self, "ExtensionCallbackUrl",
            type="String",
            default="https://devtools-window.chromiumapp.org/oauth-callback",
            description="Extension OAuth redirect URI (chromiumapp.org). Set the published extension's callback URL before go-live.",
        )

        # --- Cognito -------------------------------------------------------
        user_pool = cognito.UserPool(
            self, "SnagUserPool",
            self_sign_up_enabled=True,
            auto_verify={"email": True},
            sign_in_aliases={"email": True},
            standard_attributes={
                "email": cognito.StandardAttribute(required=True, mutable=True),
            },
            password_policy={
                "min_length": 8,
                "require_digits": True,
                "require_lowercase": True,
                "require_symbols": True,
                "require_uppercase": True,
            },
            removal_policy=RemovalPolicy.DESTROY,
        )

        app_client = user_pool.add_client(
            "SnagAppClient",
            generate_secret=False,  # public client, no secret -> PKCE
            auth_flows=cognito.AuthFlow(user_srp=True),
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                callback_urls=[callback_url.value_as_string],
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
            ),
            id_token_validity=Duration.hours(1),
            access_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            prevent_user_existence_errors=True,
        )

        # --- DynamoDB (tiny, single-purpose) -------------------------------
        # Webhook idempotency items (WEBHOOK#<id>/RECEIVED) carry a `ttl` so
        # retried Paddle deliveries stay deduplicated for ~30 days and then
        # age out — no cleanup job needed. `ttl` is not a key attribute, so it
        # must NOT appear in AttributeDefinitions (DynamoDB rejects a mismatch
        # between AttributeDefinitions and the actual key schema/indexes) —
        # time_to_live_attribute alone is sufficient to enable it.
        table = ddb.Table(
            self, "SnagBillingTable",
            partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,  # on-demand
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY,
        )

        # --- SSM Parameter Store (SecureString secrets) ---------------------
        # CloudFormation cannot create SecureString parameters (AWS::SSM::Parameter
        # only supports String/StringList), so these are NOT CDK-managed resources.
        # Set the real values once, out-of-band, after this stack deploys:
        #   aws ssm put-parameter --name /snag/anthropic_api_key --type SecureString --value <key>
        #   aws ssm put-parameter --name /snag/openai_api_key --type SecureString --value <key>
        #   aws ssm put-parameter --name /snag/paddle_api_key --type SecureString --value <key>
        #   aws ssm put-parameter --name /snag/paddle_webhook_secret --type SecureString --value <secret>
        # The IAM grants below reference these by ARN only, so the stack deploys
        # fine before the parameters exist — the Lambdas just fail at runtime
        # (ParameterNotFound) until the values above are set.

        # --- Lambdas -------------------------------------------------------
        snag_api = _lambda.Function(
            self, "SnagApiFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="main.handler",
            code=_lambda.Code.from_asset(os.path.join(LAMBDA_DIR, "snag_api")),
            environment={"SNAG_TABLE": table.table_name},
            architecture=_lambda.Architecture.ARM_64,
            memory_size=256,
            # 60s: /api/answer/generate blocks while the LLM streams its
            # completion (55s provider timeout inside the handler).
            timeout=Duration.seconds(60),
            log_retention=logs.RetentionDays.ONE_MONTH,
            description="Snag API: /api/me, /api/answer/generate (SSE), /api/embed — subscription-gated, stateless",
        )
        # read_write: generate/embed atomically increment USAGE#<YYYY-MM>.
        table.grant_read_write_data(snag_api)
        # Provider keys are read from SSM at runtime (main.py), not via the
        # function environment, so they stay out of `aws lambda get-function`.
        # L1 CfnParameter has no grant helper, so grant GetParameter per key.
        snag_api.role.add_to_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter"],
            resources=[
                f"arn:aws:ssm:{self.region}:{self.account}:parameter/snag/anthropic_api_key",
                f"arn:aws:ssm:{self.region}:{self.account}:parameter/snag/openai_api_key",
            ],
        ))

        paddle_webhook = _lambda.Function(
            self, "SnagPaddleWebhookFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="main.handler",
            code=_lambda.Code.from_asset(os.path.join(LAMBDA_DIR, "snag_paddle_webhook")),
            environment={"SNAG_TABLE": table.table_name},
            architecture=_lambda.Architecture.ARM_64,
            memory_size=128,
            timeout=Duration.seconds(15),
            log_retention=logs.RetentionDays.ONE_MONTH,
            description="Snag Paddle webhook: HMAC-verified; subscription events -> SUBSCRIPTION item (idempotent, TTL'd)",
        )
        table.grant_read_write_data(paddle_webhook)
        # HMAC secret is read from SSM at runtime (see main.py), not via the env.
        # L1 CfnParameter has no grant helper, so grant GetParameter explicitly.
        paddle_webhook.role.add_to_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter/snag/paddle_webhook_secret"],
        ))

        # --- API Gateway: two HTTP APIs ------------------------------------
        # SnagApi (JWT-gated): the Cognito JWT authorizer guards the catch-all
        # route -> snag-api. The extension calls /api/me, /api/answer/generate,
        # /api/embed here.
        # SnagWebhookApi (unauthenticated): catch-all -> snag-paddle-webhook.
        # Paddle signs the request body with HMAC (verified in-Lambda), so this
        # API must not require a JWT. In this CDK version a single API's default
        # authorizer applies to *every* route (no per-route "none"), so the two
        # auth models live on two small, cheap HTTP APIs.
        authorizer = apigwv2_auth.HttpUserPoolAuthorizer(
            id="SnagCognitoAuthorizer",
            pool=user_pool,
            user_pool_clients=[app_client],
        )

        api = apigwv2.HttpApi(
            self, "SnagApi",
            default_authorizer=authorizer,
            default_integration=apigwv2_int.HttpLambdaIntegration("SnagApiInteg", snag_api),
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
                allow_headers=["Authorization", "Content-Type"],
            ),
        )

        webhook_api = apigwv2.HttpApi(
            self, "SnagWebhookApi",
            default_integration=apigwv2_int.HttpLambdaIntegration("SnagWebhookInteg", paddle_webhook),
        )

        # --- Outputs -------------------------------------------------------
        CfnOutput(self, "ApiUrl", value=api.api_endpoint, description="JWT-gated HTTP API base URL (extension)")
        CfnOutput(self, "WebhookApiUrl", value=webhook_api.api_endpoint, description="Paddle webhook URL (unauthenticated, HMAC-verified)")
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=app_client.user_pool_client_id)
        CfnOutput(self, "BillingTable", value=table.table_name)
