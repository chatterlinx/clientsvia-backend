# Security Specification for clientsVia.ai Portal

This document outlines the baseline security architecture for the multi-tenant client portal.

## Stack Overview

- **Frontend**: Next.js with server-side rendering.
- **Backend**: Express.js API protected by JWT and role-based access control (RBAC).
- **Database**: MongoDB Atlas with IP whitelisting and SSL only connections.
- **Cache/Session Store**: Redis secured by password and IP restriction.
- **Storage**: Object storage (S3/GCS) for uploads; files stored with random names.

## Authentication

- Passwords hashed using bcrypt with unique salt per user.
- JWTs stored in `httpOnly` and `sameSite=strict` cookies.
- Email verification required on signup.
- Mandatory two-factor authentication (TOTP or SMS) for admin and staff roles.

## Authorization

- Role-based access: `Admin`, `Manager`, `Staff`, `ViewOnly`.
- Each API route validates JWT and role before processing.
- Tenant isolation enforced via company ID in JWT payload.

## API Security Practices

- All routes behind rate limiting (100 requests per minute by default).
- `helmet` sets `CSP`, `HSTS`, `X-Frame-Options`, and other headers.
- HTTPS enforced in production (TLS 1.2+). Server refuses non-TLS traffic.
- Inputs validated server-side; no trust in client data.

## File Uploads

- Only image and audio types are accepted.
- Uploaded files are virus scanned before storage.
- Public links are time-limited and do not expose bucket paths.

## Logging and Monitoring

- All logins, failed logins, deletions, and data exports are logged to a write-only collection.
- Unusual activity (excessive logins, IP changes) triggers webhook alerts to SIEM.

## Deployment & CI/CD

- Deploy to Vercel or Render using environment variables only.
- `npm audit` runs on every build; critical issues fail the pipeline.
- Weekly automated vulnerability scans (OWASP ZAP or similar).
- Database and Redis access restricted to backend IPs.

## Environment Variables

Refer to `portal/.env.example` for required configuration values:

- `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`
- `TLS_KEY_PATH`, `TLS_CERT_PATH` for HTTPS in production
- Cloud storage and OAuth credentials

No secrets should ever be committed to the repository.
