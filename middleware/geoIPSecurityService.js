/**
 * V2 GeoIP Security Service
 * Validates login locations and detects impossible travel
 */

const axios = require('axios');
const logger = require('../utils/logger.js');

const crypto = require('crypto');

class GeoIPSecurityService {
    constructor() {
        this.allowedCountries = ['US', 'CA', 'GB', 'AU']; // Configurable
        this.maxTravelSpeed = 900; // km/h (commercial flight speed)
        this.ipInfoCache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
    }

    /**
     * Get location info for IP address
     */
    async getIPLocation(ip) {
        // Check cache first
        const cacheKey = `ip:${ip}`;
        if (this.ipInfoCache.has(cacheKey)) {
            const cached = this.ipInfoCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        try {
            // Use ipapi.co for geolocation (free tier)
            const response = await axios.get(`https://ipapi.co/${ip}/json/`, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'ClientsVia-Security/1.0'
                }
            });

            const locationData = {
                ip,
                country: response.data.country_code,
                city: response.data.city,
                region: response.data.region,
                latitude: response.data.latitude,
                longitude: response.data.longitude,
                timezone: response.data.timezone,
                isp: response.data.org,
                isVPN: response.data.threat_types?.includes('vpn') || false,
                isProxy: response.data.threat_types?.includes('proxy') || false,
                timestamp: Date.now()
            };

            // Cache the result
            this.ipInfoCache.set(cacheKey, {
                data: locationData,
                timestamp: Date.now()
            });

            logger.debug(`🌍 GeoIP lookup: ${ip} -> ${locationData.city}, ${locationData.country}`);
            return locationData;

        } catch (error) {
            logger.error('GeoIP lookup failed:', error.message);
            
            // Fallback for localhost/private IPs
            if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
                return {
                    ip,
                    country: 'XX',
                    city: 'Localhost',
                    region: 'Local',
                    latitude: 0,
                    longitude: 0,
                    timezone: 'UTC',
                    isp: 'Local Network',
                    isVPN: false,
                    isProxy: false,
                    isLocal: true
                };
            }

            throw new Error(`GeoIP lookup failed for ${ip}`);
        }
    }

    /**
     * Validate if login location is allowed
     */
    async validateLoginLocation(ip, userId, lastKnownLocation = null) {
        const location = await this.getIPLocation(ip);
        
        const validation = {
            allowed: true,
            location,
            warnings: [],
            risk: 'low'
        };

        // Check for localhost (always allow)
        if (location.isLocal) {
            validation.warnings.push('Login from localhost detected');
            return validation;
        }

        // Check allowed countries (handle undefined country gracefully)
        if (!location.country || location.country === 'undefined' || location.country === 'XX') {
            // Allow undefined countries in development/localhost scenarios
            validation.warnings.push('Unknown location detected - allowing for development');
            validation.risk = 'low';
        } else if (!this.allowedCountries.includes(location.country)) {
            validation.allowed = false;
            validation.risk = 'high';
            validation.warnings.push(`Login from restricted country: ${location.country}`);
        }

        // Check for VPN/Proxy
        if (location.isVPN || location.isProxy) {
            validation.risk = 'medium';
            validation.warnings.push('VPN/Proxy detected');
        }

        // Check impossible travel if we have last known location
        if (lastKnownLocation && !lastKnownLocation.isLocal) {
            const travelCheck = this.checkImpossibleTravel(lastKnownLocation, location);
            if (travelCheck.impossible) {
                validation.allowed = false;
                validation.risk = 'high';
                validation.warnings.push(`Impossible travel detected: ${travelCheck.reason}`);
            }
        }

        logger.security(`🔍 Location validation for ${userId}: ${validation.allowed ? 'ALLOWED' : 'BLOCKED'} (${validation.risk} risk)`);
        return validation;
    }

    /**
     * Check for impossible travel between locations
     */
    checkImpossibleTravel(lastLocation, currentLocation, timeWindowHours = 1) {
        if (!lastLocation.latitude || !currentLocation.latitude) {
            return { impossible: false, reason: 'Insufficient location data' };
        }

        const distance = this.calculateDistance(
            lastLocation.latitude, lastLocation.longitude,
            currentLocation.latitude, currentLocation.longitude
        );

        const maxPossibleDistance = this.maxTravelSpeed * timeWindowHours;

        if (distance > maxPossibleDistance) {
            return {
                impossible: true,
                reason: `${Math.round(distance)}km in ${timeWindowHours}h (max possible: ${Math.round(maxPossibleDistance)}km)`,
                distance,
                maxPossibleDistance
            };
        }

        return { impossible: false };
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI/180);
    }

    /**
     * Generate location-based security hash
     */
    generateLocationHash(location) {
        return crypto.createHash('sha256')
            .update(`${location.country}-${location.region}-${location.city}`)
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Update allowed countries for user
     */
    updateAllowedCountries(countries) {
        this.allowedCountries = countries;
        logger.security(`🌍 Updated allowed countries: ${countries.join(', ')}`);
    }
}

module.exports = GeoIPSecurityService;
