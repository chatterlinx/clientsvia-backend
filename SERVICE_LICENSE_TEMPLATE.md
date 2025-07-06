# Service Licensing Guidelines

This repository contains code for a web application. If you plan to use this code
as part of a hosted service (SaaS), consider the following licensing approach:

1. **Keep the platform code private** – retain all rights and do not distribute the
   server-side code. A copyright notice at the top level is sufficient.
2. **Client SDKs or widgets** – if you release any SDKs to help customers integrate
   with your service, license them permissively (MIT or Apache‑2.0) or provide a
   proprietary EULA.
3. **Service agreements** – your customers interact with the service via
   HTTPS/Twilio numbers. Use a Terms of Service or Master Service Agreement that
   includes:
   - "AS IS" warranty disclaimer
   - Limitation of liability (for example, capped at the last 12 months of fees)
   - Force‑majeure clause
   - Optional indemnification cap
4. **Trademark policy** – protect your brand to prevent confusion with similar
   offerings.
5. **Check third‑party licenses** – verify that dependencies (e.g. Twilio,
   OpenAI) are compatible with your chosen license and usage.
6. **Consider cyber‑liability insurance** – covers scenarios your contracts
   cannot fully address.

This document is a template and does not constitute legal advice. Consult a
qualified attorney to tailor these guidelines to your specific situation.
