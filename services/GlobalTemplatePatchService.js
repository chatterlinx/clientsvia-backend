/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLOBAL TEMPLATE PATCH SERVICE - MULTI-TENANT SAFE SCENARIO OPERATIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service is the ONLY allowed write path for scenario content.
 * 
 * HARD ENFORCEMENT RULES (Non-negotiable):
 * 1. All scenarios must have scope = "GLOBAL"
 * 2. All scenarios must have ownerCompanyId = null
 * 3. Updates require existing scenarioId in template
 * 4. Creates generate scenarioId server-side
 * 5. No writes to Company documents
 * 6. All operations are audited
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ALLOWED_SCENARIO_FIELDS = [
    'name',
    'triggers',
    'negativeUserPhrases',
    'keywords',
    'quickReplies',
    'fullReplies',
    'priority',
    'minConfidence',
    'stopRouting',
    'scenarioType',
    'status',
    'isActive',
    'handoffPolicy',
    'replyStrategy',
    'entityCapture',
    'preconditions',
    'effects',
    'timedFollowUp',
    'silencePolicy',
    'actionHooks',
    'ttsOverride',
    'notes'
];

const BLOCKED_FIELDS = [
    'ownerCompanyId',  // ⛔ NEVER allow client to set this
    'scope',           // ⛔ Always forced to GLOBAL
    'scenarioId'       // ⛔ Server-generated for creates
];

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class GlobalTemplatePatchService {
    
    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * MAIN PATCH METHOD - THE ONLY SAFE WRITE PATH
     * ═══════════════════════════════════════════════════════════════════════════
     * 
     * @param {string} templateId - The global template to patch
     * @param {Object} patchPayload - The patch operations
     * @param {boolean} patchPayload.dryRun - If true, returns diff without writing
     * @param {Array} patchPayload.ops - Array of operations
     * @param {string} actor - Who is performing the operation (for audit)
     * @returns {Object} Result with diff, counts, and audit info
     */
    async applyPatch(templateId, patchPayload, actor = 'system') {
        const startTime = Date.now();
        const requestId = `patch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        
        logger.info(`[GLOBAL-PATCH ${requestId}] Starting patch operation`, {
            templateId,
            actor,
            dryRun: patchPayload.dryRun,
            opsCount: patchPayload.ops?.length || 0
        });

        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        
        if (!templateId) {
            throw new Error('VALIDATION_ERROR: templateId is required');
        }

        if (!patchPayload.ops || !Array.isArray(patchPayload.ops)) {
            throw new Error('VALIDATION_ERROR: ops array is required');
        }

        // Load the template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            throw new Error(`TEMPLATE_NOT_FOUND: Template ${templateId} does not exist`);
        }

        // Validate template is a global template (not a company clone)
        if (template.scope === 'COMPANY' || template.ownerCompanyId) {
            throw new Error('CONTAMINATION_BLOCKED: Cannot patch company-scoped templates. Use global templates only.');
        }

        // ═══════════════════════════════════════════════════════════════════
        // PROCESS OPERATIONS
        // ═══════════════════════════════════════════════════════════════════
        
        const results = {
            requestId,
            templateId,
            templateName: template.name,
            dryRun: patchPayload.dryRun === true,
            actor,
            timestamp: new Date().toISOString(),
            ops: {
                total: patchPayload.ops.length,
                successful: 0,
                failed: 0,
                skipped: 0
            },
            changes: [],
            errors: [],
            diff: {
                before: {
                    scenarioCount: this._countScenarios(template),
                    triggerCount: this._countTriggers(template)
                },
                after: null
            }
        };

        for (let i = 0; i < patchPayload.ops.length; i++) {
            const op = patchPayload.ops[i];
            
            try {
                // Validate operation structure
                this._validateOperation(op, i);
                
                // Check for blocked fields
                this._checkBlockedFields(op, i);
                
                // Process based on operation type
                switch (op.op) {
                    case 'update':
                        await this._processUpdate(template, op, results, i);
                        break;
                    case 'create':
                        await this._processCreate(template, op, results, i, actor);
                        break;
                    case 'delete':
                        await this._processDelete(template, op, results, i);
                        break;
                    default:
                        throw new Error(`Unknown operation type: ${op.op}`);
                }
                
                results.ops.successful++;
                
            } catch (error) {
                results.ops.failed++;
                results.errors.push({
                    opIndex: i,
                    op: op.op,
                    scenarioId: op.scenarioId || op.newScenario?.name || 'unknown',
                    error: error.message
                });
                logger.error(`[GLOBAL-PATCH ${requestId}] Op ${i} failed:`, error.message);
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // APPLY OR DRY-RUN
        // ═══════════════════════════════════════════════════════════════════
        
        if (results.dryRun) {
            logger.info(`[GLOBAL-PATCH ${requestId}] Dry run complete - NO CHANGES WRITTEN`);
            results.diff.after = {
                scenarioCount: this._countScenarios(template),
                triggerCount: this._countTriggers(template)
            };
        } else {
            // Actually save the template
            template.updatedAt = new Date();
            template.lastUpdatedBy = actor;
            await template.save();
            
            results.diff.after = {
                scenarioCount: this._countScenarios(template),
                triggerCount: this._countTriggers(template)
            };
            
            // Audit log
            await this._auditLog({
                action: 'GLOBAL_TEMPLATE_PATCH',
                requestId,
                templateId,
                templateName: template.name,
                actor,
                opsTotal: results.ops.total,
                opsSuccessful: results.ops.successful,
                opsFailed: results.ops.failed,
                scenarioIds: results.changes.map(c => c.scenarioId),
                dryRun: false,
                durationMs: Date.now() - startTime
            });
            
            logger.info(`[GLOBAL-PATCH ${requestId}] Patch applied successfully`, {
                successful: results.ops.successful,
                failed: results.ops.failed,
                durationMs: Date.now() - startTime
            });
        }

        results.durationMs = Date.now() - startTime;
        return results;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OPERATION PROCESSORS
    // ═══════════════════════════════════════════════════════════════════════════

    _processUpdate(template, op, results, opIndex) {
        if (!op.scenarioId) {
            throw new Error('scenarioId is required for update operations');
        }

        // Find the scenario in the template
        let found = false;
        let scenarioRef = null;
        let categoryRef = null;

        for (const category of template.categories) {
            const scenario = category.scenarios.find(s => s.scenarioId === op.scenarioId);
            if (scenario) {
                found = true;
                scenarioRef = scenario;
                categoryRef = category;
                break;
            }
        }

        if (!found) {
            throw new Error(`Scenario ${op.scenarioId} not found in template`);
        }

        // Track changes
        const changes = {
            scenarioId: op.scenarioId,
            scenarioName: scenarioRef.name,
            categoryId: categoryRef.id,
            op: 'update',
            fields: []
        };

        // Apply allowed field updates
        if (op.set) {
            for (const [key, value] of Object.entries(op.set)) {
                if (ALLOWED_SCENARIO_FIELDS.includes(key)) {
                    const oldValue = scenarioRef[key];
                    scenarioRef[key] = value;
                    changes.fields.push({
                        field: key,
                        oldValue: this._summarizeValue(oldValue),
                        newValue: this._summarizeValue(value)
                    });
                } else if (BLOCKED_FIELDS.includes(key)) {
                    throw new Error(`CONTAMINATION_BLOCKED: Field '${key}' cannot be set by client`);
                }
            }
        }

        // ⚠️ HARD ENFORCEMENT: Always ensure GLOBAL scope
        scenarioRef.scope = 'GLOBAL';
        scenarioRef.ownerCompanyId = null;
        scenarioRef.updatedAt = new Date();

        results.changes.push(changes);
    }

    _processCreate(template, op, results, opIndex, actor) {
        if (!op.categoryId) {
            throw new Error('categoryId is required for create operations');
        }

        if (!op.newScenario || !op.newScenario.name) {
            throw new Error('newScenario with name is required for create operations');
        }

        // Find the category
        const category = template.categories.find(c => c.id === op.categoryId);
        if (!category) {
            throw new Error(`Category ${op.categoryId} not found in template`);
        }

        // ⚠️ HARD ENFORCEMENT: Generate scenarioId server-side
        const newScenarioId = `scenario-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        // Build new scenario with only allowed fields
        const newScenario = {
            scenarioId: newScenarioId,
            name: op.newScenario.name,
            scope: 'GLOBAL',           // ⚠️ FORCED
            ownerCompanyId: null,      // ⚠️ FORCED
            status: 'live',
            isActive: true,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: actor
        };

        // Copy allowed fields from payload
        for (const [key, value] of Object.entries(op.newScenario)) {
            if (ALLOWED_SCENARIO_FIELDS.includes(key) && key !== 'name') {
                newScenario[key] = value;
            } else if (BLOCKED_FIELDS.includes(key)) {
                throw new Error(`CONTAMINATION_BLOCKED: Field '${key}' cannot be set by client`);
            }
        }

        // Add to category
        category.scenarios.push(newScenario);

        results.changes.push({
            scenarioId: newScenarioId,
            scenarioName: newScenario.name,
            categoryId: op.categoryId,
            op: 'create',
            fields: Object.keys(newScenario)
        });
    }

    _processDelete(template, op, results, opIndex) {
        if (!op.scenarioId) {
            throw new Error('scenarioId is required for delete operations');
        }

        let found = false;
        for (const category of template.categories) {
            const index = category.scenarios.findIndex(s => s.scenarioId === op.scenarioId);
            if (index !== -1) {
                const removed = category.scenarios.splice(index, 1)[0];
                results.changes.push({
                    scenarioId: op.scenarioId,
                    scenarioName: removed.name,
                    categoryId: category.id,
                    op: 'delete'
                });
                found = true;
                break;
            }
        }

        if (!found) {
            throw new Error(`Scenario ${op.scenarioId} not found in template`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VALIDATION HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    _validateOperation(op, index) {
        if (!op.op) {
            throw new Error(`Operation at index ${index} missing 'op' field`);
        }

        const validOps = ['update', 'create', 'delete'];
        if (!validOps.includes(op.op)) {
            throw new Error(`Invalid operation type '${op.op}' at index ${index}`);
        }
    }

    _checkBlockedFields(op, index) {
        const fieldsToCheck = op.set || op.newScenario || {};
        
        for (const field of BLOCKED_FIELDS) {
            if (field in fieldsToCheck && field !== 'scenarioId') {
                throw new Error(
                    `CONTAMINATION_BLOCKED: Operation ${index} attempted to set '${field}'. ` +
                    `This field is server-controlled and cannot be set by client.`
                );
            }
        }

        // Extra check: reject any ownerCompanyId even in nested objects
        const jsonStr = JSON.stringify(fieldsToCheck);
        if (jsonStr.includes('ownerCompanyId') && jsonStr.includes(':')) {
            throw new Error(
                `CONTAMINATION_BLOCKED: Operation ${index} contains 'ownerCompanyId'. ` +
                `Global scenarios must never have ownerCompanyId set.`
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    _countScenarios(template) {
        return (template.categories || []).reduce(
            (sum, cat) => sum + (cat.scenarios || []).length, 0
        );
    }

    _countTriggers(template) {
        return (template.categories || []).reduce((sum, cat) => {
            return sum + (cat.scenarios || []).reduce((s, sc) => {
                return s + (sc.triggers || []).length;
            }, 0);
        }, 0);
    }

    _summarizeValue(value) {
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) return `[${value.length} items]`;
        if (typeof value === 'object') return '{object}';
        if (typeof value === 'string' && value.length > 50) {
            return value.substring(0, 50) + '...';
        }
        return value;
    }

    async _auditLog(entry) {
        // Log to console for now
        // TODO: Write to AuditLog collection if it exists
        logger.info(`[AUDIT] ${entry.action}`, {
            requestId: entry.requestId,
            templateId: entry.templateId,
            actor: entry.actor,
            opsSuccessful: entry.opsSuccessful,
            opsFailed: entry.opsFailed,
            scenarioIds: entry.scenarioIds,
            durationMs: entry.durationMs
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY: Generate Registry from Template (for export-registry.js)
    // ═══════════════════════════════════════════════════════════════════════════

    async generateRegistry(templateId) {
        const template = await GlobalInstantResponseTemplate.findById(templateId)
            .select('_id name version templateType categories')
            .lean();

        if (!template) {
            throw new Error(`Template ${templateId} not found`);
        }

        return {
            templateId: template._id.toString(),
            templateName: template.name,
            templateType: template.templateType,
            version: template.version,
            categories: (template.categories || []).map(cat => ({
                categoryId: cat.id,
                categoryName: cat.name,
                scenarioCount: (cat.scenarios || []).length,
                scenarios: (cat.scenarios || []).map(sc => ({
                    scenarioId: sc.scenarioId,
                    scenarioName: sc.name,
                    triggerCount: (sc.triggers || []).length,
                    status: sc.status || 'live'
                }))
            }))
        };
    }
}

module.exports = new GlobalTemplatePatchService();

