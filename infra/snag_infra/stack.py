"""Snag serverless backend — CDK stack.

Thin proxy, not a data store:
  - Cognito User Pool + public OAuth client (Hosted UI, PKCE auth-code flow)
  - One tiny DynamoDB table: usage counters only (abuse/cost protection on
    Bedrock embed calls) — nothing else
  - API Gateway HTTP API with a built-in Cognito JWT authorizer on the
    $default route
  - One Lambda: snag-api (JWT-gated)

Free product, no billing: every signed-in user has full access. LLM
generation is BYOK (the extension calls Anthropic/OpenAI/Groq/Ollama
directly with the user's own key) and embeddings use Bedrock (IAM-only,
no secret) — this backend holds no external API keys at all.

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

        # The extension's OAuth redirect URI — chrome.identity.getRedirectURL()
        # always returns https://<extension-id>.chromiumapp.org/<path>, and
        # manifest.json pins a "key" field, so the ID (and this URL) is the
        # SAME deterministic value whether the extension is loaded unpacked
        # (dev) or installed from the Chrome Web Store — one callback URL,
        # no dev/prod split. Kept as an overridable parameter only in case
        # the pinned key/ID ever changes.
        callback_url = CfnParameter(
            self, "ExtensionCallbackUrl",
            type="String",
            default="https://jobacpbllhlmlidhnhoaobcdidjfknif.chromiumapp.org/oauth-callback",
            description="Extension OAuth redirect URI (chromiumapp.org, derived from the pinned manifest key).",
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

        # Cognito-managed Hosted UI domain — needed for
        # chrome.identity.launchWebAuthFlow to have somewhere to redirect to.
        # Prefix must be globally unique across all AWS accounts in this
        # partition; embedding the account ID makes collision effectively
        # impossible without needing a custom domain.
        user_pool_domain = user_pool.add_domain(
            "SnagUserPoolDomain",
            cognito_domain=cognito.CognitoDomainOptions(domain_prefix=f"snag-{self.account}"),
        )

        # --- DynamoDB (tiny, single-purpose) -------------------------------
        # Only item type: USAGE#<YYYY-MM> per-user counters, atomically
        # incremented to cap daily /api/embed calls (Bedrock cost protection,
        # not billing — the product is free). No TTL needed since usage
        # items are small and naturally bounded (one per user per month).
        table = ddb.Table(
            self, "SnagBillingTable",
            partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,  # on-demand
            removal_policy=RemovalPolicy.DESTROY,
        )

        # --- Lambda ----------------------------------------------------------
        snag_api = _lambda.Function(
            self, "SnagApiFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="main.handler",
            code=_lambda.Code.from_asset(os.path.join(LAMBDA_DIR, "snag_api")),
            environment={"SNAG_TABLE": table.table_name},
            architecture=_lambda.Architecture.ARM_64,
            memory_size=256,
            timeout=Duration.seconds(15),
            log_retention=logs.RetentionDays.ONE_MONTH,
            description="Snag API: /api/me (identity check), /api/embed (Bedrock Titan) — free, stateless",
        )
        # read_write: embed atomically increments USAGE#<YYYY-MM>.
        table.grant_read_write_data(snag_api)
        # Bedrock is IAM-only (no API key/secret at all) — LLM generation is
        # BYOK from the extension, so this function holds no provider key.
        snag_api.role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=[
                f"arn:aws:bedrock:{self.region}::foundation-model/amazon.titan-embed-text-v2:0",
            ],
        ))

        # --- API Gateway: HTTP API ------------------------------------------
        # The Cognito JWT authorizer guards the catch-all route -> snag-api.
        # The extension calls /api/me and /api/embed here; LLM generation is
        # BYOK and never touches this backend.
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

        # --- Outputs -------------------------------------------------------
        CfnOutput(self, "ApiUrl", value=api.api_endpoint, description="JWT-gated HTTP API base URL (extension)")
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "CognitoDomain", value=f"https://{user_pool_domain.domain_name}.auth.{self.region}.amazoncognito.com", description="Cognito Hosted UI domain")
        CfnOutput(self, "UserPoolClientId", value=app_client.user_pool_client_id)
        CfnOutput(self, "BillingTable", value=table.table_name)
