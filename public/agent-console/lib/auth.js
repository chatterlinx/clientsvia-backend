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
   * Check if user is authenticated, redirect if not
   * @returns {boolean}
   */
  function requireAuth() {
    const token = getToken();
    if (!token) {
      clearAndRedirect('Please log in to access Agent Console');
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

    const config = {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
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
      throw new Error(errorMsg);
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
