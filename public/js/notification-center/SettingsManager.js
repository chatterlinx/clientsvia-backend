// ============================================================================
// ⚙️ SETTINGS MANAGER
// ============================================================================

class SettingsManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.twilioConfig = null;
        this.adminContacts = [];
    }
    
    async load() {
        console.log('⚙️ [SETTINGS] Loading settings...');
        
        try {
            await Promise.all([
                this.loadTwilioCredentials(),
                this.loadAdminContacts()
            ]);
            
            this.attachEventHandlers();
            
        } catch (error) {
            console.error('❌ [SETTINGS] Load failed:', error);
        }
    }
    
    async loadTwilioCredentials() {
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (data.success && data.data.twilio) {
                this.twilioConfig = data.data.twilio;
                this.renderTwilioCredentials();
            } else {
                this.renderTwilioCredentials();
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load Twilio credentials:', error);
            this.renderTwilioCredentials();
        }
    }
    
    renderTwilioCredentials() {
        document.getElementById('twilio-account-sid').value = this.twilioConfig?.accountSid || '';
        document.getElementById('twilio-auth-token').value = this.twilioConfig?.authToken || '';
        document.getElementById('twilio-phone-number').value = this.twilioConfig?.phoneNumber || '';
    }
    
    async saveTwilioCredentials() {
        const accountSid = document.getElementById('twilio-account-sid').value.trim();
        const authToken = document.getElementById('twilio-auth-token').value.trim();
        const phoneNumber = document.getElementById('twilio-phone-number').value.trim();
        
        if (!accountSid || !authToken || !phoneNumber) {
            this.nc.showToast('Please fill in all Twilio fields', 'error');
            return;
        }
        
        if (!accountSid.startsWith('AC')) {
            this.nc.showToast('Account SID should start with "AC"', 'error');
            return;
        }
        
        if (!phoneNumber.startsWith('+')) {
            this.nc.showToast('Phone number must be in E.164 format (e.g., +15551234567)', 'error');
            return;
        }
        
        try {
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                twilio: {
                    accountSid,
                    authToken,
                    phoneNumber
                }
            });
            
            if (data.success) {
                this.twilioConfig = data.data.twilio;
                this.nc.showToast('Twilio credentials saved successfully', 'success');
            } else {
                this.nc.showToast('Failed to save Twilio credentials', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save Twilio credentials:', error);
            this.nc.showToast('Error saving Twilio credentials', 'error');
        }
    }
    
    async loadAdminContacts() {
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (data.success && data.data.adminContacts) {
                this.adminContacts = data.data.adminContacts;
                this.renderAdminContacts();
            } else {
                this.renderAdminContacts();
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load admin contacts:', error);
            this.renderAdminContacts();
        }
    }
    
    renderAdminContacts() {
        const container = document.getElementById('admin-contacts-container');
        
        if (this.adminContacts.length === 0) {
            container.innerHTML = `
                <div class="bg-yellow-50 border-l-4 border-yellow-500 p-4">
                    <p class="text-sm text-gray-700">No admin contacts configured yet. Add your first contact below.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.adminContacts.map((contact, index) => `
            <div class="border border-gray-300 rounded-lg p-4 mb-3">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <p class="font-semibold text-gray-700">${this.nc.escapeHtml(contact.name)}</p>
                        <p class="text-sm text-gray-600 mt-1">
                            <i class="fas fa-phone mr-2"></i>${this.nc.escapeHtml(contact.phone)}
                        </p>
                        ${contact.email ? `
                            <p class="text-sm text-gray-600 mt-1">
                                <i class="fas fa-envelope mr-2"></i>${this.nc.escapeHtml(contact.email)}
                            </p>
                        ` : ''}
                        <p class="text-xs text-gray-500 mt-2">
                            Receives: 
                            ${contact.receiveSMS ? '<span class="badge badge-info">SMS</span>' : ''}
                            ${contact.receiveEmail ? '<span class="badge badge-info">Email</span>' : ''}
                            ${contact.receiveCalls ? '<span class="badge badge-info">Calls</span>' : ''}
                        </p>
                    </div>
                    <button class="text-red-600 hover:text-red-800 ml-4" data-remove-contact="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Attach remove handlers
        container.querySelectorAll('[data-remove-contact]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.getAttribute('data-remove-contact'));
                this.removeAdminContact(index);
            });
        });
    }
    
    async removeAdminContact(index) {
        if (!confirm('Are you sure you want to remove this admin contact?')) {
            return;
        }
        
        this.adminContacts.splice(index, 1);
        await this.saveAdminContacts();
    }
    
    async addAdminContact() {
        const name = prompt('Enter admin name:');
        if (!name) return;
        
        const phone = prompt('Enter phone number (E.164 format, e.g., +15551234567):');
        if (!phone) return;
        
        const email = prompt('Enter email (optional):') || '';
        
        const contact = {
            name,
            phone,
            email,
            receiveSMS: true,
            receiveEmail: !!email,
            receiveCalls: true
        };
        
        this.adminContacts.push(contact);
        await this.saveAdminContacts();
    }
    
    async saveAdminContacts() {
        try {
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                adminContacts: this.adminContacts
            });
            
            if (data.success) {
                this.nc.showToast('Admin contacts updated', 'success');
                this.renderAdminContacts();
            } else {
                this.nc.showToast('Failed to update admin contacts', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save admin contacts:', error);
            this.nc.showToast('Error saving admin contacts', 'error');
        }
    }
    
    attachEventHandlers() {
        // Twilio save button
        document.getElementById('save-twilio-btn')?.addEventListener('click', () => {
            this.saveTwilioCredentials();
        });
        
        // Add admin contact button
        document.getElementById('add-admin-contact-btn')?.addEventListener('click', () => {
            this.addAdminContact();
        });
    }
}

