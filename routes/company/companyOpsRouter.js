/**
 * ============================================================================
 * COMPANYOPS CONSOLE - MASTER ROUTER
 * ============================================================================
 * 
 * PURPOSE: Mount all CompanyOps Console routes under /api/company/:companyId
 * 
 * STRUCTURE:
 * /api/company/:companyId/contacts         - Contact management
 * /api/company/:companyId/locations        - Location + Access Profiles
 * /api/company/:companyId/appointments     - Appointment management
 * /api/company/:companyId/call-traces      - Call history (read-only)
 * /api/company/:companyId/usage            - Usage & billing stats
 * /api/company/:companyId/customers        - Aggregated customer view
 * /api/company/:companyId/notification-settings - Notification config
 * /api/company/:companyId/settings         - Company settings
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

// Import sub-routers
const contactsRouter = require('./companyOpsContacts');
const locationsRouter = require('./companyOpsLocations');
const appointmentsRouter = require('./companyOpsAppointments');
// TODO: Add these routers as they're built:
// const callTracesRouter = require('./companyOpsCallTraces');
// const usageRouter = require('./companyOpsUsage');
// const customersRouter = require('./companyOpsCustomers');
// const notificationSettingsRouter = require('./companyOpsNotificationSettings');
// const settingsRouter = require('./companyOpsSettings');

// Mount sub-routers
router.use('/contacts', contactsRouter);
router.use('/locations', locationsRouter);
router.use('/appointments', appointmentsRouter);

// TODO: Mount these as they're built:
// router.use('/call-traces', callTracesRouter);
// router.use('/usage', usageRouter);
// router.use('/customers', customersRouter);
// router.use('/notification-settings', notificationSettingsRouter);
// router.use('/settings', settingsRouter);

module.exports = router;

