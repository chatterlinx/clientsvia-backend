/**
 * ============================================================================
 * COMPANYOPS LOCATIONS - CRUD ROUTES
 * ============================================================================
 * 
 * PURPOSE: Manage locations with Access Profiles for CompanyOps Console
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET    /api/company/:companyId/locations
 * - POST   /api/company/:companyId/locations
 * - GET    /api/company/:companyId/locations/:locationId
 * - PUT    /api/company/:companyId/locations/:locationId
 * - DELETE /api/company/:companyId/locations/:locationId
 * 
 * MODEL: Location (Phase 1)
 * 
 * KEY FEATURES:
 * - Access Profile management (gate codes, pets, alarms, etc.)
 * - Link to primary contact
 * - Count appointments per location
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const Location = require('../../models/Location');
const V2Contact = require('../../models/v2Contact');
const Appointment = require('../../models/Appointment');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/locations
 * ============================================================================
 * Get all locations for a company with aggregated data
 * 
 * Query params:
 * - search: string (address, city, label)
 * - contactId: string (filter by contact)
 * - hasAccessProfile: boolean (filter by access profile existence)
 * - limit: number (default 100)
 * - offset: number (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { search, contactId, hasAccessProfile, limit = 100, offset = 0 } = req.query;

    // Build query
    const query = { companyId };

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { label: searchRegex },
        { addressLine1: searchRegex },
        { addressLine2: searchRegex },
        { city: searchRegex },
        { state: searchRegex },
        { postalCode: searchRegex }
      ];
    }

    // Contact filter
    if (contactId) {
      query.contactId = contactId;
    }

    // Access profile filter
    if (hasAccessProfile === 'true') {
      query.$or = [
        { 'accessProfile.gateCode': { $exists: true, $ne: '' } },
        { 'accessProfile.doorCode': { $exists: true, $ne: '' } },
        { 'accessProfile.alarmCode': { $exists: true, $ne: '' } },
        { 'accessProfile.petsInfo': { $exists: true, $ne: '' } },
        { 'accessProfile.parkingNotes': { $exists: true, $ne: '' } },
        { 'accessProfile.accessNotes': { $exists: true, $ne: '' } }
      ];
    }

    // Get locations with contact info
    const locations = await Location.find(query)
      .populate('contactId', 'name primaryPhone email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count
    const total = await Location.countDocuments(query);

    // Enrich with appointment count
    const enrichedLocations = await Promise.all(
      locations.map(async (location) => {
        try {
          const appointmentsCount = await Appointment.countDocuments({
            companyId,
            locationId: location._id
          });

          return {
            ...location,
            appointmentsCount,
            hasAccessProfile: !!(
              location.accessProfile?.gateCode ||
              location.accessProfile?.doorCode ||
              location.accessProfile?.alarmCode ||
              location.accessProfile?.petsInfo ||
              location.accessProfile?.parkingNotes ||
              location.accessProfile?.accessNotes
            )
          };
        } catch (err) {
          logger.error('[CompanyOps Locations] Error enriching location', {
            locationId: location._id,
            error: err.message
          });
          return {
            ...location,
            appointmentsCount: 0,
            hasAccessProfile: false
          };
        }
      })
    );

    res.json({
      ok: true,
      data: enrichedLocations,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + locations.length < total
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Locations] GET all failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch locations'
    });
  }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/locations
 * ============================================================================
 * Create a new location
 * 
 * Body:
 * - label: string
 * - addressLine1: string (required)
 * - addressLine2: string
 * - city: string (required)
 * - state: string (required)
 * - postalCode: string (required)
 * - contactId: ObjectId (required)
 * - accessProfile: object
 *   - gateCode: string
 *   - doorCode: string
 *   - alarmCode: string
 *   - petsInfo: string
 *   - parkingNotes: string
 *   - accessNotes: string
 *   - confirmOnEveryVisit: boolean
 */
router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      label,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      contactId,
      accessProfile
    } = req.body;

    // Validation
    if (!addressLine1 || !city || !state || !postalCode) {
      return res.status(400).json({
        ok: false,
        error: 'Address line 1, city, state, and postal code are required'
      });
    }

    if (!contactId) {
      return res.status(400).json({
        ok: false,
        error: 'Contact ID is required'
      });
    }

    // Verify contact exists and belongs to company
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

    // Check for duplicate address
    const existingLocation = await Location.findOne({
      companyId,
      addressLine1: addressLine1.trim(),
      city: city.trim(),
      postalCode: postalCode.trim()
    });

    if (existingLocation) {
      return res.status(409).json({
        ok: false,
        error: 'A location with this address already exists'
      });
    }

    // Create location
    const location = await Location.create({
      companyId,
      label: label?.trim() || `${addressLine1}, ${city}`,
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2?.trim() || '',
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      contactId,
      accessProfile: accessProfile || {
        gateCode: '',
        doorCode: '',
        alarmCode: '',
        petsInfo: '',
        parkingNotes: '',
        accessNotes: '',
        confirmOnEveryVisit: false
      }
    });

    // Populate contact info
    await location.populate('contactId', 'name primaryPhone email');

    logger.info('[CompanyOps Locations] Location created', {
      companyId,
      locationId: location._id,
      address: location.addressLine1
    });

    res.status(201).json({
      ok: true,
      data: location
    });

  } catch (error) {
    logger.error('[CompanyOps Locations] POST failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to create location'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/locations/:locationId
 * ============================================================================
 * Get a single location with full details
 */
router.get('/:locationId', async (req, res) => {
  try {
    const { companyId, locationId } = req.params;

    const location = await Location.findOne({
      _id: locationId,
      companyId
    })
      .populate('contactId', 'name primaryPhone secondaryPhone email')
      .lean();

    if (!location) {
      return res.status(404).json({
        ok: false,
        error: 'Location not found'
      });
    }

    // Get recent appointments (last 5)
    const recentAppointments = await Appointment.find({
      companyId,
      locationId
    })
      .sort({ scheduledDate: -1 })
      .limit(5)
      .select('scheduledDate timeWindow status serviceType trade')
      .lean();

    res.json({
      ok: true,
      data: {
        ...location,
        recentAppointments
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Locations] GET one failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      locationId: req.params.locationId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch location'
    });
  }
});

/**
 * ============================================================================
 * PUT /api/company/:companyId/locations/:locationId
 * ============================================================================
 * Update a location
 */
router.put('/:locationId', async (req, res) => {
  try {
    const { companyId, locationId } = req.params;
    const {
      label,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      contactId,
      accessProfile
    } = req.body;

    // Find existing location
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

    // If contactId changed, verify new contact exists
    if (contactId && contactId !== location.contactId?.toString()) {
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
    }

    // Check for duplicate address (if changed)
    if (addressLine1 || city || postalCode) {
      const newAddress1 = addressLine1 || location.addressLine1;
      const newCity = city || location.city;
      const newPostalCode = postalCode || location.postalCode;

      const existingLocation = await Location.findOne({
        companyId,
        addressLine1: newAddress1,
        city: newCity,
        postalCode: newPostalCode,
        _id: { $ne: locationId }
      });

      if (existingLocation) {
        return res.status(409).json({
          ok: false,
          error: 'Another location with this address already exists'
        });
      }
    }

    // Update fields
    if (label !== undefined) location.label = label.trim();
    if (addressLine1 !== undefined) location.addressLine1 = addressLine1.trim();
    if (addressLine2 !== undefined) location.addressLine2 = addressLine2.trim();
    if (city !== undefined) location.city = city.trim();
    if (state !== undefined) location.state = state.trim();
    if (postalCode !== undefined) location.postalCode = postalCode.trim();
    if (contactId !== undefined) location.contactId = contactId;
    
    // Update access profile (merge with existing)
    if (accessProfile !== undefined) {
      location.accessProfile = {
        ...location.accessProfile,
        ...accessProfile
      };
    }

    await location.save();

    // Populate contact info
    await location.populate('contactId', 'name primaryPhone email');

    logger.info('[CompanyOps Locations] Location updated', {
      companyId,
      locationId,
      address: location.addressLine1
    });

    res.json({
      ok: true,
      data: location
    });

  } catch (error) {
    logger.error('[CompanyOps Locations] PUT failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      locationId: req.params.locationId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update location'
    });
  }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/locations/:locationId
 * ============================================================================
 * Delete a location
 * 
 * NOTE: Cannot delete if referenced by appointments
 */
router.delete('/:locationId', async (req, res) => {
  try {
    const { companyId, locationId } = req.params;

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

    // Check if location is referenced by appointments
    const appointmentCount = await Appointment.countDocuments({
      companyId,
      locationId
    });

    if (appointmentCount > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete location. It is referenced by ${appointmentCount} appointment(s). Remove those references first.`
      });
    }

    // Hard delete (locations are less critical than contacts)
    await location.deleteOne();

    logger.info('[CompanyOps Locations] Location deleted', {
      companyId,
      locationId,
      address: location.addressLine1
    });

    res.json({
      ok: true,
      message: 'Location deleted successfully'
    });

  } catch (error) {
    logger.error('[CompanyOps Locations] DELETE failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      locationId: req.params.locationId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to delete location'
    });
  }
});

module.exports = router;

