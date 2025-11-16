/**
 * ============================================================================
 * COMPANYOPS APPOINTMENTS - CRUD ROUTES
 * ============================================================================
 * 
 * PURPOSE: Manage appointments for CompanyOps Console
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET    /api/company/:companyId/appointments
 * - POST   /api/company/:companyId/appointments
 * - GET    /api/company/:companyId/appointments/:appointmentId
 * - PUT    /api/company/:companyId/appointments/:appointmentId
 * - PATCH  /api/company/:companyId/appointments/:appointmentId/status
 * - DELETE /api/company/:companyId/appointments/:appointmentId
 * 
 * MODEL: Appointment (Phase 1)
 * 
 * KEY FEATURES:
 * - Status management (Pending, Confirmed, Completed, Cancelled, No-Show)
 * - Time window selection
 * - Link to Contact, Location, CallTrace
 * - Source tracking (Phone, SMS, Web, Manual)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const Appointment = require('../../models/Appointment');
const V2Contact = require('../../models/v2Contact');
const Location = require('../../models/Location');
const CallTrace = require('../../models/CallTrace');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/appointments
 * ============================================================================
 * Get all appointments for a company
 * 
 * Query params:
 * - status: string (Pending, Confirmed, Completed, Cancelled, No-Show)
 * - trade: string (HVAC, Plumbing, Electrical, etc.)
 * - serviceType: string (repair, maintenance, install, emergency)
 * - contactId: string
 * - locationId: string
 * - dateFrom: ISO date string
 * - dateTo: ISO date string
 * - limit: number (default 100)
 * - offset: number (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      status,
      trade,
      serviceType,
      contactId,
      locationId,
      dateFrom,
      dateTo,
      limit = 100,
      offset = 0
    } = req.query;

    // Build query
    const query = { companyId };

    if (status) query.status = status;
    if (trade) query.trade = trade;
    if (serviceType) query.serviceType = serviceType;
    if (contactId) query.contactId = contactId;
    if (locationId) query.locationId = locationId;

    // Date range filter
    if (dateFrom || dateTo) {
      query.scheduledDate = {};
      if (dateFrom) query.scheduledDate.$gte = dateFrom;
      if (dateTo) query.scheduledDate.$lte = dateTo;
    }

    // Get appointments with populated data
    const appointments = await Appointment.find(query)
      .populate('contactId', 'name primaryPhone email')
      .populate('locationId', 'label addressLine1 city state')
      .sort({ scheduledDate: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count
    const total = await Appointment.countDocuments(query);

    // Add source display names
    const enrichedAppointments = appointments.map(apt => ({
      ...apt,
      contactName: apt.contactId?.name || 'Unknown',
      locationLabel: apt.locationId?.label || 'Unknown Location'
    }));

    res.json({
      ok: true,
      data: enrichedAppointments,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + appointments.length < total
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] GET all failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch appointments'
    });
  }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/appointments
 * ============================================================================
 * Create a new appointment
 * 
 * Body:
 * - contactId: ObjectId (required)
 * - locationId: ObjectId (required)
 * - scheduledDate: ISO date string (required)
 * - timeWindow: string (8-10, 10-12, 12-2, 2-4, etc.) (required)
 * - trade: string
 * - serviceType: string (repair, maintenance, install, emergency)
 * - status: string (default: Pending)
 * - source: string (Phone, SMS, Web, Manual) (default: Manual)
 * - callId: string (optional, if booked via AI)
 * - notesForTech: string
 * - accessNotes: string
 */
router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      contactId,
      locationId,
      scheduledDate,
      timeWindow,
      trade,
      serviceType,
      status,
      source,
      callId,
      notesForTech,
      accessNotes
    } = req.body;

    // Validation
    if (!contactId || !locationId || !scheduledDate || !timeWindow) {
      return res.status(400).json({
        ok: false,
        error: 'Contact, location, scheduled date, and time window are required'
      });
    }

    // Verify contact exists
    const contact = await V2Contact.findOne({
      _id: contactId,
      companyId
    });

    if (!contact) {
      return res.status(404).json({
        ok: false,
        error: 'Contact not found'
      });
    }

    // Verify location exists
    const location = await Location.findOne({
      _id: locationId,
      companyId
    });

    if (!location) {
      return res.status(404).json({
        ok: false,
        error: 'Location not found'
      });
    }

    // Create appointment
    const appointment = await Appointment.create({
      companyId,
      contactId,
      locationId,
      scheduledDate,
      timeWindow,
      trade: trade || '',
      serviceType: serviceType || 'repair',
      status: status || 'Pending',
      source: source || 'Manual',
      callId: callId || null,
      notesForTech: notesForTech || '',
      accessNotes: accessNotes || location.accessProfile?.accessNotes || ''
    });

    // Populate for response
    await appointment.populate('contactId', 'name primaryPhone email');
    await appointment.populate('locationId', 'label addressLine1 city state');

    logger.info('[CompanyOps Appointments] Appointment created', {
      companyId,
      appointmentId: appointment._id,
      scheduledDate,
      timeWindow,
      contactName: contact.name
    });

    res.status(201).json({
      ok: true,
      data: appointment
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] POST failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to create appointment'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/appointments/:appointmentId
 * ============================================================================
 * Get a single appointment with full details
 */
router.get('/:appointmentId', async (req, res) => {
  try {
    const { companyId, appointmentId } = req.params;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      companyId
    })
      .populate('contactId', 'name primaryPhone secondaryPhone email')
      .populate('locationId')
      .lean();

    if (!appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found'
      });
    }

    // If appointment has callId, fetch call details
    let callDetails = null;
    if (appointment.callId) {
      callDetails = await CallTrace.findOne({
        callId: appointment.callId,
        companyId
      })
        .select('callId startedAt durationSeconds currentIntent tierTrace')
        .lean();
    }

    res.json({
      ok: true,
      data: {
        ...appointment,
        callDetails
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] GET one failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      appointmentId: req.params.appointmentId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch appointment'
    });
  }
});

/**
 * ============================================================================
 * PUT /api/company/:companyId/appointments/:appointmentId
 * ============================================================================
 * Update an appointment
 */
router.put('/:appointmentId', async (req, res) => {
  try {
    const { companyId, appointmentId } = req.params;
    const {
      contactId,
      locationId,
      scheduledDate,
      timeWindow,
      trade,
      serviceType,
      status,
      notesForTech,
      accessNotes
    } = req.body;

    // Find existing appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      companyId
    });

    if (!appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found'
      });
    }

    // If contactId changed, verify new contact exists
    if (contactId && contactId !== appointment.contactId?.toString()) {
      const contact = await V2Contact.findOne({
        _id: contactId,
        companyId
      });

      if (!contact) {
        return res.status(404).json({
          ok: false,
          error: 'Contact not found'
        });
      }
      appointment.contactId = contactId;
    }

    // If locationId changed, verify new location exists
    if (locationId && locationId !== appointment.locationId?.toString()) {
      const location = await Location.findOne({
        _id: locationId,
        companyId
      });

      if (!location) {
        return res.status(404).json({
          ok: false,
          error: 'Location not found'
        });
      }
      appointment.locationId = locationId;
    }

    // Update other fields
    if (scheduledDate !== undefined) appointment.scheduledDate = scheduledDate;
    if (timeWindow !== undefined) appointment.timeWindow = timeWindow;
    if (trade !== undefined) appointment.trade = trade;
    if (serviceType !== undefined) appointment.serviceType = serviceType;
    if (status !== undefined) appointment.status = status;
    if (notesForTech !== undefined) appointment.notesForTech = notesForTech;
    if (accessNotes !== undefined) appointment.accessNotes = accessNotes;

    await appointment.save();

    // Populate for response
    await appointment.populate('contactId', 'name primaryPhone email');
    await appointment.populate('locationId', 'label addressLine1 city state');

    logger.info('[CompanyOps Appointments] Appointment updated', {
      companyId,
      appointmentId,
      scheduledDate: appointment.scheduledDate
    });

    res.json({
      ok: true,
      data: appointment
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] PUT failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      appointmentId: req.params.appointmentId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update appointment'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/appointments/:appointmentId/status
 * ============================================================================
 * Update only appointment status (quick status change)
 * 
 * Body:
 * - status: string (Pending, Confirmed, Completed, Cancelled, No-Show)
 */
router.patch('/:appointmentId/status', async (req, res) => {
  try {
    const { companyId, appointmentId } = req.params;
    const { status } = req.body;

    // Validation
    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-Show'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      companyId
    });

    if (!appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found'
      });
    }

    const oldStatus = appointment.status;
    appointment.status = status;
    await appointment.save();

    logger.info('[CompanyOps Appointments] Status updated', {
      companyId,
      appointmentId,
      oldStatus,
      newStatus: status
    });

    res.json({
      ok: true,
      data: {
        _id: appointment._id,
        status: appointment.status,
        oldStatus
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] PATCH status failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      appointmentId: req.params.appointmentId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update appointment status'
    });
  }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/appointments/:appointmentId
 * ============================================================================
 * Delete an appointment (soft delete)
 */
router.delete('/:appointmentId', async (req, res) => {
  try {
    const { companyId, appointmentId } = req.params;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      companyId
    });

    if (!appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found'
      });
    }

    // Soft delete by setting status to Cancelled
    appointment.status = 'Cancelled';
    appointment.cancelledAt = new Date();
    await appointment.save();

    logger.info('[CompanyOps Appointments] Appointment cancelled', {
      companyId,
      appointmentId,
      scheduledDate: appointment.scheduledDate
    });

    res.json({
      ok: true,
      message: 'Appointment cancelled successfully'
    });

  } catch (error) {
    logger.error('[CompanyOps Appointments] DELETE failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      appointmentId: req.params.appointmentId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to cancel appointment'
    });
  }
});

module.exports = router;

