// admin-dashboard/public/js/add-company.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('[JS add-company] DOMContentLoaded: Script initiated. (v_no_trades_on_init_complete_resubmit)');
    const addCompanyForm = document.getElementById('add-company-form');
    // const tradeTypesContainer = document.getElementById('tradeTypesContainer'); // Removed

    // The loadTradeTypes function has been removed as it's no longer needed.

    if (addCompanyForm) {
        addCompanyForm.addEventListener('submit', async function(event) {
            event.preventDefault(); 
            clearErrorMessages();
            console.log('[JS add-company] Form submission initiated.');

            const formData = new FormData(addCompanyForm);
            
            // Logic for selectedTradeTypes has been removed.

            // Client-side validation for tradeTypes has been removed.

            const companyData = {
                companyName: formData.get('companyName'),
                // tradeTypes: selectedTradeTypes, // Removed from here
                ownerName: formData.get('ownerName'),
                ownerEmail: formData.get('ownerEmail'),
                ownerPhone: formData.get('ownerPhone'),
                contactName: formData.get('contactName') || null,
                contactEmail: formData.get('contactEmail') || null,
                contactPhone: formData.get('contactPhone'),
                address: {
                    street: formData.get('addressStreet'),
                    city: formData.get('addressCity'),
                    state: formData.get('addressState'),
                    zip: formData.get('addressZip'),
                    country: formData.get('addressCountry')
                },
                timezone: 'America/New_York', 
            };

            console.log('[JS add-company] Full companyData being sent (JSON stringified):', JSON.stringify(companyData, null, 2));

            const submitButton = addCompanyForm.querySelector('button[type="submit"]');
            if(submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            }

            try {
                const response = await fetch('/api/companies', { 
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(companyData),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown error occurred while adding company.' }));
                    console.error('[JS add-company] API Error:', errorData);
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                
                alert('Company added successfully! Redirecting to directory...');
                window.location.href = '/directory.html'; 

            } catch (error) {
                console.error('[JS add-company] Error adding company:', error);
                displayErrorMessage(`Failed to add company: ${error.message}`, addCompanyForm);
            } finally {
                 if(submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save Company';
                }
            }
        });
        console.log('[JS add-company] Submit event listener attached to addCompanyForm.');
    } else {
        console.error('[JS add-company] addCompanyForm element NOT FOUND.');
    }

    function displayErrorMessage(message, formElement) {
        const existingError = formElement.querySelector('.error-message-add-company');
        if (existingError) {
            existingError.remove();
        }
        const errorElement = document.createElement('p');
        errorElement.className = 'error-message-add-company mt-4 text-red-600 text-sm text-center bg-red-50 p-3 rounded-md';
        errorElement.textContent = message;
        const formActions = formElement.querySelector('.flex.justify-end'); 
        if (formActions && formActions.parentNode === formElement) { 
            formElement.insertBefore(errorElement, formActions);
        } else {
            const errorContainer = document.getElementById('add-company-form-error-container'); 
            if (errorContainer) {
                errorContainer.appendChild(errorElement);
            } else {
                formElement.appendChild(errorElement); 
            }
        }
    }

    function clearErrorMessages() {
        const errorMessages = document.querySelectorAll('.error-message-add-company');
        errorMessages.forEach(msg => msg.remove());
    }

    // loadTradeTypes(); // This call was removed
});
