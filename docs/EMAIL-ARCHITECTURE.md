# ClientsVia Email Architecture

## Overview
ClientsVia uses **two separate email systems** for different purposes, ensuring clean separation between internal operations and customer-facing communications.

---

## 1. Admin/Developer Email System

### Technology Stack
- **Provider**: Gmail (via Nodemailer)
- **Email Address**: `clientsvia@gmail.com`
- **Implementation**: `clients/emailClient.js`

### Configuration
```env
GMAIL_USER=clientsvia@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### Use Cases
✅ **System Alerts**
- Platform health check failures
- Critical errors requiring immediate attention
- Database connection issues
- Redis cache failures

✅ **Developer Notifications**
- SMS test command confirmations (`TEST`, `PING`)
- Webhook connectivity tests
- Deployment notifications
- Background job failures

✅ **Internal Admin Notifications**
- User registration alerts
- Security events (failed logins, suspicious activity)
- Data purge confirmations
- Backup completion status

### Why Gmail for Admin?
- ✅ **Free**: No per-email costs
- ✅ **Simple**: Direct SMTP, no complex API
- ✅ **Fast Setup**: App passwords, no domain verification
- ✅ **Reliable**: 99.9% uptime
- ✅ **Direct Control**: No third-party dashboard needed

### Limitations
- **500 emails/day** Gmail sending limit (acceptable for admin use)
- **Not for customer-facing emails** (no custom branding, sender reputation)

---

## 2. Client/Customer Email System (Future)

### Technology Stack
- **Provider**: Twilio SendGrid
- **Sender Domains**: Per-company custom domains
- **Implementation**: TBD (will integrate via SendGrid API)

### Configuration (Future)
```env
SENDGRID_API_KEY=SG.xxxx
SENDGRID_TEMPLATE_ID_APPOINTMENT=d-xxxx
SENDGRID_TEMPLATE_ID_INVOICE=d-xxxx
```

### Use Cases (Planned)
📧 **Customer Communications**
- Appointment confirmations
- Appointment reminders (24hr, 1hr before)
- Service completion notifications
- Invoice delivery

📧 **Transactional Emails**
- Password reset links
- Account verification
- Payment receipts
- Booking confirmations

📧 **Marketing (Optional per Company)**
- Newsletters
- Promotional offers
- Seasonal reminders (e.g., HVAC maintenance)
- Customer satisfaction surveys

### Why SendGrid for Customers?
- ✅ **Custom Domains**: Emails from `info@royalplumbing.com` instead of `clientsvia@gmail.com`
- ✅ **Deliverability**: Enterprise-grade sender reputation
- ✅ **Analytics**: Open rates, click tracking, bounce management
- ✅ **Templates**: Branded, professional designs per company
- ✅ **Compliance**: Unsubscribe management, GDPR tools
- ✅ **Scale**: Millions of emails/month if needed

### Multi-Tenant Design
Each company will have:
- **Custom sender domain** (verified via DNS)
- **Branded email templates** (logo, colors, footer)
- **Separate sending quota** (not shared across companies)
- **Per-company analytics** (isolated metrics)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ClientsVia Platform                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────┐         ┌───────────────────────┐      │
│  │  Admin/Developer      │         │  Client/Customer      │      │
│  │  Notifications        │         │  Communications       │      │
│  ├───────────────────────┤         ├───────────────────────┤      │
│  │                       │         │                       │      │
│  │  Gmail (Nodemailer)   │         │  Twilio SendGrid      │      │
│  │  clientsvia@gmail.com │         │  (Future)             │      │
│  │                       │         │                       │      │
│  │  Use Cases:           │         │  Use Cases:           │      │
│  │  • System alerts      │         │  • Appointment emails │      │
│  │  • Health checks      │         │  • Invoices           │      │
│  │  • SMS test confirms  │         │  • Reminders          │      │
│  │  • Debug logs         │         │  • Marketing          │      │
│  │                       │         │                       │      │
│  │  Limit: 500/day      │         │  Limit: Unlimited     │      │
│  │  Cost: FREE           │         │  Cost: Per-email      │      │
│  │                       │         │                       │      │
│  └───────────────────────┘         └───────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Files

### Admin Email System (Current)
- **Client**: `clients/emailClient.js` (Gmail/Nodemailer)
- **Usage**: `routes/v2twilio.js` (SMS test notifications)
- **Usage**: `services/AdminNotificationService.js` (alerts)
- **Usage**: `routes/admin/adminNotifications.js` (health checks)

### Customer Email System (Future)
- **Client**: `clients/sendGridClient.js` (TBD)
- **Service**: `services/CustomerEmailService.js` (TBD)
- **Templates**: `models/EmailTemplate.js` (TBD)

---

## Migration Plan (Future)

### Phase 1: Admin System Only (Current)
- ✅ Gmail configured for admin notifications
- ✅ SMS test confirmations working
- ✅ Health check alerts functional

### Phase 2: Customer Email MVP (Future)
- 📋 Integrate SendGrid API
- 📋 Create email template system
- 📋 Build appointment confirmation emails
- 📋 Add per-company sender domain verification

### Phase 3: Full Email Suite (Future)
- 📋 Marketing email builder
- 📋 Email analytics dashboard
- 📋 A/B testing for email content
- 📋 Automated email sequences

---

## Best Practices

### Admin Emails
1. **Use sparingly** - Only for critical notifications
2. **Keep it technical** - These are for developers, not end-users
3. **Include context** - Full error messages, stack traces, timestamps
4. **Test regularly** - Use SMS "TEST" command to verify delivery

### Customer Emails (Future)
1. **Brand consistency** - Use company logo, colors, voice
2. **Mobile-first** - 70% of emails opened on mobile
3. **Clear CTA** - One primary action per email
4. **Unsubscribe link** - Legal requirement, good practice
5. **Test deliverability** - Monitor bounce rates, spam scores

---

## Environment Variables

### Production (Render)
```env
# Admin Email (Gmail)
GMAIL_USER=clientsvia@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Customer Email (Future)
# SENDGRID_API_KEY=SG.xxxx
# SENDGRID_FROM_EMAIL=noreply@clientsvia.ai
# SENDGRID_FROM_NAME=ClientsVia Platform
```

### Development (Local)
```env
# Admin Email (Test Mode)
EMAIL_TEST_MODE=true
GMAIL_USER=clientsvia@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

---

## Testing

### Admin Email Testing
```bash
# Via SMS (Production)
Send "TEST" to Twilio number → Receives email confirmation

# Via API (Dev)
curl -X POST http://localhost:10000/api/admin/notifications/test-sms \
  -H "Content-Type: application/json" \
  -d '{"recipientPhone":"+15551234567","recipientName":"Test User"}'
```

### Customer Email Testing (Future)
```bash
# Send test appointment email
POST /api/companies/:companyId/emails/test
{
  "type": "appointment_confirmation",
  "recipientEmail": "customer@example.com",
  "appointmentData": { ... }
}
```

---

## Security Considerations

### Gmail App Password
- ✅ **Never commit** to git
- ✅ **Store in Render** environment variables
- ✅ **Rotate annually** as best practice
- ✅ **Use app password**, not account password

### SendGrid API Key (Future)
- ✅ **Least privilege** - Only "Mail Send" permission
- ✅ **Per-environment keys** - Separate dev/staging/prod
- ✅ **Monitor usage** - Set up alerts for unusual spikes
- ✅ **IP allowlist** - Restrict to Render IP ranges

---

## Cost Analysis

### Gmail (Admin)
- **Cost**: $0/month
- **Limit**: 500 emails/day
- **Expected Usage**: ~50 emails/day (alerts, tests)
- **Risk**: None (well under limit)

### SendGrid (Customer - Future)
- **Cost**: ~$0.0006 per email (Essentials plan)
- **Example**: 10,000 customer emails/month = $6/month
- **Scaling**: Up to 100k emails/month on same plan
- **ROI**: Customer retention, appointment confirmations = high value

---

## Troubleshooting

### Gmail Not Sending
1. Check `GMAIL_USER` and `GMAIL_APP_PASSWORD` in Render
2. Verify app password is valid (16 characters, no spaces)
3. Check Gmail "Recent security events" for blocks
4. Review logs: `grep "Email" /var/log/app.log`

### SendGrid Issues (Future)
1. Verify API key permissions
2. Check sender domain DNS records
3. Review SendGrid activity log
4. Monitor bounce/spam reports

---

## Related Documentation
- `clients/emailClient.js` - Implementation details
- `routes/v2twilio.js` - SMS test notification usage
- `services/AdminNotificationService.js` - Alert system
- `docs/NOTIFICATION-CENTER-ARCHITECTURE.md` - Overall notification strategy

---

**Last Updated**: October 21, 2025  
**Owner**: Platform Team  
**Status**: Phase 1 Complete (Admin Email Only)

