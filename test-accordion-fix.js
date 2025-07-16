// Test script to verify agent setup accordion functionality
// Run this in the browser console on the company profile page

console.log('🧪 Testing Agent Setup Accordion Fix...');

// Check if agent setup container exists
const agentSetupContainer = document.getElementById('agent-setup-content') || 
                           document.querySelector('[data-tab="agent-setup"]') ||
                           document.querySelector('.agent-setup-section-container');

if (!agentSetupContainer) {
    console.error('❌ Agent setup container not found');
} else {
    console.log('✅ Agent setup container found:', agentSetupContainer);
}

// Check for accordion headers
const sectionHeaders = document.querySelectorAll('.agent-setup-section-header');
console.log(`📋 Found ${sectionHeaders.length} accordion section headers`);

if (sectionHeaders.length === 0) {
    console.error('❌ No accordion section headers found');
} else {
    sectionHeaders.forEach((header, index) => {
        const sectionName = header.parentElement?.dataset?.sectionName || `section-${index}`;
        const sectionContent = header.nextElementSibling;
        const chevron = header.querySelector('i.fas.fa-chevron-up, i.fas.fa-chevron-down');
        
        console.log(`📁 Section ${index + 1}: ${sectionName}`);
        console.log('  - Header:', header);
        console.log('  - Content:', sectionContent);
        console.log('  - Chevron:', chevron);
        console.log('  - Is collapsed:', sectionContent?.classList.contains('collapsed'));
        
        // Test if click event is attached
        const listeners = getEventListeners ? getEventListeners(header) : 'getEventListeners not available';
        console.log('  - Event listeners:', listeners);
    });
}

// Test accordion functionality
console.log('🔄 Testing accordion click functionality...');

const testSection = sectionHeaders[1]; // Test second section (should be collapsed by default)
if (testSection) {
    const sectionContent = testSection.nextElementSibling;
    const chevron = testSection.querySelector('i.fas.fa-chevron-up, i.fas.fa-chevron-down');
    
    if (sectionContent && chevron) {
        console.log('🖱️ Simulating click on section:', testSection.parentElement?.dataset?.sectionName);
        
        const wasCollapsed = sectionContent.classList.contains('collapsed');
        console.log('  - Before click - Collapsed:', wasCollapsed);
        console.log('  - Before click - Chevron classes:', chevron.className);
        
        // Simulate click
        testSection.click();
        
        setTimeout(() => {
            const isCollapsed = sectionContent.classList.contains('collapsed');
            console.log('  - After click - Collapsed:', isCollapsed);
            console.log('  - After click - Chevron classes:', chevron.className);
            
            if (wasCollapsed !== isCollapsed) {
                console.log('🎉 SUCCESS: Accordion section toggled correctly!');
            } else {
                console.log('❌ FAILED: Accordion section did not toggle');
            }
            
            // Click again to restore state
            testSection.click();
        }, 100);
    } else {
        console.log('❌ Cannot test - missing content or chevron elements');
    }
} else {
    console.log('❌ Cannot test - no test section available');
}

console.log('🧪 Accordion test complete - check results above');
