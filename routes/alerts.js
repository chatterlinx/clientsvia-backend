const express = require('express');
const twilio = require('twilio');
const nodemailer = require('nodemailer');
const Alert = require('../models/Alert'); // Ensure path is correct

const router = express.Router();

/**
 * Sends an SMS notification using Twilio.
 */
async function sendSmsNotification(alert) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, DEVELOPER_ALERT_PHONE_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !DEVELOPER_ALERT_PHONE_NUMBER) {
        console.error('Twilio credentials or developer phone number are not fully configured in .env. SMS not sent.');
        return 'SMS not sent due to missing configuration.';
    }
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    try {
        const message = await client.messages.create({
            body: `AI Agent Malfunction Alert!\nCompany ID: ${alert.companyId}\nError: ${alert.error}`,
            from: TWILIO_PHONE_NUMBER,
            to: DEVELOPER_ALERT_PHONE_NUMBER
        });
        return `SMS sent successfully with SID: ${message.sid}`;
    } catch (error) {
        console.error('Twilio SMS sending failed:', error.message, error.stack);
        return `SMS sending failed: ${error.message}`;
    }
}

/**
 * Sends an email notification using Nodemailer and Gmail.
 */
async function sendEmailNotification(alert) {
    const { GMAIL_USER, GMAIL_APP_PASSWORD, DEVELOPER_ALERT_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !DEVELOPER_ALERT_EMAIL) {
        console.error('Gmail credentials or developer email are not fully configured in .env. Email not sent.');
        return 'Email not sent due to missing configuration.';
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    const mailOptions = {
        from: `"AI Platform Alerts" <${GMAIL_USER}>`,
        to: DEVELOPER_ALERT_EMAIL,
        subject: `🔴 AI Agent Malfunction Alert for Company: ${alert.companyId}`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h1 style="color: #d9534f;">AI Agent Malfunction Alert</h1>
                <p>A malfunction has been reported by an AI agent. Please review the details below immediately.</p>
                <hr>
                <h3 style="color: #333;">Alert Details:</h3>
                <ul>
                    <li><strong>Company ID:</strong> ${alert.companyId}</li>
                    <li><strong>Timestamp:</strong> ${new Date(alert.timestamp).toLocaleString()}</li>
                    <li><strong>Error Message:</strong>
                        <pre style="background-color: #f5f5f5; padding: 10px; border-radius: 4px;">${alert.error}</pre>
                    </li>
                    <li><strong>Test Alert:</strong> ${alert.test ? 'Yes' : 'No'}</li>
                </ul>
                <hr>
                <p style="font-size: 0.8em; color: #777;">This is an automated notification from your AI Agent Platform.</p>
            </div>`,
    };
    try {
        const info = await transporter.sendMail(mailOptions);
        return `Email sent successfully: ${info.response}`;
    } catch (error) {
        console.error('Nodemailer email sending failed:', error.message, error.stack);
        return `Email sending failed: ${error.message}`;
    }
}

/**
 * POST /api/alerts
 * Receives a new alert, saves it to the database, and triggers notifications.
 */
router.post('/', async (req, res) => {
    try {
        const { companyId, error, timestamp, test } = req.body;
        console.log('POST /api/alerts received:', { companyId, error, timestamp, test });
        if (!companyId || !error) {
            console.warn('POST /api/alerts: Missing required fields');
            return res.status(400).json({ message: 'Missing required fields: companyId, error' });
        }
        let processedTimestamp = timestamp;
        if (!processedTimestamp || isNaN(new Date(processedTimestamp).getTime())) {
            processedTimestamp = new Date();
        } else {
            processedTimestamp = new Date(processedTimestamp);
        }
        const newAlert = new Alert({ companyId, error, timestamp: processedTimestamp, test: test || false });
        await newAlert.save();
        console.log('POST /api/alerts: Alert saved:', newAlert);
        Promise.allSettled([
            sendSmsNotification(newAlert),
            sendEmailNotification(newAlert)
        ]).then(results => {
            results.forEach((result, index) => {
                const type = index === 0 ? 'SMS' : 'Email';
                if (result.status === 'fulfilled') {
                    console.log(`POST /api/alerts: ${type} Notification Status:`, result.value);
                } else {
                    console.error(`POST /api/alerts: ${type} Notification Promise Rejected:`, result.reason);
                }
            });
        });
        res.status(201).json({ message: 'Alert received and processing started.', alert: newAlert });
    } catch (err) {
        console.error('Error in POST /api/alerts:', err.message, err.stack);
        res.status(500).json({ message: 'Server error while saving alert.', error: err.message });
    }
});

/**
 * GET /api/alerts
 * Fetches all alerts from the database, sorted by most recent.
 */
router.get('/', async (req, res) => {
    try {
        console.log('GET /api/alerts: Fetching alerts');
        const alerts = await Alert.find().sort({ timestamp: -1 }).limit(100);
        console.log('GET /api/alerts: Fetched', alerts.length, 'alerts');
        res.json(alerts);
    } catch (err) {
        console.error('Error in GET /api/alerts:', err.message, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Server error while fetching alerts.', error: err.message });
        }
    }
});

/**
 * DELETE /api/alerts/test
 * Deletes all test alerts from the database.
 */
router.delete('/test', async (req, res) => {
    try {
        console.log('DELETE /api/alerts/test: Deleting test alerts');
        const result = await Alert.deleteMany({ test: true });
        console.log('DELETE /api/alerts/test: Deleted', result.deletedCount, 'test alerts');
        res.json({ message: 'Test alerts deleted.', deletedCount: result.deletedCount });
    } catch (err) {
        console.error('Error in DELETE /api/alerts/test:', err.message, err.stack);
        res.status(500).json({ message: 'Server error while deleting test alerts.', error: err.message });
    }
});

module.exports = router;
