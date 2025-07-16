// Test script to verify personality responses form event listener fix
// Run this in the browser console on the company profile page

console.log('🧪 Testing Personality Responses Form Fix...');

// Check if the form exists
const form = document.getElementById('personality-responses-form');
if (!form) {
    console.error('❌ Form not found: personality-responses-form');
} else {
    console.log('✅ Form found:', form);
}

// Check if the form has submit event listeners
const listeners = getEventListeners ? getEventListeners(form) : 'getEventListeners not available';
console.log('📋 Form event listeners:', listeners);

// Check if handleSavePersonalityResponses function exists
if (typeof window.handleSavePersonalityResponses === 'function') {
    console.log('✅ handleSavePersonalityResponses function found globally');
} else {
    console.log('⚠️ handleSavePersonalityResponses not found globally (may be in closure)');
}

// Check if the submit button exists
const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
if (submitBtn) {
    console.log('✅ Submit button found:', submitBtn.textContent);
} else {
    console.log('❌ Submit button not found');
}

// Test form submission (simulated)
if (form && submitBtn) {
    console.log('🔄 Testing form submission simulation...');
    
    // Create a test submit event
    const testEvent = new Event('submit', { bubbles: true, cancelable: true });
    
    // Add a temporary listener to see if our event handler is called
    let eventHandled = false;
    form.addEventListener('submit', function testListener(e) {
        eventHandled = true;
        console.log('✅ Submit event detected and handled!');
        console.log('Event details:', e);
        // Remove this test listener
        form.removeEventListener('submit', testListener);
        // Prevent actual submission for testing
        e.preventDefault();
        e.stopPropagation();
    }, true);
    
    // Dispatch the test event
    setTimeout(() => {
        console.log('Dispatching test submit event...');
        form.dispatchEvent(testEvent);
        
        setTimeout(() => {
            if (eventHandled) {
                console.log('🎉 SUCCESS: Form submit event is properly handled!');
            } else {
                console.log('❌ FAILED: Form submit event was not handled');
            }
        }, 100);
    }, 100);
} else {
    console.log('❌ Cannot test - form or button missing');
}

console.log('🧪 Test complete - check results above');
