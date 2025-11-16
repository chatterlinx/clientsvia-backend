/**
 * ============================================================================
 * COMPANYOPS CUSTOMER DB - AGGREGATED VIEW ROUTES
 * ============================================================================
 * 
 * PURPOSE: Unified customer view aggregating Contacts + Locations + Appointments + Calls
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET /api/company/:companyId/customers
 * - GET /api/company/:companyId/customers/:contactId/profile
 * 
 * DATA SOURCES:
 * - v2Contact (primary)
 * - Location (addresses)
 * - Appointment (service history)
 * - CallTrace (communication history)
 * 
 * KEY FEATURES:
 * - Global search (name, phone, email, address)
 * - Aggregated metrics (locations count, appointments count, last call)
 * - Full customer profile (360° view)
 * - Recent activity (appointments, calls)
 * 
 * NOTE: This is READ-ONLY for display. Editing happens in respective tabs.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const V2Contact = require('../../models/v2Contact');
const Location = require('../../models/Location');
const Appointment = require('../../models/Appointment');
const CallTrace = require('../../models/CallTrace');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/customers
 * ============================================================================
 * Search and list customers with aggregated data
 * 
 * Query params:
 * - search: string (searches name, phone, email, address)
 * - tags: string[] (filter by contact tags)
 * - hasLocations: boolean
 * - hasAppointments: boolean
 * - limit: number (default 50)
 * - offset: number (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { search, tags, hasLocations, hasAppointments, limit = 50, offset = 0 } = req.query;

    // Build base query for contacts
    const contactQuery = { companyId };

    // Search across name, phone, email
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      contactQuery.$or = [
        { name: searchRegex },
        { primaryPhone: searchRegex },
        { secondaryPhone: searchRegex },
        { email: searchRegex }
      ];
    }

    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      contactQuery.tags = { $in: tagArray };
    }

    // Get contacts
    let contacts = await V2Contact.find(contactQuery)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count
    const total = await V2Contact.countDocuments(contactQuery);

    // If searching by address, also search in locations and get matching contactIds
    if (search) {
      const addressRegex = new RegExp(search, 'i');
      const matchingLocations = await Location.find({
        companyId,
        $or: [
          { addressLine1: addressRegex },
          { addressLine2: addressRegex },
          { city: addressRegex },
          { state: addressRegex },
          { postalCode: addressRegex }
        ]
      })
        .distinct('contactId')
        .lean();

      // Get contacts from matching locations
      if (matchingLocations.length > 0) {
        const locationContacts = await V2Contact.find({
          _id: { $in: matchingLocations },
          companyId
        }).lean();

        // Merge with existing contacts (avoid duplicates)
        const contactIds = new Set(contacts.map(c => c._id.toString()));
        locationContacts.forEach(lc => {
          if (!contactIds.has(lc._id.toString())) {
            contacts.push(lc);
            contactIds.add(lc._id.toString());
          }
        });
      }
    }

    // Enrich each contact with aggregated data
    const enrichedCustomers = await Promise.all(
      contacts.map(async (contact) => {
        try {
          // Count locations
          const totalLocations = await Location.countDocuments({
            companyId,
            contactId: contact._id
          });

          // Count appointments
          const totalAppointments = await Appointment.countDocuments({
            companyId,
            contactId: contact._id
          });

          // Get last appointment date
          const lastAppointment = await Appointment.findOne({
            companyId,
            contactId: contact._id
          })
            .sort({ scheduledDate: -1 })
            .select('scheduledDate')
            .lean();

          // Get last call date
          const lastCall = await CallTrace.findOne({
            companyId,
            'extracted.contactId': contact._id.toString()
          })
            .sort({ startedAt: -1 })
            .select('startedAt')
            .lean();

          return {
            _id: contact._id,
            name: contact.name,
            primaryPhone: contact.primaryPhone,
            email: contact.email,
            role: contact.role,
            tags: contact.tags || [],
            totalLocations,
            totalAppointments,
            lastAppointmentAt: lastAppointment?.scheduledDate || null,
            lastCallAt: lastCall?.startedAt || null
          };
        } catch (err) {
          logger.error('[CompanyOps Customers] Error enriching customer', {
            contactId: contact._id,
            error: err.message
          });
          return {
            _id: contact._id,
            name: contact.name,
            error: 'Failed to load complete data'
          };
        }
      })
    );

    // Apply post-query filters
    let filteredCustomers = enrichedCustomers;

    if (hasLocations === 'true') {
      filteredCustomers = filteredCustomers.filter(c => c.totalLocations > 0);
    }

    if (hasAppointments === 'true') {
      filteredCustomers = filteredCustomers.filter(c => c.totalAppointments > 0);
    }

    res.json({
      ok: true,
      data: filteredCustomers,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + contacts.length < total
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Customers] GET all failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch customers'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/customers/:contactId/profile
 * ============================================================================
 * Get complete customer profile (360° view)
 * 
 * Returns:
 * - Core contact info
 * - All locations with access profiles
 * - Recent appointments (last 5)
 * - Recent calls (last 5)
 * - Aggregated stats
 */
router.get('/:contactId/profile', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;

    // Get contact
    const contact = await V2Contact.findOne({
      _id: contactId,
      companyId
    }).lean();

    if (!contact) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Get all locations
    const locations = await Location.find({
      companyId,
      contactId
    })
      .sort({ createdAt: -1 })
      .lean();

    // Format locations with access profile badges
    const formattedLocations = locations.map(loc => ({
      _id: loc._id,
      label: loc.label,
      address: {
        line1: loc.addressLine1,
        line2: loc.addressLine2,
        city: loc.city,
        state: loc.state,
        postalCode: loc.postalCode
      },
      hasAccessProfile: !!(
        loc.accessProfile?.gateCode ||
        loc.accessProfile?.doorCode ||
        loc.accessProfile?.alarmCode ||
        loc.accessProfile?.petsInfo ||
        loc.accessProfile?.parkingNotes ||
        loc.accessProfile?.accessNotes
      ),
      accessProfileSummary: {
        hasGateCode: !!loc.accessProfile?.gateCode,
        hasDoorCode: !!loc.accessProfile?.doorCode,
        hasAlarm: !!loc.accessProfile?.alarmCode,
        hasPets: !!loc.accessProfile?.petsInfo,
        hasParking: !!loc.accessProfile?.parkingNotes,
        hasNotes: !!loc.accessProfile?.accessNotes
      }
    }));

    // Get recent appointments (last 5)
    const recentAppointments = await Appointment.find({
      companyId,
      contactId
    })
      .sort({ scheduledDate: -1 })
      .limit(5)
      .populate('locationId', 'label city')
      .lean();

    const formattedAppointments = recentAppointments.map(apt => ({
      _id: apt._id,
      scheduledDate: apt.scheduledDate,
      timeWindow: apt.timeWindow,
      status: apt.status,
      trade: apt.trade,
      serviceType: apt.serviceType,
      location: apt.locationId
        ? {
            label: apt.locationId.label,
            city: apt.locationId.city
          }
        : null
    }));

    // Get recent calls (last 5)
    const recentCalls = await CallTrace.find({
      companyId,
      'extracted.contactId': contactId
    })
      .sort({ startedAt: -1 })
      .limit(5)
      .select('callId startedAt durationSeconds currentIntent readyToBook appointmentId')
      .lean();

    const formattedCalls = recentCalls.map(call => {
      const durationSeconds = call.endedAt && call.startedAt
        ? Math.floor((call.endedAt - call.startedAt) / 1000)
        : 0;

      return {
        callId: call.callId,
        startedAt: call.startedAt,
        durationSeconds,
        intent: call.currentIntent || 'Unknown',
        outcome: call.appointmentId ? 'Booked' : (call.readyToBook ? 'Attempted Booking' : 'Info')
      };
    });

    // Calculate aggregated stats
    const totalLocations = locations.length;
    const totalAppointments = await Appointment.countDocuments({
      companyId,
      contactId
    });
    const totalCalls = await CallTrace.countDocuments({
      companyId,
      'extracted.contactId': contactId
    });

    // Get appointment status breakdown
    const appointmentsByStatus = await Appointment.aggregate([
      { $match: { companyId, contactId: contact._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const statusBreakdown = appointmentsByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    res.json({
      ok: true,
      data: {
        // Core contact info
        contact: {
          _id: contact._id,
          name: contact.name,
          primaryPhone: contact.primaryPhone,
          secondaryPhone: contact.secondaryPhone,
          email: contact.email,
          role: contact.role,
          tags: contact.tags || [],
          notes: contact.notes || '',
          createdAt: contact.createdAt
        },

        // Locations
        locations: formattedLocations,

        // Recent activity
        recentAppointments: formattedAppointments,
        recentCalls: formattedCalls,

        // Aggregated stats
        stats: {
          totalLocations,
          totalAppointments,
          totalCalls,
          appointmentsByStatus: statusBreakdown
        }
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Customers] GET profile failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      contactId: req.params.contactId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch customer profile'
    });
  }
});

module.exports = router;

