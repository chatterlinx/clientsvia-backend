# 🕒 Workflow Scheduling & Script Integration Guide

## Overview
Your platform now has powerful scheduling capabilities that tie workflows to scripts, time-based triggers, and recurring automations - similar to HighLevel's automation features.

## 🚀 Quick Start Examples

### 1. Schedule a One-Time Workflow
```javascript
// Schedule a workflow to run every day at 9 AM
POST /api/scheduler/schedule
{
  "workflowId": "workflow_id_here",
  "schedule": {
    "cronExpression": "0 9 * * *",
    "timezone": "America/New_York",
    "enabled": true,
    "description": "Daily lead follow-up"
  },
  "context": {
    "maxContacts": 10,
    "priority": "normal"
  }
}
```

### 2. Schedule Follow-Up Workflows
```javascript
// Schedule a follow-up 2 hours after a call
POST /api/scheduler/follow-up
{
  "workflowId": "follow_up_workflow_id",
  "delayMinutes": 120,
  "context": {
    "contactId": "contact_id",
    "originalEvent": "call_completed"
  }
}
```

### 3. Create Recurring Workflows
```javascript
// Create a weekly lead nurturing sequence
POST /api/scheduler/recurring
{
  "name": "Weekly Lead Nurturing",
  "workflowTemplate": {
    "steps": [
      {
        "stepId": "send_email",
        "name": "Send Weekly Newsletter",
        "actionId": "email_action_id"
      }
    ]
  },
  "schedule": {
    "frequency": "weekly",
    "time": "10:00",
    "dayOfWeek": 1,
    "timezone": "America/New_York"
  },
  "targetCriteria": {
    "status": "qualified_lead"
  }
}
```

## 📅 Cron Expression Examples

| Description | Cron Expression |
|-------------|-----------------|
| Every day at 9 AM | `0 9 * * *` |
| Every Monday at 8:30 AM | `30 8 * * 1` |
| Every hour | `0 * * * *` |
| Every 15 minutes | `*/15 * * * *` |
| First day of month at 9 AM | `0 9 1 * *` |
| Every weekday at 5 PM | `0 17 * * 1-5` |

## 🔧 Script Integration

### Custom Node.js Scripts
Create scripts that execute as part of workflows:

```javascript
// scripts/customFollowUp.js
const context = JSON.parse(process.env.WORKFLOW_CONTEXT || '{}');
const parameters = JSON.parse(process.env.SCRIPT_PARAMETERS || '{}');

// Your custom logic here
console.log('Executing custom follow-up for:', context.contact?.name);

// Connect to database, send emails, update CRM, etc.
```

### Webhook Integration
Execute webhooks as workflow actions:
```javascript
{
  "type": "webhook",
  "config": {
    "url": "https://your-webhook-url.com/endpoint",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer your-token"
    },
    "body": {
      "contact": "{{contact}}",
      "trigger": "{{trigger}}"
    }
  }
}
```

## 🎯 Real-World Use Cases

### 1. New Lead Welcome Sequence
```
Trigger: Contact Created
Schedule: Immediate + follow-ups at 1hr, 24hr, 3 days
Actions: 
- Send welcome SMS immediately
- Send email with company info after 1 hour  
- Call attempt after 24 hours
- Final follow-up email after 3 days
```

### 2. Service Request Follow-Up
```
Trigger: Service Request Created
Schedule: 30 minutes + daily reminders
Actions:
- Send confirmation email after 30 minutes
- Daily SMS reminders until appointment scheduled
- Send appointment details 24 hours before
```

### 3. Abandoned Lead Re-engagement
```
Trigger: Daily cron job
Schedule: Every day at 10 AM
Target: Contacts with no activity for 7+ days
Actions:
- Send re-engagement email
- Tag as "needs_attention"
- Create task for sales team
```

## 📊 Built-in Recurring Jobs

The system automatically runs these jobs:

### Daily (9 AM)
- **Follow-up Check**: Finds contacts needing follow-up
- **Lead Nurturing**: Sends scheduled communications
- **Service Reminders**: Appointment and service reminders

### Weekly (Monday 8 AM)  
- **Analytics Report**: Performance metrics and insights
- **Lead Scoring Update**: Recalculate lead scores
- **Cleanup Tasks**: Archive old data

### Monthly (1st day, 9 AM)
- **Performance Review**: Monthly business metrics
- **Workflow Optimization**: Suggest improvements
- **Data Archival**: Move old records to archive

## 🔄 Integration with Existing Features

### Twilio Call Integration
Workflows automatically trigger on:
- `call_received` - Every incoming call
- `call_completed` - When call ends
- `service_request_created` - When service is requested
- `emergency_service_request` - For urgent calls

### Contact Management
Workflows can:
- Update contact status and tags
- Add notes and interactions
- Create tasks and reminders
- Schedule appointments

### Service Scheduling
Workflows integrate with:
- Appointment booking system
- Service type detection
- Availability checking
- Calendar management

## 🛠️ API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/scheduler/schedule` | Schedule one-time workflow |
| `POST /api/scheduler/follow-up` | Schedule delayed workflow |
| `POST /api/scheduler/recurring` | Create recurring workflow |
| `GET /api/scheduler/scheduled` | List all scheduled workflows |
| `DELETE /api/scheduler/cancel/:jobId` | Cancel scheduled workflow |
| `GET /api/scheduler/cron-examples` | Get cron expression help |

## 🎛️ Dashboard Access

Access the workflow scheduling dashboard at:
```
https://clientsvia-backend.onrender.com/workflow-dashboard.html
```

Features:
- Visual workflow builder
- Schedule configuration
- Real-time monitoring
- Performance analytics
- Script management

## 🔍 Monitoring & Analytics

Track workflow performance through:
- Execution success/failure rates
- Average execution time
- Error logs and debugging
- Contact engagement metrics
- ROI tracking per workflow

## 🚨 Best Practices

1. **Start Simple**: Begin with basic time-based triggers
2. **Test Thoroughly**: Use test mode before production
3. **Monitor Performance**: Check execution logs regularly
4. **Optimize Timing**: Avoid overwhelming contacts
5. **Backup Important Workflows**: Export configurations
6. **Use Conditions**: Add smart filtering to workflows
7. **Handle Errors**: Always include error handling actions

## 🔧 Troubleshooting

### Common Issues:
- **Cron not triggering**: Check timezone settings
- **Script failures**: Verify environment variables
- **Webhook timeouts**: Increase timeout settings
- **Too many executions**: Add rate limiting

### Debug Commands:
```bash
# View scheduled jobs
GET /api/scheduler/scheduled

# Test cron expression  
POST /api/scheduler/test-schedule

# View execution logs in Render dashboard
```

Your workflow automation platform is now as powerful as HighLevel with scheduling, scripts, and automated sequences! 🎉
