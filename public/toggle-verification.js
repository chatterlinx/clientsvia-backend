// Toggle Switch Verification Script
// Run this in the browser console on the ai-agent-intelligence.html page

console.log('🔧 Starting Toggle Switch Verification...');

// Check if all toggle elements exist
const toggleIds = ['contextualMemory', 'dynamicReasoning', 'smartEscalation', 'autoLearningQueue', 'realTimeOptimization'];
let allTogglesFound = true;

console.log('\n1. Checking Toggle Elements:');
toggleIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        console.log(`✅ ${id}: Found`);
    } else {
        console.log(`❌ ${id}: NOT FOUND`);
        allTogglesFound = false;
    }
});

if (allTogglesFound) {
    console.log('\n2. Testing Toggle States:');
    toggleIds.forEach(id => {
        const toggle = document.getElementById(id);
        console.log(`${id}: ${toggle.checked ? 'ON' : 'OFF'}`);
    });

    console.log('\n3. Testing Toggle Clicks:');
    toggleIds.forEach(id => {
        const toggle = document.getElementById(id);
        const originalState = toggle.checked;
        
        // Simulate click
        toggle.click();
        const newState = toggle.checked;
        
        if (originalState !== newState) {
            console.log(`✅ ${id}: Click working (${originalState} → ${newState})`);
        } else {
            console.log(`❌ ${id}: Click NOT working (stayed ${originalState})`);
        }
        
        // Reset to original state
        toggle.checked = originalState;
    });

    console.log('\n4. Testing Save Function:');
    if (typeof saveIntelligenceSettings === 'function') {
        console.log('✅ saveIntelligenceSettings function exists');
    } else {
        console.log('❌ saveIntelligenceSettings function NOT FOUND');
    }

    console.log('\n5. Testing Event Listeners:');
    // Test if event listeners are attached
    toggleIds.forEach(id => {
        const toggle = document.getElementById(id);
        const events = getEventListeners ? getEventListeners(toggle) : null;
        if (events && events.change && events.change.length > 0) {
            console.log(`✅ ${id}: Has change event listeners`);
        } else {
            console.log(`⚠️  ${id}: No change event listeners detected`);
        }
    });

} else {
    console.log('❌ Cannot continue testing - some toggle elements are missing');
}

console.log('\n🎯 Verification Complete!');
console.log('To test manually:');
console.log('1. Select "Test Company (Debug)" from the dropdown');
console.log('2. Click each toggle in the Intelligence & Memory section');
console.log('3. Check console for change logs');
console.log('4. Click "Save Intelligence Settings" button');
