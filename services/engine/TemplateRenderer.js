function buildSlotTemplateVars(slotId, slotValue) {
    const value = `${slotValue ?? ''}`.trim();
    const vars = {
        value,
        slotValue: value,
        name: value
    };

    const bySlot = {
        'name.first': ['firstName', 'first_name', 'callerFirstName', 'caller_first_name'],
        'name.last': ['lastName', 'last_name'],
        'phone': ['phoneNumber', 'phone_number'],
        'address': ['address', 'serviceAddress', 'service_address', 'locationAddress', 'location_address'],
        'address.full': ['address', 'serviceAddress', 'service_address', 'locationAddress', 'location_address']
    };

    (bySlot[slotId] || []).forEach((k) => {
        vars[k] = value;
    });

    // Generic aliases derived from slotId parts.
    const normalized = `${slotId || ''}`.replace(/[^a-zA-Z0-9.]/g, '');
    const parts = normalized.split('.').filter(Boolean);
    if (parts.length > 0) {
        vars[parts[parts.length - 1]] = value;
        vars[parts.join('_')] = value;
    }
    return vars;
}

function renderTemplate(template, vars = {}) {
    return `${template || ''}`.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (full, key) => {
        const mapped = vars[key];
        return mapped != null && `${mapped}`.length > 0 ? `${mapped}` : full;
    });
}

function hasUnresolvedPlaceholders(text) {
    return /[{}]/.test(`${text || ''}`);
}

function defaultSlotConfirmFallback(slotId, value) {
    if (`${slotId}` === 'name.first') {
        return `Just to confirm - is your first name ${value}?`;
    }
    if (`${slotId}` === 'name.last') {
        return `Just to confirm - is your last name ${value}?`;
    }
    if (`${slotId}` === 'address' || `${slotId}` === 'address.full') {
        return `Just to confirm - is your service address ${value}?`;
    }
    return `Just to confirm - is ${value} correct?`;
}

function renderSlotTemplateOrFallback({
    template,
    slotId,
    slotValue,
    fallbackText,
    logger,
    callId,
    context = 'template_render'
}) {
    const vars = buildSlotTemplateVars(slotId, slotValue);
    const rendered = renderTemplate(template, vars);
    if (!hasUnresolvedPlaceholders(rendered)) {
        return rendered;
    }

    if (logger?.error) {
        logger.error('[TEMPLATE RENDERER] Unresolved placeholder in prompt', {
            callId,
            slotId,
            context,
            template: `${template || ''}`.substring(0, 120),
            rendered: rendered.substring(0, 120)
        });
    }
    return fallbackText || defaultSlotConfirmFallback(slotId, slotValue);
}

module.exports = {
    buildSlotTemplateVars,
    renderTemplate,
    hasUnresolvedPlaceholders,
    defaultSlotConfirmFallback,
    renderSlotTemplateOrFallback
};
