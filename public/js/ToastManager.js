/**
 * ============================================================================
 * TOAST NOTIFICATION MANAGER - World-Class Notifications
 * ============================================================================
 * 
 * Features:
 * - Beautiful slide-in animations
 * - Success/Error/Info/Warning types
 * - Undo capability for reversible actions
 * - Auto-dismiss with countdown
 * - Stack multiple toasts
 * - Progress bar animation
 * - Icon support
 * - Click to dismiss
 * 
 * Usage:
 * ```javascript
 * const toast = new ToastManager();
 * toast.success('✅ Category saved successfully!');
 * toast.error('❌ Failed to save');
 * toast.info('ℹ️ Loading data...');
 * toast.warning('⚠️ Please review changes');
 * toast.withUndo('Deleted 3 items', () => { undoDelete(); });
 * ```
 */

class ToastManager {
    constructor() {
        this.toasts = [];
        this.container = null;
        this.maxToasts = 5;
        this.defaultDuration = 4000; // 4 seconds
        this.init();
    }
    
    /**
     * Initialize toast container
     */
    init() {
        // Create container if it doesn't exist
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 12px;
                pointer-events: none;
            `;
            document.body.appendChild(this.container);
        }
        
        console.log('✅ [TOAST] Manager initialized');
    }
    
    /**
     * Show success toast
     * @param {String} message - Toast message
     * @param {Number} duration - Duration in ms (default: 4000)
     */
    success(message, duration = this.defaultDuration) {
        return this.show({
            type: 'success',
            message,
            duration,
            icon: '✅',
            colors: {
                bg: '#10b981',
                border: '#059669',
                text: '#ffffff'
            }
        });
    }
    
    /**
     * Show error toast
     * @param {String} message - Toast message
     * @param {Number} duration - Duration in ms (default: 6000)
     */
    error(message, duration = 6000) {
        return this.show({
            type: 'error',
            message,
            duration,
            icon: '❌',
            colors: {
                bg: '#ef4444',
                border: '#dc2626',
                text: '#ffffff'
            }
        });
    }
    
    /**
     * Show info toast
     * @param {String} message - Toast message
     * @param {Number} duration - Duration in ms (default: 4000)
     */
    info(message, duration = this.defaultDuration) {
        return this.show({
            type: 'info',
            message,
            duration,
            icon: 'ℹ️',
            colors: {
                bg: '#3b82f6',
                border: '#2563eb',
                text: '#ffffff'
            }
        });
    }
    
    /**
     * Show warning toast
     * @param {String} message - Toast message
     * @param {Number} duration - Duration in ms (default: 5000)
     */
    warning(message, duration = 5000) {
        return this.show({
            type: 'warning',
            message,
            duration,
            icon: '⚠️',
            colors: {
                bg: '#f59e0b',
                border: '#d97706',
                text: '#ffffff'
            }
        });
    }
    
    /**
     * Show toast with undo capability
     * @param {String} message - Toast message
     * @param {Function} undoCallback - Function to call when undo is clicked
     * @param {Number} duration - Duration in ms (default: 5000)
     */
    withUndo(message, undoCallback, duration = 5000) {
        return this.show({
            type: 'undo',
            message,
            duration,
            icon: '🔄',
            undoCallback,
            colors: {
                bg: '#6b7280',
                border: '#4b5563',
                text: '#ffffff'
            }
        });
    }
    
    /**
     * Show a toast notification
     * @param {Object} options - Toast options
     */
    show(options) {
        const {
            type = 'info',
            message = '',
            duration = this.defaultDuration,
            icon = 'ℹ️',
            undoCallback = null,
            colors = {
                bg: '#3b82f6',
                border: '#2563eb',
                text: '#ffffff'
            }
        } = options;
        
        // Check max toasts
        if (this.toasts.length >= this.maxToasts) {
            this.remove(this.toasts[0].id);
        }
        
        // Create toast element
        const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.style.cssText = `
            background: ${colors.bg};
            border: 2px solid ${colors.border};
            color: ${colors.text};
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            min-width: 300px;
            max-width: 500px;
            pointer-events: auto;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            animation: slideInRight 0.3s ease-out;
            position: relative;
            overflow: hidden;
        `;
        
        // Toast content
        const content = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <span style="font-size: 24px;">${icon}</span>
                    <span style="font-weight: 600; font-size: 14px;">${message}</span>
                </div>
                ${undoCallback ? `
                    <button onclick="window.toastManager.undo('${toastId}')" style="background: rgba(255,255,255,0.3); border: 2px solid rgba(255,255,255,0.5); color: white; padding: 6px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.4)'" onmouseout="this.style.background='rgba(255,255,255,0.3)'">
                        UNDO
                    </button>
                ` : `
                    <button onclick="window.toastManager.remove('${toastId}')" style="background: transparent; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
                        ×
                    </button>
                `}
            </div>
            <div id="${toastId}-progress" style="position: absolute; bottom: 0; left: 0; height: 4px; background: rgba(255,255,255,0.5); width: 100%; transform-origin: left; transition: transform ${duration}ms linear;"></div>
        `;
        
        toast.innerHTML = content;
        
        // Click to dismiss (except on undo button)
        toast.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                this.remove(toastId);
            }
        });
        
        // Add to container
        this.container.appendChild(toast);
        
        // Store toast data
        const toastData = {
            id: toastId,
            element: toast,
            undoCallback,
            timeout: null
        };
        
        this.toasts.push(toastData);
        
        // Start progress animation
        setTimeout(() => {
            const progressBar = document.getElementById(`${toastId}-progress`);
            if (progressBar) {
                progressBar.style.transform = 'scaleX(0)';
            }
        }, 10);
        
        // Auto-dismiss
        toastData.timeout = setTimeout(() => {
            this.remove(toastId);
        }, duration);
        
        console.log(`✅ [TOAST] Showed ${type} toast:`, message);
        
        return toastId;
    }
    
    /**
     * Handle undo action
     * @param {String} toastId - Toast ID
     */
    undo(toastId) {
        const toast = this.toasts.find(t => t.id === toastId);
        
        if (toast && toast.undoCallback) {
            console.log('🔄 [TOAST] Undo triggered for:', toastId);
            
            // Call undo callback
            try {
                toast.undoCallback();
                this.success('Undo successful!', 2000);
            } catch (error) {
                console.error('❌ [TOAST] Undo failed:', error);
                this.error('Undo failed: ' + error.message);
            }
            
            // Remove toast
            this.remove(toastId);
        }
    }
    
    /**
     * Remove a toast
     * @param {String} toastId - Toast ID
     */
    remove(toastId) {
        const toastIndex = this.toasts.findIndex(t => t.id === toastId);
        
        if (toastIndex === -1) return;
        
        const toast = this.toasts[toastIndex];
        
        // Clear timeout
        if (toast.timeout) {
            clearTimeout(toast.timeout);
        }
        
        // Animate out
        if (toast.element) {
            toast.element.style.animation = 'slideOutRight 0.3s ease-in forwards';
            
            setTimeout(() => {
                if (toast.element && toast.element.parentNode) {
                    toast.element.parentNode.removeChild(toast.element);
                }
            }, 300);
        }
        
        // Remove from array
        this.toasts.splice(toastIndex, 1);
        
        console.log('🗑️ [TOAST] Removed:', toastId);
    }
    
    /**
     * Remove all toasts
     */
    clear() {
        this.toasts.forEach(toast => {
            if (toast.timeout) {
                clearTimeout(toast.timeout);
            }
            if (toast.element && toast.element.parentNode) {
                toast.element.parentNode.removeChild(toast.element);
            }
        });
        
        this.toasts = [];
        console.log('🗑️ [TOAST] Cleared all toasts');
    }
}

// ============================================
// CSS ANIMATIONS
// ============================================

// Inject CSS animations if not already present
if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
        
        /* Responsive adjustments */
        @media (max-width: 640px) {
            #toast-container {
                top: 10px !important;
                right: 10px !important;
                left: 10px !important;
            }
            
            #toast-container > div {
                min-width: 100% !important;
                max-width: 100% !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// ============================================
// GLOBAL INSTANCE
// ============================================

// Create global instance
if (!window.toastManager) {
    window.toastManager = new ToastManager();
}

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ToastManager;
}

console.log('✅ [TOAST] ToastManager loaded and ready');

