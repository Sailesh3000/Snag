"""Shared test setup: hermetic AWS credentials for every test.

Lambda modules under test construct real boto3 clients/resources at import
time (module scope). Without explicit static credentials, boto3 falls
through the default credential chain to whatever the local machine's AWS
CLI config happens to have (a profile, an SSO/login session, ...), which
makes tests depend on and can even error out on the developer's local AWS
setup (e.g. a `login_session`-based profile needs `botocore[crt]`, which
these tests have no reason to require). Dummy env credentials short-circuit
the chain at the first (environment-variable) provider, every time,
regardless of what's in ~/.aws/config.
"""
import pytest


@pytest.fixture(autouse=True)
def _hermetic_aws_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
