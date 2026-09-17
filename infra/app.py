#!/usr/bin/env python
import aws_cdk as cdk

from snag_infra.stack import SnagStack

app = cdk.App()
SnagStack(
    app,
    "SnagStack",
    description="Snag serverless backend: Cognito auth, usage-counter table, Bedrock-backed embed API. Free product, no billing.",
)
app.synth()
