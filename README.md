# Admin Dashboard

This project provides an Express server for managing companies and related data.

## Environment variables

All configuration is loaded from environment variables. Copy
[`\.env.example`](./\.env.example) to `\.env` and update the values for your
environment. The main variables are:

- `MONGODB_URI` – MongoDB connection string.
- `PORT` and `NODE_ENV` – server port and Node environment.
- `DEVELOPER_ALERT_PHONE_NUMBER` and `DEVELOPER_ALERT_EMAIL` – where alert
  notifications are sent.
- Optional alert integrations: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_PHONE_NUMBER`, `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
- Google integrations: `GOOGLE_APPLICATION_CREDENTIALS` for Text‑to‑Speech and
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
  `APP_BASE_URL` for Calendar OAuth.

Ensure MongoDB is reachable at the URI you provide and that any Google
credentials exist before starting the server.

## Running the server

```bash
npm start
```

The server expects a running MongoDB instance configured via `MONGODB_URI`.
Google and alert integrations also rely on the credentials described above.

### Running the daily cron job

The cron task defined in `scripts/dailyLearning.js` parses conversation logs and
updates the shared Q&A. Start it in a separate process with:

```bash
npm install
node scripts/dailyLearning.js
```

### Seeding default agent prompts

Run the `scripts/seedAgentPrompts.js` script once to populate the default
prompt variants used by the voice agent:

```bash
node scripts/seedAgentPrompts.js
```

## Running tests

Tests use Jest. Run all tests with:

```bash
npm test
```

The test suite is self contained and mocks external services such as MongoDB and
Google APIs.

`npm test` executes the test suite located in the `tests` directory.

## Testing authenticated endpoints

Some API routes require a valid JWT which is stored in a secure `httpOnly`
cookie. Obtain this cookie by registering or logging in first and then include
the cookie with subsequent requests.

Register a new user:

```bash
curl -X POST https://clientsvia-backend.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -c cookie.txt \
  -d '{"email":"admin@yourdomain.com","password":"YourStrongPassword"}'
```

Login if the user already exists:

```bash
curl -X POST https://clientsvia-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookie.txt \
  -d '{"email":"admin@yourdomain.com","password":"YourStrongPassword"}'
```

Use the stored cookie to access protected routes:

```bash
curl -b cookie.txt https://clientsvia-backend.onrender.com/api/company/685fbe32f2dd80e7e46ba663
```

## Company Q&A API

Use `/api/company/:companyId/qna` to manage a company's custom Q&A.

- `GET /api/company/:companyId/qna` – list entries for the company.
- `POST /api/company/:companyId/qna` – add a new `{ question, answer }`.
- `PUT /api/company/:companyId/qna/:id` – update an entry.
- `DELETE /api/company/:companyId/qna/:id` – remove an entry.

### Suggestions API

Call `/api/suggestions` to review conversation snippets detected by the daily
learning job.

- `POST /api/suggestions` – create a suggestion (used by automated scripts).
- `GET /api/suggestions` – list all suggestions.
- `PATCH /api/suggestions/:id` – update status to `approved` or `rejected`.

Approving a `best-practice` suggestion automatically creates a matching
knowledge entry.


## Database Indexes

A compound index on `category` and `question` improves performance when querying knowledge entries. On existing deployments run:

```bash
node scripts/createKnowledgeIndex.js
# or from a Mongo shell
# db.collection('knowledgeentries').createIndex({ category: 1, question: 1 })
```

<!-- Force redeploy - 2025-06-29 16:00 EDT -->\nSee docs/scheduling_keywords.md for troubleshooting scheduling questions.
