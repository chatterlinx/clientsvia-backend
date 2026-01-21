/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOOGLE CALENDAR SERVICE - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade Google Calendar integration for real-time availability
 * and automatic appointment booking.
 * 
 * CAPABILITIES:
 * - OAuth2 flow for company calendar connection
 * - Real-time free/busy availability queries
 * - Automatic calendar event creation when booking completes
 * - Conflict detection and handling
 * - Token refresh management
 * - Multi-tenant safe (per-company tokens)
 * 
 * SECURITY:
 * - OAuth2 tokens stored encrypted per-company
 * - Tokens never logged or exposed in API responses
 * - Refresh tokens rotated on each use
 * 
 * FALLBACK:
 * - If calendar unavailable, falls back to preference capture mode
 * - Logs errors for monitoring without disrupting calls
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const { google } = require('googleapis');
const logger = require('../utils/logger');
const v2Company = require('../models/v2Company');

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

// OAuth2 credentials from environment
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI || 
    (process.env.NODE_ENV === 'production' 
        ? 'https://cv-backend-va.onrender.com/api/integrations/google-calendar/callback'
        : 'http://localhost:3000/api/integrations/google-calendar/callback');

// Scopes required for calendar access
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',           // Full calendar access
    'https://www.googleapis.com/auth/calendar.events',    // Create/modify events
    'https://www.googleapis.com/auth/userinfo.email'      // Get user email for display
];

// ════════════════════════════════════════════════════════════════════════════════
// OAUTH2 CLIENT FACTORY
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create an OAuth2 client for a company
 * If tokens are provided, sets them on the client
 */
function createOAuth2Client(tokens = null) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        logger.error('[GOOGLE CALENDAR] ❌ Missing OAuth2 credentials in environment');
        return null;
    }
    
    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
    );
    
    if (tokens) {
        oauth2Client.setCredentials({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            expiry_date: tokens.tokenExpiresAt ? new Date(tokens.tokenExpiresAt).getTime() : null
        });
    }
    
    return oauth2Client;
}

/**
 * Get OAuth2 client for a company (loads tokens from DB)
 */
async function getOAuth2ClientForCompany(companyId) {
    try {
        // Load company with tokens (they're select: false so need explicit select)
        const company = await v2Company.findById(companyId)
            .select('+googleCalendar.accessToken +googleCalendar.refreshToken')
            .lean();
        
        if (!company) {
            logger.warn('[GOOGLE CALENDAR] Company not found', { companyId });
            return { client: null, error: 'COMPANY_NOT_FOUND' };
        }
        
        const gc = company.googleCalendar;
        if (!gc?.connected || !gc?.accessToken) {
            return { client: null, error: 'NOT_CONNECTED', company };
        }
        
        const client = createOAuth2Client({
            accessToken: gc.accessToken,
            refreshToken: gc.refreshToken,
            tokenExpiresAt: gc.tokenExpiresAt
        });
        
        if (!client) {
            return { client: null, error: 'OAUTH_CONFIG_ERROR', company };
        }
        
        // Set up token refresh handler
        client.on('tokens', async (tokens) => {
            logger.info('[GOOGLE CALENDAR] 🔄 Tokens refreshed', { companyId });
            try {
                await v2Company.updateOne(
                    { _id: companyId },
                    {
                        $set: {
                            'googleCalendar.accessToken': tokens.access_token,
                            'googleCalendar.tokenExpiresAt': tokens.expiry_date 
                                ? new Date(tokens.expiry_date) 
                                : null,
                            // Only update refresh token if a new one was provided
                            ...(tokens.refresh_token && { 
                                'googleCalendar.refreshToken': tokens.refresh_token 
                            })
                        }
                    }
                );
            } catch (err) {
                logger.error('[GOOGLE CALENDAR] ❌ Failed to save refreshed tokens', { 
                    companyId, 
                    error: err.message 
                });
            }
        });
        
        return { client, company, calendarId: gc.calendarId || 'primary' };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Error getting OAuth2 client', { 
            companyId, 
            error: err.message 
        });
        return { client: null, error: err.message };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// OAUTH2 FLOW
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate OAuth2 authorization URL for company to connect calendar
 * @param {string} companyId - Company ID (passed as state parameter)
 * @returns {string} Authorization URL
 */
function generateAuthUrl(companyId) {
    const oauth2Client = createOAuth2Client();
    if (!oauth2Client) {
        return null;
    }
    
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required for refresh token
        scope: SCOPES,
        state: companyId, // Pass company ID to callback
        prompt: 'consent' // Always show consent screen to get refresh token
    });
}

/**
 * Exchange authorization code for tokens and save to company
 * @param {string} code - Authorization code from Google
 * @param {string} companyId - Company ID from state parameter
 * @returns {Object} { success, error, email }
 */
async function handleAuthCallback(code, companyId) {
    try {
        const oauth2Client = createOAuth2Client();
        if (!oauth2Client) {
            return { success: false, error: 'OAuth2 not configured' };
        }
        
        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        
        // Get user email for display
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;
        
        // Get list of calendars to find primary calendar name
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const calendarList = await calendar.calendarList.list();
        const primaryCalendar = calendarList.data.items?.find(c => c.primary) || 
                               calendarList.data.items?.[0];
        
        // Save tokens to company
        await v2Company.updateOne(
            { _id: companyId },
            {
                $set: {
                    'googleCalendar.enabled': true,
                    'googleCalendar.connected': true,
                    'googleCalendar.connectedAt': new Date(),
                    'googleCalendar.connectedBy': email,
                    'googleCalendar.accessToken': tokens.access_token,
                    'googleCalendar.refreshToken': tokens.refresh_token,
                    'googleCalendar.tokenExpiresAt': tokens.expiry_date 
                        ? new Date(tokens.expiry_date) 
                        : null,
                    'googleCalendar.scope': tokens.scope,
                    'googleCalendar.calendarId': 'primary',
                    'googleCalendar.calendarName': primaryCalendar?.summary || 'Primary Calendar',
                    'googleCalendar.calendarEmail': email,
                    'googleCalendar.lastError': null,
                    'googleCalendar.consecutiveErrors': 0
                }
            }
        );
        
        logger.info('[GOOGLE CALENDAR] ✅ Calendar connected successfully', { 
            companyId, 
            email,
            calendarName: primaryCalendar?.summary
        });
        
        return { 
            success: true, 
            email,
            calendarName: primaryCalendar?.summary || 'Primary Calendar'
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Auth callback failed', { 
            companyId, 
            error: err.message,
            stack: err.stack
        });
        return { success: false, error: err.message };
    }
}

/**
 * Disconnect calendar from company
 */
async function disconnectCalendar(companyId) {
    try {
        // Revoke tokens if possible
        const { client } = await getOAuth2ClientForCompany(companyId);
        if (client) {
            try {
                await client.revokeCredentials();
            } catch (revokeErr) {
                // Ignore revoke errors - tokens may already be invalid
                logger.warn('[GOOGLE CALENDAR] Token revoke failed (may already be invalid)', {
                    companyId,
                    error: revokeErr.message
                });
            }
        }
        
        // Clear all calendar data
        await v2Company.updateOne(
            { _id: companyId },
            {
                $set: {
                    'googleCalendar.enabled': false,
                    'googleCalendar.connected': false,
                    'googleCalendar.connectedAt': null,
                    'googleCalendar.connectedBy': null,
                    'googleCalendar.accessToken': null,
                    'googleCalendar.refreshToken': null,
                    'googleCalendar.tokenExpiresAt': null,
                    'googleCalendar.calendarId': 'primary',
                    'googleCalendar.calendarName': null,
                    'googleCalendar.calendarEmail': null
                }
            }
        );
        
        logger.info('[GOOGLE CALENDAR] ✅ Calendar disconnected', { companyId });
        return { success: true };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Disconnect failed', { 
            companyId, 
            error: err.message 
        });
        return { success: false, error: err.message };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// AVAILABILITY CHECKING
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Check availability for a time range
 * @param {string} companyId 
 * @param {Object} options
 * @param {Date} options.startDate - Start of range to check
 * @param {Date} options.endDate - End of range to check
 * @returns {Object} { available: boolean, busySlots: [], nextAvailable: Date }
 */
async function checkAvailability(companyId, { startDate, endDate }) {
    try {
        const { client, company, calendarId, error } = await getOAuth2ClientForCompany(companyId);
        
        if (!client) {
            return { 
                available: null, 
                error: error || 'Calendar not connected',
                fallback: true 
            };
        }
        
        const calendar = google.calendar({ version: 'v3', auth: client });
        
        // Query free/busy
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                items: [{ id: calendarId }]
            }
        });
        
        const busySlots = response.data.calendars?.[calendarId]?.busy || [];
        
        // Reset error count on success
        if (company?.googleCalendar?.consecutiveErrors > 0) {
            await v2Company.updateOne(
                { _id: companyId },
                { $set: { 'googleCalendar.consecutiveErrors': 0, 'googleCalendar.lastError': null } }
            );
        }
        
        return {
            available: busySlots.length === 0,
            busySlots: busySlots.map(slot => ({
                start: new Date(slot.start),
                end: new Date(slot.end)
            })),
            fallback: false
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Availability check failed', { 
            companyId, 
            error: err.message 
        });
        
        // Track consecutive errors
        await v2Company.updateOne(
            { _id: companyId },
            { 
                $set: { 
                    'googleCalendar.lastError': err.message,
                    'googleCalendar.lastErrorAt': new Date()
                },
                $inc: { 'googleCalendar.consecutiveErrors': 1 }
            }
        );
        
        return { 
            available: null, 
            error: err.message,
            fallback: true 
        };
    }
}

/**
 * Find next available slot
 * @param {string} companyId
 * @param {Object} options
 * @param {number} options.durationMinutes - Required duration
 * @param {Date} options.searchFrom - Start searching from (default: now + buffer)
 * @param {number} options.maxDaysAhead - How many days to search
 * @returns {Object} { slot: { start, end }, error }
 */
async function findNextAvailableSlot(companyId, { 
    durationMinutes = 60, 
    searchFrom = null,
    maxDaysAhead = 7 
}) {
    try {
        const { client, company, calendarId, error } = await getOAuth2ClientForCompany(companyId);
        
        if (!client) {
            return { slot: null, error: error || 'Calendar not connected', fallback: true };
        }
        
        const settings = company?.googleCalendar?.settings || {};
        const bufferMinutes = settings.bufferMinutes || 60;
        
        const startSearch = searchFrom || new Date(Date.now() + bufferMinutes * 60 * 1000);
        const endSearch = new Date(startSearch.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);
        
        const calendar = google.calendar({ version: 'v3', auth: client });
        
        // Get busy times
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startSearch.toISOString(),
                timeMax: endSearch.toISOString(),
                items: [{ id: calendarId }]
            }
        });
        
        const busySlots = response.data.calendars?.[calendarId]?.busy || [];
        
        // Find first gap that fits the duration
        // TODO: Respect working hours from settings
        let currentTime = startSearch;
        
        for (const busy of busySlots) {
            const busyStart = new Date(busy.start);
            const busyEnd = new Date(busy.end);
            
            // Check if there's room before this busy slot
            const gapMinutes = (busyStart - currentTime) / (60 * 1000);
            if (gapMinutes >= durationMinutes) {
                return {
                    slot: {
                        start: currentTime,
                        end: new Date(currentTime.getTime() + durationMinutes * 60 * 1000)
                    },
                    fallback: false
                };
            }
            
            // Move past this busy slot
            currentTime = busyEnd;
        }
        
        // Check if there's room after last busy slot
        const remainingMinutes = (endSearch - currentTime) / (60 * 1000);
        if (remainingMinutes >= durationMinutes) {
            return {
                slot: {
                    start: currentTime,
                    end: new Date(currentTime.getTime() + durationMinutes * 60 * 1000)
                },
                fallback: false
            };
        }
        
        return { 
            slot: null, 
            error: 'No available slots in search range',
            searchedUntil: endSearch,
            fallback: false 
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Find slot failed', { 
            companyId, 
            error: err.message 
        });
        return { slot: null, error: err.message, fallback: true };
    }
}

/**
 * Find multiple available slots for a given day or range
 * Returns human-friendly slot descriptions
 * @param {string} companyId
 * @param {Object} options
 * @param {string} options.dayPreference - 'today', 'tomorrow', 'asap', or specific date
 * @param {string} options.timePreference - 'morning', 'afternoon', 'anytime'
 * @param {number} options.durationMinutes - Required duration
 * @param {number} options.maxSlots - Max slots to return
 * @returns {Object} { slots: [], message, fallback }
 */
async function findAvailableSlots(companyId, {
    dayPreference = 'asap',
    timePreference = 'anytime',
    durationMinutes = 60,
    maxSlots = 3
}) {
    try {
        const { client, company, calendarId, error } = await getOAuth2ClientForCompany(companyId);
        
        if (!client) {
            return { 
                slots: [], 
                error: error || 'Calendar not connected', 
                fallback: true,
                message: "I'll note your preference and we'll confirm the time."
            };
        }
        
        const settings = company?.googleCalendar?.settings || {};
        const bufferMinutes = settings.bufferMinutes || 60;
        const timezone = company?.timezone || 'America/New_York';
        
        // Determine search range based on preference
        const now = new Date();
        let searchStart = new Date(now.getTime() + bufferMinutes * 60 * 1000);
        let searchEnd;
        
        if (dayPreference === 'today') {
            // Today only - end of day
            searchEnd = new Date(now);
            searchEnd.setHours(23, 59, 59, 999);
        } else if (dayPreference === 'tomorrow') {
            // Tomorrow only
            searchStart = new Date(now);
            searchStart.setDate(searchStart.getDate() + 1);
            searchStart.setHours(0, 0, 0, 0);
            searchEnd = new Date(searchStart);
            searchEnd.setHours(23, 59, 59, 999);
        } else {
            // ASAP - search next 5 days
            searchEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
        }
        
        // Define working hours (use company settings or defaults)
        const workingHours = {
            start: 8, // 8 AM
            end: 17   // 5 PM
        };
        
        // Adjust search based on time preference
        if (timePreference === 'morning') {
            // 8 AM - 12 PM
            workingHours.end = 12;
        } else if (timePreference === 'afternoon') {
            // 12 PM - 5 PM
            workingHours.start = 12;
        }
        
        const calendar = google.calendar({ version: 'v3', auth: client });
        
        // Get busy times
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: searchStart.toISOString(),
                timeMax: searchEnd.toISOString(),
                items: [{ id: calendarId }]
            }
        });
        
        const busySlots = response.data.calendars?.[calendarId]?.busy || [];
        
        // Find available slots within working hours
        const availableSlots = [];
        let currentDay = new Date(searchStart);
        
        while (currentDay < searchEnd && availableSlots.length < maxSlots) {
            // Skip weekends
            if (currentDay.getDay() === 0 || currentDay.getDay() === 6) {
                currentDay.setDate(currentDay.getDate() + 1);
                currentDay.setHours(workingHours.start, 0, 0, 0);
                continue;
            }
            
            // Set to start of working hours for this day
            const dayStart = new Date(currentDay);
            dayStart.setHours(workingHours.start, 0, 0, 0);
            
            const dayEnd = new Date(currentDay);
            dayEnd.setHours(workingHours.end, 0, 0, 0);
            
            // Start from current time if it's today
            let slotStart = dayStart;
            if (dayStart < searchStart) {
                slotStart = new Date(searchStart);
            }
            
            // Try slots throughout the day
            while (slotStart < dayEnd && availableSlots.length < maxSlots) {
                const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
                
                if (slotEnd > dayEnd) break;
                
                // Check if this slot conflicts with any busy time
                const hasConflict = busySlots.some(busy => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return slotStart < busyEnd && slotEnd > busyStart;
                });
                
                if (!hasConflict) {
                    availableSlots.push({
                        start: new Date(slotStart),
                        end: new Date(slotEnd),
                        display: formatSlotForDisplay(slotStart, timezone)
                    });
                    // Skip to next slot (don't overlap)
                    slotStart = new Date(slotEnd.getTime() + 30 * 60 * 1000); // 30 min gap
                } else {
                    // Move to end of this busy slot
                    const overlappingBusy = busySlots.find(busy => {
                        const busyStart = new Date(busy.start);
                        const busyEnd = new Date(busy.end);
                        return slotStart < busyEnd && slotEnd > busyStart;
                    });
                    if (overlappingBusy) {
                        slotStart = new Date(overlappingBusy.end);
                    } else {
                        slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
                    }
                }
            }
            
            // Move to next day
            currentDay.setDate(currentDay.getDate() + 1);
            currentDay.setHours(workingHours.start, 0, 0, 0);
        }
        
        if (availableSlots.length === 0) {
            return {
                slots: [],
                message: "I couldn't find any open slots in that timeframe. Would you like me to note your preference and have someone call you back to schedule?",
                fallback: true
            };
        }
        
        // Build human-readable message
        let message;
        if (availableSlots.length === 1) {
            message = `I have ${availableSlots[0].display} available. Does that work for you?`;
        } else {
            const slotList = availableSlots.map(s => s.display).join(', or ');
            message = `I have a few openings: ${slotList}. Which works best?`;
        }
        
        return {
            slots: availableSlots,
            message,
            fallback: false
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Find available slots failed', { 
            companyId, 
            error: err.message 
        });
        return { 
            slots: [], 
            error: err.message, 
            fallback: true,
            message: "I'll note your preference and we'll confirm the time."
        };
    }
}

/**
 * Format a slot time for display in conversation
 */
function formatSlotForDisplay(date, timezone = 'America/New_York') {
    const options = {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone
    };
    
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone });
    
    // Check if it's today or tomorrow for friendlier messaging
    if (date.toDateString() === now.toDateString()) {
        return `today at ${timeStr}`;
    } else if (date.toDateString() === tomorrow.toDateString()) {
        return `tomorrow at ${timeStr}`;
    } else {
        return `${dateStr} at ${timeStr}`;
    }
}

/**
 * Confirm a specific slot and create the event
 * @param {string} companyId
 * @param {Object} slot - The selected slot { start, end }
 * @param {Object} bookingData - Customer and service details
 */
async function confirmSlot(companyId, slot, bookingData) {
    // Verify slot is still available
    const availCheck = await checkAvailability(companyId, {
        startDate: slot.start,
        endDate: slot.end
    });
    
    if (availCheck.fallback) {
        return {
            success: false,
            error: 'Could not verify availability',
            fallback: true
        };
    }
    
    if (!availCheck.available) {
        return {
            success: false,
            error: 'That slot was just taken. Let me find another option.',
            slotTaken: true
        };
    }
    
    // Create the event
    return await createBookingEvent(companyId, {
        ...bookingData,
        startTime: slot.start,
        endTime: slot.end
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// EVENT CREATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create a calendar event for a booking
 * @param {string} companyId
 * @param {Object} bookingData
 * @param {string} bookingData.customerName
 * @param {string} bookingData.customerPhone
 * @param {string} bookingData.customerEmail (optional)
 * @param {string} bookingData.customerAddress (optional)
 * @param {string} bookingData.serviceType
 * @param {string} bookingData.serviceNotes (optional)
 * @param {Date} bookingData.startTime
 * @param {Date} bookingData.endTime (optional, uses default duration if not provided)
 * @returns {Object} { success, eventId, eventLink, error }
 */
async function createBookingEvent(companyId, bookingData) {
    try {
        const { client, company, calendarId, error } = await getOAuth2ClientForCompany(companyId);
        
        if (!client) {
            return { success: false, error: error || 'Calendar not connected', fallback: true };
        }
        
        const settings = company?.googleCalendar?.settings || {};
        const companyName = company?.companyName || 'Service';
        const durationMinutes = settings.defaultDurationMinutes || 60;
        
        // Calculate end time if not provided
        const startTime = new Date(bookingData.startTime);
        const endTime = bookingData.endTime 
            ? new Date(bookingData.endTime)
            : new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        
        // Build event title from template
        let title = settings.eventTitleTemplate || '{serviceType} - {customerName}';
        title = title
            .replace('{customerName}', bookingData.customerName || 'Customer')
            .replace('{serviceType}', bookingData.serviceType || 'Service Call')
            .replace('{companyName}', companyName);
        
        // Build event description from template
        let description = settings.eventDescriptionTemplate || 
            'Customer: {customerName}\nPhone: {customerPhone}\nAddress: {customerAddress}\n\nService: {serviceType}\nNotes: {serviceNotes}';
        description = description
            .replace('{customerName}', bookingData.customerName || 'N/A')
            .replace('{customerPhone}', settings.includeCustomerPhone !== false ? (bookingData.customerPhone || 'N/A') : '[Hidden]')
            .replace('{customerAddress}', settings.includeCustomerAddress !== false ? (bookingData.customerAddress || 'N/A') : '[Hidden]')
            .replace('{serviceType}', bookingData.serviceType || 'Service Call')
            .replace('{serviceNotes}', settings.includeServiceNotes !== false ? (bookingData.serviceNotes || 'None') : '[Hidden]')
            .replace('{companyName}', companyName);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // DETERMINE EVENT COLOR based on service type
        // Google Calendar colorId: 1=Lavender, 2=Sage, 3=Grape, 4=Flamingo, 5=Banana,
        // 6=Tangerine, 7=Peacock, 8=Graphite, 9=Blueberry, 10=Basil, 11=Tomato
        // ═══════════════════════════════════════════════════════════════════════════
        let colorId = null;
        const eventColors = gcSettings?.eventColors;
        if (eventColors?.enabled !== false) {
            const serviceType = (bookingData.serviceType || 'service').toLowerCase();
            const colorMapping = eventColors?.colorMapping || [];
            
            // Find color for this service type
            const matchedColor = colorMapping.find(c => c.serviceType === serviceType);
            colorId = matchedColor?.colorId || eventColors?.defaultColorId || '7'; // Default: Peacock
            
            logger.debug('[GOOGLE CALENDAR] Event color determined', {
                companyId,
                serviceType,
                colorId,
                colorLabel: matchedColor?.label || 'Default'
            });
        }
        
        // Build event object
        const event = {
            summary: title,
            description: description,
            // Apply color if enabled
            ...(colorId && { colorId: colorId }),
            start: {
                dateTime: startTime.toISOString(),
                timeZone: company?.timezone || 'America/New_York'
            },
            end: {
                dateTime: endTime.toISOString(),
                timeZone: company?.timezone || 'America/New_York'
            },
            // Add customer as attendee if we should send invite
            ...(settings.sendCustomerInvite && bookingData.customerEmail && {
                attendees: [{ email: bookingData.customerEmail }],
                sendUpdates: 'all'
            }),
            // Reminder for the service team
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 60 },
                    { method: 'popup', minutes: 15 }
                ]
            },
            // Add location if address provided
            ...(bookingData.customerAddress && {
                location: bookingData.customerAddress
            }),
            // Custom properties for tracking
            extendedProperties: {
                private: {
                    source: 'clientsvia_ai_receptionist',
                    companyId: companyId,
                    customerPhone: bookingData.customerPhone || '',
                    serviceType: bookingData.serviceType || 'service',
                    bookedAt: new Date().toISOString()
                }
            }
        };
        
        const calendar = google.calendar({ version: 'v3', auth: client });
        const response = await calendar.events.insert({
            calendarId: calendarId,
            requestBody: event
        });
        
        logger.info('[GOOGLE CALENDAR] ✅ Event created', {
            companyId,
            eventId: response.data.id,
            title,
            colorId: colorId || 'none',
            serviceType: bookingData.serviceType || 'service',
            start: startTime.toISOString()
        });
        
        return {
            success: true,
            eventId: response.data.id,
            eventLink: response.data.htmlLink,
            start: startTime,
            end: endTime,
            colorId: colorId,
            serviceType: bookingData.serviceType || 'service',
            fallback: false
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Event creation failed', { 
            companyId, 
            error: err.message,
            bookingData: { 
                customerName: bookingData.customerName,
                startTime: bookingData.startTime
            }
        });
        
        return { success: false, error: err.message, fallback: true };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// STATUS & HEALTH
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Get calendar connection status for a company
 */
async function getStatus(companyId) {
    try {
        const company = await v2Company.findById(companyId)
            .select('googleCalendar companyName')
            .lean();
        
        if (!company) {
            return { connected: false, error: 'Company not found' };
        }
        
        const gc = company.googleCalendar || {};
        
        return {
            enabled: gc.enabled || false,
            connected: gc.connected || false,
            connectedAt: gc.connectedAt,
            calendarName: gc.calendarName,
            calendarEmail: gc.calendarEmail,
            settings: gc.settings || {},
            eventColors: gc.eventColors || {}, // V89: Include event color settings
            lastError: gc.lastError,
            lastErrorAt: gc.lastErrorAt,
            consecutiveErrors: gc.consecutiveErrors || 0,
            healthy: gc.connected && (gc.consecutiveErrors || 0) < 3
        };
    } catch (err) {
        logger.error('[GOOGLE CALENDAR] ❌ Status check failed', { 
            companyId, 
            error: err.message 
        });
        return { connected: false, error: err.message };
    }
}

/**
 * Test calendar connection
 */
async function testConnection(companyId) {
    try {
        const { client, calendarId, error } = await getOAuth2ClientForCompany(companyId);
        
        if (!client) {
            return { success: false, error: error || 'Not connected' };
        }
        
        const calendar = google.calendar({ version: 'v3', auth: client });
        
        // Try to get calendar info
        const response = await calendar.calendars.get({ calendarId });
        
        return {
            success: true,
            calendarName: response.data.summary,
            calendarId: response.data.id,
            timezone: response.data.timeZone
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
    // OAuth2
    generateAuthUrl,
    handleAuthCallback,
    disconnectCalendar,
    
    // Availability
    checkAvailability,
    findNextAvailableSlot,
    findAvailableSlots,    // V88: Multi-slot finder with working hours
    confirmSlot,           // V88: Verify + create in one call
    
    // Events
    createBookingEvent,
    
    // Status
    getStatus,
    testConnection,
    
    // Config check
    isConfigured: () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
};
