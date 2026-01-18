// ============================================================================
// 📞 TRANSFER DIRECTORY MANAGER - Unified Contact & Transfer Rules
// ============================================================================
// PURPOSE: Manage company contacts and transfer routing rules
// 
// FEATURES:
//   - Contact directory (name, phone, email, role)
//   - Transfer rules (intent triggers → contact routing)
//   - Availability hours (business hours, after-hours routing)
//   - Pre-transfer scripts (what AI says before transferring)
//
// DATA SOURCES:
//   - CheatSheetVersion.config.companyContacts[] - Contact directory
//   - CheatSheetVersion.config.transferRules[] - Transfer routing rules
//
// RUNTIME INTEGRATION:
//   - CheatSheetEngine.matchTransferRule() - Pattern matching
//   - CallFlowExecutor - Actual Twilio transfer execution
//
// ============================================================================

class TransferDirectoryManager {
    constructor(companyId) {
        console.log(`📞 [TRANSFER DIRECTORY] Initializing for company: ${companyId}`);
        this.companyId = companyId;
        this.contacts = [];
        this.transferRules = [];
        this.isDirty = false;
        
        // Predefined roles for quick setup
        this.rolePresets = [
            { id: 'customer-service', label: 'Customer Service', icon: '🎧', color: '#3b82f6' },
            { id: 'sales', label: 'Sales', icon: '💼', color: '#10b981' },
            { id: 'billing', label: 'Billing/Accounting', icon: '💰', color: '#f59e0b' },
            { id: 'technical', label: 'Technical Support', icon: '🔧', color: '#8b5cf6' },
            { id: 'manager', label: 'Manager/Supervisor', icon: '👔', color: '#ef4444' },
            { id: 'emergency', label: 'Emergency/After-Hours', icon: '🚨', color: '#dc2626' },
            { id: 'scheduling', label: 'Scheduling', icon: '📅', color: '#06b6d4' },
            { id: 'general', label: 'General Inquiries', icon: '📋', color: '#6b7280' }
        ];
        
        // Intent trigger presets
        this.intentPresets = [
            { trigger: 'billing', keywords: ['bill', 'invoice', 'payment', 'charge', 'price', 'cost', 'refund'] },
            { trigger: 'technical', keywords: ['broken', 'not working', 'problem', 'issue', 'help', 'support'] },
            { trigger: 'sales', keywords: ['buy', 'purchase', 'quote', 'estimate', 'new service', 'interested'] },
            { trigger: 'cancel', keywords: ['cancel', 'stop', 'end service', 'discontinue'] },
            { trigger: 'emergency', keywords: ['emergency', 'urgent', 'immediately', 'right now', 'asap'] },
            { trigger: 'manager', keywords: ['manager', 'supervisor', 'speak to someone', 'escalate', 'complaint'] }
        ];
    }

    // ═══════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════
    
    async init() {
        console.log('📞 [TRANSFER DIRECTORY] Loading data...');
        await this.load();
        this.render();
    }

    async load() {
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [TRANSFER DIRECTORY] No auth token');
                return;
            }

            // Load from CheatSheetVersion (live version)
            const res = await fetch(`/api/cheatsheet/${this.companyId}/live`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                console.warn('⚠️ [TRANSFER DIRECTORY] No live cheatsheet, starting fresh');
                this.contacts = [];
                this.transferRules = [];
                return;
            }

            const data = await res.json();
            this.contacts = data.config?.companyContacts || [];
            this.transferRules = data.config?.transferRules || [];
            
            console.log(`✅ [TRANSFER DIRECTORY] Loaded ${this.contacts.length} contacts, ${this.transferRules.length} rules`);
        } catch (error) {
            console.error('❌ [TRANSFER DIRECTORY] Load error:', error);
            this.contacts = [];
            this.transferRules = [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // RENDER UI
    // ═══════════════════════════════════════════════════════════════════
    
    render() {
        const container = document.getElementById('transfer-rules-list') || 
                         document.getElementById('transfer-calls-container');
        if (!container) {
            console.error('❌ [TRANSFER DIRECTORY] Container not found');
            return;
        }

        container.innerHTML = `
            <div style="padding: 0;">
                <!-- Tab Navigation -->
                <div style="display: flex; border-bottom: 2px solid #e5e7eb; margin-bottom: 20px;">
                    <button id="tab-contacts" class="transfer-tab active" onclick="window.transferDirectoryManager.switchTab('contacts')"
                        style="padding: 12px 24px; border: none; background: transparent; font-size: 14px; font-weight: 600; color: #3b82f6; border-bottom: 2px solid #3b82f6; margin-bottom: -2px; cursor: pointer;">
                        👥 Contact Directory (${this.contacts.length})
                    </button>
                    <button id="tab-rules" class="transfer-tab" onclick="window.transferDirectoryManager.switchTab('rules')"
                        style="padding: 12px 24px; border: none; background: transparent; font-size: 14px; font-weight: 600; color: #6b7280; cursor: pointer;">
                        🔀 Transfer Rules (${this.transferRules.length})
                    </button>
                </div>

                <!-- Save Button -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="color: #64748b; font-size: 13px;">
                        ${this.isDirty ? '<span style="color: #f59e0b; font-weight: 600;">⚠️ Unsaved changes</span>' : '✅ All changes saved'}
                    </div>
                    <button onclick="window.transferDirectoryManager.save()" 
                        style="background: ${this.isDirty ? '#3b82f6' : '#94a3b8'}; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;"
                        ${this.isDirty ? '' : 'disabled'}>
                        <i class="fas fa-save"></i> Save Changes
                    </button>
                </div>

                <!-- Contacts Tab Content -->
                <div id="contacts-content" style="display: block;">
                    ${this.renderContactsSection()}
                </div>

                <!-- Rules Tab Content -->
                <div id="rules-content" style="display: none;">
                    ${this.renderRulesSection()}
                </div>
            </div>
        `;
    }

    renderContactsSection() {
        return `
            <div style="margin-bottom: 16px;">
                <button onclick="window.transferDirectoryManager.addContact()"
                    style="background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                    <i class="fas fa-plus"></i> Add Contact
                </button>
            </div>

            <div id="contacts-list" style="display: flex; flex-direction: column; gap: 12px;">
                ${this.contacts.length === 0 ? this.renderEmptyContacts() : this.renderContactCards()}
            </div>
        `;
    }

    renderEmptyContacts() {
        return `
            <div style="text-align: center; padding: 48px 24px; background: #f8fafc; border-radius: 12px; border: 2px dashed #e2e8f0;">
                <i class="fas fa-users" style="font-size: 48px; color: #cbd5e1; margin-bottom: 16px;"></i>
                <h3 style="margin: 0 0 8px 0; color: #475569; font-size: 16px;">No Contacts Yet</h3>
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                    Add people the AI can transfer calls to (Customer Service, Sales, Manager, etc.)
                </p>
            </div>
        `;
    }

    renderContactCards() {
        return this.contacts.map((contact, index) => {
            const role = this.rolePresets.find(r => r.id === contact.role) || { icon: '👤', label: contact.role || 'General', color: '#6b7280' };
            
            return `
                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; border-left: 4px solid ${role.color};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <span style="font-size: 20px;">${role.icon}</span>
                                <span style="font-size: 16px; font-weight: 600; color: #1e293b;">${this.escapeHtml(contact.name || 'Unnamed')}</span>
                                <span style="background: ${role.color}20; color: ${role.color}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                                    ${role.label}
                                </span>
                                ${contact.isPrimary ? '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">⭐ Primary</span>' : ''}
                            </div>
                            <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #64748b;">
                                ${contact.phone ? `<span><i class="fas fa-phone" style="margin-right: 4px;"></i>${this.escapeHtml(contact.phone)}</span>` : ''}
                                ${contact.email ? `<span><i class="fas fa-envelope" style="margin-right: 4px;"></i>${this.escapeHtml(contact.email)}</span>` : ''}
                                ${contact.availableHours ? `<span><i class="fas fa-clock" style="margin-right: 4px;"></i>${this.escapeHtml(contact.availableHours)}</span>` : ''}
                            </div>
                            ${contact.notes ? `<div style="margin-top: 8px; padding: 8px; background: #f8fafc; border-radius: 6px; font-size: 12px; color: #475569;">${this.escapeHtml(contact.notes)}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="window.transferDirectoryManager.editContact(${index})"
                                style="background: #f1f5f9; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: #475569;">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="window.transferDirectoryManager.deleteContact(${index})"
                                style="background: #fef2f2; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: #dc2626;">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderRulesSection() {
        return `
            <div style="margin-bottom: 16px;">
                <button onclick="window.transferDirectoryManager.addRule()"
                    style="background: #8b5cf6; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                    <i class="fas fa-plus"></i> Add Transfer Rule
                </button>
            </div>

            <div id="rules-list" style="display: flex; flex-direction: column; gap: 12px;">
                ${this.transferRules.length === 0 ? this.renderEmptyRules() : this.renderRuleCards()}
            </div>
        `;
    }

    renderEmptyRules() {
        return `
            <div style="text-align: center; padding: 48px 24px; background: #f8fafc; border-radius: 12px; border: 2px dashed #e2e8f0;">
                <i class="fas fa-random" style="font-size: 48px; color: #cbd5e1; margin-bottom: 16px;"></i>
                <h3 style="margin: 0 0 8px 0; color: #475569; font-size: 16px;">No Transfer Rules Yet</h3>
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                    Define when the AI should transfer calls (e.g., "billing questions" → Accounting)
                </p>
            </div>
        `;
    }

    renderRuleCards() {
        return this.transferRules.map((rule, index) => {
            const targetContact = this.contacts.find(c => c.id === rule.contactId || c.name === rule.contactNameOrQueue);
            const role = targetContact ? this.rolePresets.find(r => r.id === targetContact.role) : null;
            
            return `
                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; ${rule.enabled === false ? 'opacity: 0.6;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <span style="font-size: 14px; font-weight: 600; color: #1e293b;">
                                    When caller says: "<span style="color: #8b5cf6;">${this.escapeHtml(rule.intentTag || 'any')}</span>"
                                </span>
                                ${rule.afterHoursOnly ? '<span style="background: #1e3a5f; color: #93c5fd; padding: 2px 8px; border-radius: 4px; font-size: 11px;">🌙 After-Hours Only</span>' : ''}
                                ${rule.enabled === false ? '<span style="background: #fef2f2; color: #dc2626; padding: 2px 8px; border-radius: 4px; font-size: 11px;">Disabled</span>' : ''}
                            </div>
                            <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">
                                → Transfer to: <strong style="color: #1e293b;">${this.escapeHtml(rule.contactNameOrQueue || targetContact?.name || 'Unknown')}</strong>
                                ${rule.phoneNumber ? ` (${this.escapeHtml(rule.phoneNumber)})` : ''}
                            </div>
                            ${rule.script ? `
                                <div style="padding: 8px 12px; background: #f0fdf4; border-left: 3px solid #10b981; border-radius: 4px; font-size: 12px; color: #166534; font-style: italic;">
                                    "${this.escapeHtml(rule.script)}"
                                </div>
                            ` : ''}
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="window.transferDirectoryManager.editRule(${index})"
                                style="background: #f1f5f9; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: #475569;">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="window.transferDirectoryManager.deleteRule(${index})"
                                style="background: #fef2f2; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: #dc2626;">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ═══════════════════════════════════════════════════════════════════
    // TAB SWITCHING
    // ═══════════════════════════════════════════════════════════════════
    
    switchTab(tab) {
        const contactsTab = document.getElementById('tab-contacts');
        const rulesTab = document.getElementById('tab-rules');
        const contactsContent = document.getElementById('contacts-content');
        const rulesContent = document.getElementById('rules-content');

        if (tab === 'contacts') {
            contactsTab.style.color = '#3b82f6';
            contactsTab.style.borderBottom = '2px solid #3b82f6';
            rulesTab.style.color = '#6b7280';
            rulesTab.style.borderBottom = 'none';
            contactsContent.style.display = 'block';
            rulesContent.style.display = 'none';
        } else {
            rulesTab.style.color = '#3b82f6';
            rulesTab.style.borderBottom = '2px solid #3b82f6';
            contactsTab.style.color = '#6b7280';
            contactsTab.style.borderBottom = 'none';
            rulesContent.style.display = 'block';
            contactsContent.style.display = 'none';
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONTACT CRUD
    // ═══════════════════════════════════════════════════════════════════
    
    addContact() {
        const modal = this.createContactModal();
        document.body.appendChild(modal);
    }

    editContact(index) {
        const contact = this.contacts[index];
        if (!contact) return;
        const modal = this.createContactModal(contact, index);
        document.body.appendChild(modal);
    }

    deleteContact(index) {
        if (confirm('Are you sure you want to delete this contact?')) {
            this.contacts.splice(index, 1);
            this.markDirty();
            this.render();
        }
    }

    createContactModal(contact = null, index = null) {
        const isEdit = contact !== null;
        const modal = document.createElement('div');
        modal.id = 'contact-modal';
        modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 24px; width: 500px; max-height: 90vh; overflow-y: auto;">
                <h3 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">
                    ${isEdit ? '✏️ Edit Contact' : '➕ Add New Contact'}
                </h3>
                
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Name *</label>
                        <input type="text" id="contact-name" value="${this.escapeHtml(contact?.name || '')}"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                            placeholder="John Smith">
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Role</label>
                        <select id="contact-role" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                            ${this.rolePresets.map(r => `<option value="${r.id}" ${contact?.role === r.id ? 'selected' : ''}>${r.icon} ${r.label}</option>`).join('')}
                        </select>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Phone *</label>
                            <input type="tel" id="contact-phone" value="${this.escapeHtml(contact?.phone || '')}"
                                style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                                placeholder="+1 (555) 123-4567">
                        </div>
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Email</label>
                            <input type="email" id="contact-email" value="${this.escapeHtml(contact?.email || '')}"
                                style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                                placeholder="john@company.com">
                        </div>
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Available Hours</label>
                        <input type="text" id="contact-hours" value="${this.escapeHtml(contact?.availableHours || '')}"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                            placeholder="Mon-Fri 9am-5pm">
                    </div>
                    
                    <div>
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569;">
                            <input type="checkbox" id="contact-primary" ${contact?.isPrimary ? 'checked' : ''}>
                            ⭐ Primary contact for this role
                        </label>
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Notes</label>
                        <textarea id="contact-notes" rows="2"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; resize: vertical;"
                            placeholder="Any special instructions for the AI...">${this.escapeHtml(contact?.notes || '')}</textarea>
                    </div>
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                    <button onclick="document.getElementById('contact-modal').remove()"
                        style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="window.transferDirectoryManager.saveContact(${index})"
                        style="padding: 10px 20px; border: none; background: #3b82f6; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">
                        ${isEdit ? 'Update Contact' : 'Add Contact'}
                    </button>
                </div>
            </div>
        `;
        
        return modal;
    }

    saveContact(index) {
        const name = document.getElementById('contact-name').value.trim();
        const phone = document.getElementById('contact-phone').value.trim();
        
        if (!name || !phone) {
            alert('Name and Phone are required');
            return;
        }

        const contactData = {
            id: index !== null ? this.contacts[index].id : `contact_${Date.now()}`,
            name,
            role: document.getElementById('contact-role').value,
            phone,
            email: document.getElementById('contact-email').value.trim(),
            availableHours: document.getElementById('contact-hours').value.trim(),
            isPrimary: document.getElementById('contact-primary').checked,
            notes: document.getElementById('contact-notes').value.trim()
        };

        if (index !== null) {
            this.contacts[index] = contactData;
        } else {
            this.contacts.push(contactData);
        }

        document.getElementById('contact-modal').remove();
        this.markDirty();
        this.render();
    }

    // ═══════════════════════════════════════════════════════════════════
    // TRANSFER RULE CRUD
    // ═══════════════════════════════════════════════════════════════════
    
    addRule() {
        const modal = this.createRuleModal();
        document.body.appendChild(modal);
    }

    editRule(index) {
        const rule = this.transferRules[index];
        if (!rule) return;
        const modal = this.createRuleModal(rule, index);
        document.body.appendChild(modal);
    }

    deleteRule(index) {
        if (confirm('Are you sure you want to delete this transfer rule?')) {
            this.transferRules.splice(index, 1);
            this.markDirty();
            this.render();
        }
    }

    createRuleModal(rule = null, index = null) {
        const isEdit = rule !== null;
        const modal = document.createElement('div');
        modal.id = 'rule-modal';
        modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 24px; width: 550px; max-height: 90vh; overflow-y: auto;">
                <h3 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">
                    ${isEdit ? '✏️ Edit Transfer Rule' : '➕ Add Transfer Rule'}
                </h3>
                
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Intent Tag (trigger phrase)</label>
                        <input type="text" id="rule-intent" value="${this.escapeHtml(rule?.intentTag || '')}"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                            placeholder="billing, emergency, manager">
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                            Common: billing, technical, sales, cancel, emergency, manager, complaint
                        </div>
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Transfer To</label>
                        <select id="rule-contact" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                            <option value="">-- Select Contact --</option>
                            ${this.contacts.map(c => `<option value="${c.id}" ${rule?.contactId === c.id || rule?.contactNameOrQueue === c.name ? 'selected' : ''}>${c.name} (${c.role})</option>`).join('')}
                            <option value="custom" ${rule?.contactNameOrQueue && !this.contacts.find(c => c.id === rule.contactId) ? 'selected' : ''}>Custom number...</option>
                        </select>
                    </div>
                    
                    <div id="custom-phone-section" style="display: ${rule?.phoneNumber && !rule?.contactId ? 'block' : 'none'};">
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Custom Phone Number</label>
                        <input type="tel" id="rule-phone" value="${this.escapeHtml(rule?.phoneNumber || '')}"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;"
                            placeholder="+1 (555) 123-4567">
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Pre-Transfer Script (what AI says)</label>
                        <textarea id="rule-script" rows="2"
                            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; resize: vertical;"
                            placeholder="Let me transfer you to our billing department...">${this.escapeHtml(rule?.script || '')}</textarea>
                    </div>
                    
                    <div style="display: flex; gap: 16px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569;">
                            <input type="checkbox" id="rule-enabled" ${rule?.enabled !== false ? 'checked' : ''}>
                            Enabled
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569;">
                            <input type="checkbox" id="rule-afterhours" ${rule?.afterHoursOnly ? 'checked' : ''}>
                            🌙 After-hours only
                        </label>
                    </div>
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                    <button onclick="document.getElementById('rule-modal').remove()"
                        style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="window.transferDirectoryManager.saveRule(${index})"
                        style="padding: 10px 20px; border: none; background: #8b5cf6; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">
                        ${isEdit ? 'Update Rule' : 'Add Rule'}
                    </button>
                </div>
            </div>
        `;
        
        // Add event listener for contact select
        setTimeout(() => {
            const select = document.getElementById('rule-contact');
            const customSection = document.getElementById('custom-phone-section');
            if (select && customSection) {
                select.addEventListener('change', () => {
                    customSection.style.display = select.value === 'custom' ? 'block' : 'none';
                });
            }
        }, 100);
        
        return modal;
    }

    saveRule(index) {
        const intentTag = document.getElementById('rule-intent').value.trim();
        const contactSelect = document.getElementById('rule-contact').value;
        
        if (!intentTag) {
            alert('Intent tag is required');
            return;
        }

        const selectedContact = this.contacts.find(c => c.id === contactSelect);
        
        const ruleData = {
            id: index !== null ? this.transferRules[index].id : `rule_${Date.now()}`,
            intentTag,
            contactId: contactSelect !== 'custom' ? contactSelect : null,
            contactNameOrQueue: selectedContact?.name || document.getElementById('rule-phone').value.trim(),
            phoneNumber: contactSelect === 'custom' ? document.getElementById('rule-phone').value.trim() : selectedContact?.phone,
            script: document.getElementById('rule-script').value.trim(),
            enabled: document.getElementById('rule-enabled').checked,
            afterHoursOnly: document.getElementById('rule-afterhours').checked,
            priority: index !== null ? this.transferRules[index].priority : 10
        };

        if (index !== null) {
            this.transferRules[index] = ruleData;
        } else {
            this.transferRules.push(ruleData);
        }

        document.getElementById('rule-modal').remove();
        this.markDirty();
        this.render();
    }

    // ═══════════════════════════════════════════════════════════════════
    // SAVE
    // ═══════════════════════════════════════════════════════════════════
    
    markDirty() {
        this.isDirty = true;
    }

    async save() {
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                alert('Not authenticated');
                return;
            }

            console.log('💾 [TRANSFER DIRECTORY] Saving...');

            // Save contacts
            const contactsRes = await fetch(`/api/cheatsheet/${this.companyId}/company-contacts`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ companyContacts: this.contacts })
            });

            if (!contactsRes.ok) {
                throw new Error('Failed to save contacts');
            }

            // Save transfer rules
            const rulesRes = await fetch(`/api/cheatsheet/${this.companyId}/transfer-rules`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ transferRules: this.transferRules })
            });

            if (!rulesRes.ok) {
                throw new Error('Failed to save transfer rules');
            }

            this.isDirty = false;
            this.render();
            
            console.log('✅ [TRANSFER DIRECTORY] Saved successfully');
            this.showToast('Transfer directory saved!', 'success');

        } catch (error) {
            console.error('❌ [TRANSFER DIRECTORY] Save error:', error);
            this.showToast(`Save failed: ${error.message}`, 'error');
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white; border-radius: 8px; font-size: 14px; font-weight: 500;
            z-index: 10000; animation: slideIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 3000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for global access
window.TransferDirectoryManager = TransferDirectoryManager;
