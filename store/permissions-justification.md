# Permission justifications (CWS disclosure answers)

## Permissions

**activeTab**
Used when you click the Snag icon to interact with the current page:
detecting application-form fields and writing the answers you approve into
the form.

**scripting**
Used to inject Snag's sidebar and field-detection code into the page you
clicked on (same action as activeTab).

**storage**
Stores your profile, answer history, settings, and sign-in session locally
in this browser. Nothing here is uploaded to our servers.

**unlimitedStorage**
Answer history and imported resumes are stored locally on your device; the
10 MB default quota would limit long-term local storage of your own data.

**alarms**
Periodically refreshes your sign-in session and re-checks subscription
status so the sidebar stays accurate.

**identity**
Opens your browser's standard OAuth window to sign in with Amazon Cognito
(email sign-in). Used only for the sign-in flow.

## Host permissions

**https://*.amazoncognito.com/\***
Sign-in flow: opening the Cognito Hosted UI and exchanging the
authorization code for your session.

**https://*.execute-api.us-east-1.amazonaws.com/\***
Snag's own backend API: checking subscription status, generating answers,
and generating local embeddings.

## Optional permissions (granted only if you enable "Local model mode" in Settings)

**https://api.anthropic.com/\***, **https://api.openai.com/\***,
**https://api.groq.com/\***
Only when you opt into local model mode: call the LLM provider you choose
directly with your own API key, instead of through Snag's subscription.
Off by default; never requested for the subscription flow.

**http://127.0.0.1/\***, **http://localhost/\***
Only when you opt into local model mode: talk to a local model server
(e.g. Ollama or a local backend) running on your own machine.

## Sensitive API usage questions

- We do not use `webRequest`, `declarativeNetRequest`, or
  `nativeMessaging`.
- We do not access data from websites other than the page you choose to use
  Snag on (activeTab).
- We do not modify browser settings.
