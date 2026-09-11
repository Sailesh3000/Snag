# Snag Privacy Policy

*Effective date: [fill in at launch]. This draft must be hosted at a public
URL before CWS submission.*

## Who we are

Snag (operated by [your name / business name]) is a Chrome extension that
helps you answer questions on job application forms. This policy explains
what data the extension handles and where it goes.

## Data that stays on your device

The following data is stored **only in your browser** (local IndexedDB on
your device). It is **never transmitted to or stored on Snag's servers**:

- Your profile fields (name, email, phone, links, default company/role)
- Resumes you import and their extracted text
- Your answer history (questions, approved answers, and local embeddings
  used only to match your own past answers)
- Your AI provider settings, including your API key — used only to call
  your chosen provider directly from your browser
- Your local settings

Consequences: Snag has no cross-device sync, and clearing your browser's
browsing data removes this data. We cannot see, retrieve, or delete it —
delete it by clearing your browser data.

## Data sent to our servers

- **Account (via Amazon Cognito):** your email address is used for account
  creation, sign-in, and subscription identification. Cognito is
  responsible for handling this data under its own privacy terms.
- **Answer generation (bring your own key):** generating an answer never
  touches our backend at all. Your profile data, past answers, and the
  question text are combined into a prompt on your own device and sent
  directly from your browser to the AI provider you configured (Anthropic,
  OpenAI, Groq, or a local Ollama model), using your own API key. We never
  see this prompt or its response.
- **Transient embedding requests:** when you save an approved answer, its
  question text is sent to our backend to generate a similarity vector (via
  Amazon Bedrock), which is returned to you and stored locally on your
  device — the question text itself is **processed and discarded, not
  stored** server-side.
- **Billing (via Paddle):** payments are handled by Paddle, a Merchant of
  Record. Paddle receives payment and transaction details under its own
  privacy policy; Snag learns only your subscription status (active or not,
  period end date) via Paddle webhooks.

## What we do not collect

No analytics, no advertising, no third-party trackers, no telemetry, no
server-side storage of your profile, resumes, answers, or generated answer
text.

## Retention and deletion

Server-side we retain only: your account record (Cognito), subscription
status, and usage counters (DynamoDB). Deleting your account via
[contact email] removes these records. All device-local data is under your
control via your browser's data controls.

## Contact

Questions or requests: [your contact email].
