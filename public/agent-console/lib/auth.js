/**
 * ============================================================================
 * AGENT CONSOLE — AUTH UTILITY
 * ClientVia Platform · Centralized Authentication
 * 
 * Single source of truth for:
 * - Token retrieval
 * - API calls with auto-auth
 * - 401 handling with redirect
 * ============================================================================
 */

const AgentConsoleAuth = (function() {
  'use strict';

  const TOKEN_KEY = 'adminToken';
  const LOGIN_PATH = '/login.html';

  /**
   * Get current auth token from localStorage
   * @returns {string|null}
   */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  /**
   * Decode base64url string to UTF-8 (handles non-ASCII payloads)
   * @param {string} str - base64url encoded string
   * @returns {string} - decoded UTF-8 string
   */
  function base64UrlDecodeUtf8(str) {
    // Convert base64url to base64
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to length multiple of 4
    while (s.length % 4) s += '=';
    // Decode base64 to binary string
    const binary = atob(s);
    // Convert to bytes and decode as UTF-8
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * Decode JWT payload without verification (client-side only)
   * @param {string} token - JWT token
   * @returns {Object|null} - Decoded payload or null if invalid
   */
  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(base64UrlDecodeUtf8(parts[1]));
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if JWT token is expired (client-side check)
   * @param {string} token - JWT token
   * @returns {boolean} - true if expired or invalid
   */
  function isTokenExpired(token) {
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return true;
    // exp is in seconds, Date.now() is in milliseconds
    // 10 second buffer to avoid edge cases
    const expMs = payload.exp * 1000;
    return expMs < (Date.now() + 10000);
  }

  /**
   * Clear auth token and redirect to login
   * @param {string} [message] - Optional message to show on login page
   */
  function clearAndRedirect(message) {
    localStorage.removeItem(TOKEN_KEY);
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    const loginUrl = `${LOGIN_PATH}?returnUrl=${returnUrl}${message ? '&error=' + encodeURIComponent(message) : ''}`;
    window.location.href = loginUrl;
  }

  /**
   * Check if user is authenticated with valid token, redirect if not
   * Performs client-side JWT expiry check (no server call needed)
   * @returns {boolean}
   */
  function requireAuth() {
    const token = getToken();
    
    // No token present
    if (!token) {
      clearAndRedirect('Please log in to access Agent Console');
      return false;
    }
    
    // Token expired (client-side check)
    if (isTokenExpired(token)) {
      console.warn('[AgentConsoleAuth] Token expired, redirecting to login');
      clearAndRedirect('Session expired - please log in again');
      return false;
    }
    
    return true;
  }

  /**
   * Centralized API fetch with automatic auth handling
   * 
   * @param {string} url - Full URL or path starting with /
   * @param {Object} [options] - Fetch options
   * @param {string} [options.method] - HTTP method (default: GET)
   * @param {Object} [options.body] - Request body (will be JSON stringified)
   * @param {Object} [options.headers] - Additional headers
   * @returns {Promise<any>} - Parsed JSON response
   * @throws {Error} - On non-2xx response (except 401 which redirects)
   */
  async function apiFetch(url, options = {}) {
    const token = getToken();
    
    if (!token) {
      clearAndRedirect('Session expired');
      throw new Error('No auth token');
    }

    const hasBody = options.body !== undefined && options.body !== null;
    const isStringBody = typeof options.body === 'string';
    const isFormDataBody = (typeof FormData !== 'undefined') && (options.body instanceof FormData);

    const config = {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...((hasBody && !isFormDataBody && !isStringBody) ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    };

    if (hasBody) {
      if (isFormDataBody) {
        // Let the browser set multipart boundaries
        config.body = options.body;
      } else if (isStringBody) {
        // Already serialized (avoid double-encoding)
        config.body = options.body;
        // If caller didn't specify, default to JSON for string payloads (most common case)
        if (!config.headers['Content-Type']) {
          config.headers['Content-Type'] = 'application/json';
        }
      } else {
        config.body = JSON.stringify(options.body);
      }
    }

    let response;
    try {
      response = await fetch(url, config);
    } catch (networkError) {
      console.error('[AgentConsoleAuth] Network error:', networkError);
      throw new Error('Network error - please check your connection');
    }

    // Handle 401 - force re-login
    if (response.status === 401) {
      console.warn('[AgentConsoleAuth] 401 received, redirecting to login');
      clearAndRedirect('Session expired - please log in again');
      throw new Error('Unauthorized');
    }

    // Parse response
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return null;
    }

    // Handle other errors
    if (!response.ok) {
      const errorMsg = data?.error || data?.message || `HTTP ${response.status}`;
      console.error(`[AgentConsoleAuth] API error: ${response.status}`, errorMsg);
      // Include full response data for debugging (e.g., laneFailures from truth export)
      if (data?.laneFailures) {
        console.error('[AgentConsoleAuth] Lane failures:', data.laneFailures);
      }
      const error = new Error(errorMsg);
      error.data = data; // Attach full response data
      throw error;
    }

    return data;
  }

  // Public API
  return {
    getToken,
    clearAndRedirect,
    requireAuth,
    apiFetch
  };

})();

// Also export for ES modules if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AgentConsoleAuth;
}
