/**
 * Diagnostic script to check Variables tab rendering
 * Run this in browser console to debug rendering issues
 */

console.log('🔍 [DIAGNOSTIC] Starting Variables Manager check...\n');

// Check 1: Is VariablesManager loaded?
console.log('1️⃣ Checking if VariablesManager class exists...');
console.log('   VariablesManager:', typeof VariablesManager !== 'undefined' ? '✅ Loaded' : '❌ Not found');

// Check 2: Is variablesManager instance created?
console.log('\n2️⃣ Checking variablesManager instance...');
if (typeof variablesManager !== 'undefined') {
    console.log('   Instance: ✅ Exists');
    console.log('   Company ID:', variablesManager.companyId);
    console.log('   Variable Definitions:', variablesManager.variableDefinitions);
    console.log('   Variables:', variablesManager.variables);
} else {
    console.log('   Instance: ❌ Not found');
}

// Check 3: Container element
console.log('\n3️⃣ Checking container element...');
const container = document.getElementById('variables-container');
if (container) {
    console.log('   Container: ✅ Found');
    console.log('   Children count:', container.children.length);
    console.log('   First 500 chars of innerHTML:', container.innerHTML.substring(0, 500));
} else {
    console.log('   Container: ❌ Not found');
}

// Check 4: What render method is being called?
console.log('\n4️⃣ Checking render methods...');
if (typeof variablesManager !== 'undefined') {
    console.log('   render() exists:', typeof variablesManager.render === 'function' ? '✅' : '❌');
    console.log('   renderEmpty() exists:', typeof variablesManager.renderEmpty === 'function' ? '✅' : '❌');
    
    // Check for new UI markers
    if (container && container.innerHTML.includes('Purple gradient')) {
        console.log('   UI Style: ✅ NEW (Purple hero header detected)');
    } else if (container && container.innerHTML.includes('No Template Active')) {
        console.log('   UI Style: 🟡 NEW Empty State');
    } else if (container && container.innerHTML.includes('No Template Loaded')) {
        console.log('   UI Style: ❌ OLD Empty State (upgrade needed)');
    } else {
        console.log('   UI Style: ❓ Unknown');
    }
}

// Check 5: Test rendering manually
console.log('\n5️⃣ Testing manual render...');
if (typeof variablesManager !== 'undefined' && container) {
    console.log('   Triggering renderEmpty() manually...');
    try {
        variablesManager.renderEmpty();
        console.log('   ✅ Render executed successfully');
        console.log('   Updated innerHTML (first 500 chars):', container.innerHTML.substring(0, 500));
    } catch (error) {
        console.log('   ❌ Render failed:', error.message);
    }
}

console.log('\n✅ Diagnostic complete!');

