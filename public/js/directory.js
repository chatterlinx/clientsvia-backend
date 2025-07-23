// admin-dashboard/public/js/directory.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('[JS directory.js] DOMContentLoaded: Script initiated. (v_fetch_fix)');
    const companyListContainer = document.getElementById('company-list');
    const noCompaniesMessage = document.getElementById('no-companies-message');
    const searchInput = document.getElementById('search-company-input');
    const filterTradeSelect = document.getElementById('filter-trade-type');
    const showInactiveCheckbox = document.getElementById('show-inactive-checkbox');

    let allCompanies = []; // To store all fetched companies for filtering
    let availableTradeCategories = []; // To store fetched trade categories

    /**
     * Constructs a base URL for API calls.
     * @returns {string} The base URL (e.g., "http://localhost:4000") or an empty string for root-relative paths.
     */
    function getBaseApiUrl() {
        if (window.location.origin && window.location.origin !== "null" && window.location.origin !== "blob:") {
            return window.location.origin;
        } else if (window.location.protocol && window.location.host && window.location.protocol !== "blob:") {
            return `${window.location.protocol}//${window.location.host}`;
        }
        console.warn("[JS directory.js] Could not determine a valid window.location.origin. Using root-relative paths for API calls.");
        return ""; // Fallback to root-relative paths
    }

    /**
     * Fetches all available trade categories to populate the filter dropdown.
     */
    async function fetchAndPopulateTradeCategoriesFilter() {
        if (!filterTradeSelect) {
            console.warn('[JS directory.js] filterTradeSelect element not found.');
            return;
        }
        try {
            const baseApiUrl = getBaseApiUrl();
            const categoriesApiUrl = `${baseApiUrl}/api/trade-categories`;
            console.log('[JS directory.js] Fetching trade categories from:', categoriesApiUrl);

            const response = await fetch(categoriesApiUrl);
            if (!response.ok) {
                let errorText = `Server responded with status ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorText = errorData.message || JSON.stringify(errorData);
                } catch (e) {
                    errorText = await response.text().catch(() => errorText);
                }
                throw new Error(`Failed to fetch trade categories for filter. ${errorText}`);
            }
            availableTradeCategories = await response.json();

            while (filterTradeSelect.options.length > 1) {
                filterTradeSelect.remove(1);
            }

            if (availableTradeCategories && availableTradeCategories.length > 0) {
                availableTradeCategories.forEach(category => {
                    const option = document.createElement('option');
                    option.value = category.name;
                    option.textContent = escapeHTML(category.name);
                    filterTradeSelect.appendChild(option);
                });
            }
            console.log('[JS directory.js] Trade category filter populated.');
        } catch (error) {
            console.error('[JS directory.js] Error loading trade categories for filter:', error);
        }
    }


    /**
     * Fetches companies from the backend API.
     */
    async function fetchCompanies() {
        if (!companyListContainer) {
            console.error('[JS directory.js] Company list container not found in HTML.');
            return;
        }
        companyListContainer.innerHTML = '<p class="text-center text-gray-500 col-span-full py-10"><i class="fas fa-spinner fa-spin mr-2"></i>Loading companies...</p>';
        if(noCompaniesMessage) noCompaniesMessage.classList.add('hidden');

        try {
            const baseApiUrl = getBaseApiUrl();
            // --- CHANGE #1 WAS HERE ---
            const companiesApiUrl = `${baseApiUrl}/api/companies`;
            console.log('[JS directory.js] Fetching companies from:', companiesApiUrl);

            const response = await fetch(companiesApiUrl);
            console.log('[JS directory.js] Fetch /api/companies response status:', response.status, 'Ok:', response.ok);

            if (!response.ok) {
                let errorText = `Server responded with status ${response.status}`;
                try {
                    const errorData = await response.json(); // Try to parse JSON error
                    errorText = errorData.message || JSON.stringify(errorData);
                } catch (e) { // If not JSON, try to get text
                    errorText = await response.text().catch(() => errorText);
                }
                console.error('[JS directory.js] Fetch /api/companies not OK. Error:', errorText);
                throw new Error(`Failed to fetch companies. ${errorText}`);
            }

            const companies = await response.json();
            allCompanies = companies;
            console.log('[JS directory.js] Successfully fetched companies:', allCompanies.length);
            filterAndSearchCompanies(); // Apply initial filters
        } catch (error) {
            console.error('[JS directory.js] Error fetching companies:', error);
            if (companyListContainer) {
                companyListContainer.innerHTML = `<p class="text-center text-red-500 col-span-full py-10"><i class="fas fa-exclamation-triangle mr-2"></i>Failed to load companies. Details: ${escapeHTML(error.message)}</p>`;
            }
        }
    }

    /**
     * Renders the list of companies to the DOM.
     */
    function renderCompanies(companiesToRender) {
        if (!companyListContainer) {
            console.error('[JS directory.js] renderCompanies: companyListContainer is null.');
            return;
        }

        companyListContainer.innerHTML = '';
        // console.log('[JS directory.js] renderCompanies: Cleared companyListContainer.');

        if (!companiesToRender || companiesToRender.length === 0) {
            console.log('[JS directory.js] renderCompanies: No companies to render.');
            if (noCompaniesMessage) {
                noCompaniesMessage.classList.remove('hidden');
                // console.log('[JS directory.js] renderCompanies: "No companies" message SHOWN.');
            } else {
                companyListContainer.innerHTML = '<p class="text-center text-gray-500 col-span-full py-10">No companies found matching your criteria.</p>';
            }
        } else {
            // console.log(`[JS directory.js] renderCompanies: Rendering ${companiesToRender.length} companies.`);
            if (noCompaniesMessage) noCompaniesMessage.classList.add('hidden');

            companiesToRender.forEach((company /*, index*/) => {
                // console.log(`[JS directory.js] renderCompanies: Rendering company ${index + 1}:`, company.companyName);
                const companyCard = createCompanyCard(company);
                companyListContainer.appendChild(companyCard);
            });
            // console.log('[JS directory.js] renderCompanies: Finished rendering all company cards.');
        }
    }

    /**
     * Creates an HTML card element for a single company.
     */
    function createCompanyCard(company) {
        const card = document.createElement('div');
        card.className = 'bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 ease-in-out flex flex-col justify-between';

        const companyName = company.companyName || 'N/A';
        const companyPhone = company.companyPhone || 'N/A';
        const companyAddress = company.companyAddress || 'N/A';
        
        // Check if additional details have been added
        const hasOwnerInfo = company.ownerName && company.ownerEmail;
        const hasContactInfo = company.contactName || company.contactEmail;
        const profileStatus = hasOwnerInfo ? 'Complete' : 'Setup Needed';
        const profileStatusClass = hasOwnerInfo ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';

        const companyId = company._id || '#';
        const isActive = typeof company.isActive === 'boolean' ? company.isActive : true;

        // Simplified address display - just show the first part if it's detailed
        const displayAddress = companyAddress.length > 50 ? companyAddress.substring(0, 47) + '...' : companyAddress;

        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-2">
                    <h3 class="text-xl font-semibold text-indigo-700 truncate" title="${escapeHTML(companyName)}">${escapeHTML(companyName)}</h3>
                    <span class="status-badge text-xs font-medium px-2.5 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <p class="text-xs text-gray-400 mb-2">ID: ${escapeHTML(companyId)}</p>
                
                <div class="space-y-1 mb-3">
                    <p class="text-sm text-gray-600"><i class="fas fa-phone-alt mr-2 text-gray-500"></i>Phone: ${escapeHTML(companyPhone)}</p>
                    <p class="text-sm text-gray-600"><i class="fas fa-map-marker-alt mr-2 text-gray-500"></i>Address: ${escapeHTML(displayAddress)}</p>
                </div>
                
                <div class="mb-3">
                    <span class="text-xs font-medium px-2 py-1 rounded-full ${profileStatusClass}">
                        <i class="fas ${hasOwnerInfo ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-1"></i>
                        Profile ${profileStatus}
                    </span>
                </div>
                
                ${!hasOwnerInfo ? 
                    '<p class="text-xs text-amber-600 bg-amber-50 p-2 rounded"><i class="fas fa-info-circle mr-1"></i>Complete setup in company profile</p>' : 
                    ''
                }
            </div>
            <div class="mt-4 pt-3 border-t border-gray-200 actions flex justify-between items-center">
                <a href="/company-profile.html?id=${companyId}" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
                    <i class="fas ${hasOwnerInfo ? 'fa-eye' : 'fa-edit'} mr-1"></i>${hasOwnerInfo ? 'View Profile' : 'Complete Setup'}
                </a>
                <button data-id="${companyId}" data-name="${escapeHTML(companyName)}" class="delete-company-btn text-red-500 hover:text-red-700 text-sm font-medium"><i class="fas fa-trash-alt mr-1"></i>Delete</button>
            </div>
        `;

        const deleteButton = card.querySelector('.delete-company-btn');
        if(deleteButton) {
            deleteButton.addEventListener('click', () => handleDeleteCompany(companyId, companyName));
        }
        return card;
    }

    /**
     * Handles filtering and searching of companies.
     */
    function filterAndSearchCompanies() {
        // console.log('[JS directory.js] filterAndSearchCompanies called.');
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const selectedTrade = filterTradeSelect ? filterTradeSelect.value : '';
        const shouldShowInactive = showInactiveCheckbox ? showInactiveCheckbox.checked : false;

        // console.log(`[JS directory.js] Filters - Search: "${searchTerm}", Trade: "${selectedTrade}", Show Inactive: ${shouldShowInactive}`);

        let companiesToDisplay = allCompanies;

        if (!shouldShowInactive) {
            companiesToDisplay = companiesToDisplay.filter(company =>
                typeof company.isActive === 'boolean' ? company.isActive : true
            );
            // console.log(`[JS directory.js] Filtered for active companies. Count: ${companiesToDisplay.length}`);
        }

        const filteredCompanies = companiesToDisplay.filter(company => {
            const nameMatch = company.companyName ? company.companyName.toLowerCase().includes(searchTerm) : false;
            const ownerMatch = company.ownerName ? company.ownerName.toLowerCase().includes(searchTerm) : false;
            const cityMatch = company.address && company.address.city ? company.address.city.toLowerCase().includes(searchTerm) : false;

            let tradeTypeSearchMatch = false;
            if (Array.isArray(company.tradeTypes)) {
                tradeTypeSearchMatch = company.tradeTypes.some(type => type.toLowerCase().includes(searchTerm));
            } else if (typeof company.tradeType === 'string') {
                tradeTypeSearchMatch = company.tradeType.toLowerCase().includes(searchTerm);
            }

            const idMatch = company._id ? String(company._id).toLowerCase().includes(searchTerm) : false; // Ensure _id is string for includes

            let tradeFilterDropdownMatch = true;
            if (selectedTrade) {
                if (Array.isArray(company.tradeTypes)) {
                    tradeFilterDropdownMatch = company.tradeTypes.includes(selectedTrade);
                } else if (typeof company.tradeType === 'string') {
                    tradeFilterDropdownMatch = company.tradeType === selectedTrade;
                } else {
                    tradeFilterDropdownMatch = false;
                }
            }

            return (nameMatch || ownerMatch || cityMatch || tradeTypeSearchMatch || idMatch) && tradeFilterDropdownMatch;
        });
        renderCompanies(filteredCompanies);
    }

    /**
     * Handles the deletion of a company.
     */
    async function handleDeleteCompany(companyId, companyName) {
        // Use a modern confirmation dialog
        const confirmationHtml = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; padding: 2rem; border-radius: 8px; max-width: 500px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <div style="display: flex; align-items: center; margin-bottom: 1rem;">
                        <i class="fas fa-exclamation-triangle" style="color: #dc2626; font-size: 1.5rem; margin-right: 0.75rem;"></i>
                        <h3 style="margin: 0; color: #1f2937; font-size: 1.25rem; font-weight: 600;">Confirm Company Deletion</h3>
                    </div>
                    <p style="color: #4b5563; margin-bottom: 1.5rem; line-height: 1.5;">
                        Are you sure you want to permanently delete <strong>"${escapeHTML(companyName)}"</strong>?
                        <br><br>
                        <span style="color: #dc2626; font-weight: 500;">This action cannot be undone.</span> All company data, including:
                        <br>• Company profile and settings
                        <br>• AI personality responses
                        <br>• Configuration data
                        <br>• All cached information
                        <br><br>will be permanently removed from the system.
                    </p>
                    <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                        <button id="cancel-delete" style="padding: 0.5rem 1rem; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 6px; cursor: pointer; font-weight: 500;">
                            Cancel
                        </button>
                        <button id="confirm-delete" style="padding: 0.5rem 1rem; border: none; background: #dc2626; color: white; border-radius: 6px; cursor: pointer; font-weight: 500;">
                            <i class="fas fa-trash mr-1"></i>Delete Permanently
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Add the dialog to the page
        const dialogElement = document.createElement('div');
        dialogElement.innerHTML = confirmationHtml;
        document.body.appendChild(dialogElement);
        
        // Return a promise that resolves when user makes a choice
        return new Promise((resolve) => {
            const confirmButton = dialogElement.querySelector('#confirm-delete');
            const cancelButton = dialogElement.querySelector('#cancel-delete');
            
            const cleanup = () => {
                document.body.removeChild(dialogElement);
            };
            
            confirmButton.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });
            
            cancelButton.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
            
            // Close on ESC key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(false);
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }).then(async (confirmed) => {
            if (!confirmed) {
                return;
            }
            
            console.log(`[JS directory.js] Deleting company ID: ${companyId}`);
            
            // Show loading indicator
            const loadingHtml = `
                <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;">
                    <div style="background: white; padding: 2rem; border-radius: 8px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                        <div style="display: inline-block; width: 32px; height: 32px; border: 3px solid #f3f4f6; border-top: 3px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem;"></div>
                        <p style="margin: 0; color: #1f2937; font-weight: 500;">Deleting company...</p>
                        <p style="margin: 0.5rem 0 0 0; color: #6b7280; font-size: 0.875rem;">Please wait while we remove all data</p>
                    </div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
            
            const loadingElement = document.createElement('div');
            loadingElement.innerHTML = loadingHtml;
            document.body.appendChild(loadingElement);
            
            try {
                const baseApiUrl = getBaseApiUrl();
                const deleteApiUrl = `${baseApiUrl}/api/company/${companyId}`;
                console.log('[JS directory.js] Deleting company from:', deleteApiUrl);

                const response = await fetch(deleteApiUrl, {
                    method: 'DELETE',
                });
                
                // Remove loading indicator
                document.body.removeChild(loadingElement);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'Failed to delete company and could not parse error.' }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                
                const result = await response.json();
                console.log('[JS directory.js] Delete response:', result);
                
                // Update the UI
                allCompanies = allCompanies.filter(company => company._id !== companyId);
                filterAndSearchCompanies();
                
                // Show success message
                const successHtml = `
                    <div style="position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 10000; max-width: 400px;">
                        <div style="display: flex; align-items: center;">
                            <i class="fas fa-check-circle" style="margin-right: 0.75rem; font-size: 1.25rem;"></i>
                            <div>
                                <div style="font-weight: 600;">Company Deleted Successfully</div>
                                <div style="font-size: 0.875rem; opacity: 0.9; margin-top: 0.25rem;">"${escapeHTML(companyName)}" has been permanently removed</div>
                            </div>
                        </div>
                    </div>
                `;
                
                const successElement = document.createElement('div');
                successElement.innerHTML = successHtml;
                document.body.appendChild(successElement);
                
                // Auto-remove success message after 5 seconds
                setTimeout(() => {
                    if (document.body.contains(successElement)) {
                        document.body.removeChild(successElement);
                    }
                }, 5000);
                
            } catch (error) {
                // Remove loading indicator if it exists
                if (document.body.contains(loadingElement)) {
                    document.body.removeChild(loadingElement);
                }
                
                console.error('[JS directory.js] Error deleting company:', error);
                
                // Show error message
                const errorHtml = `
                    <div style="position: fixed; top: 20px; right: 20px; background: #dc2626; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 10000; max-width: 400px;">
                        <div style="display: flex; align-items: center;">
                            <i class="fas fa-exclamation-circle" style="margin-right: 0.75rem; font-size: 1.25rem;"></i>
                            <div>
                                <div style="font-weight: 600;">Delete Failed</div>
                                <div style="font-size: 0.875rem; opacity: 0.9; margin-top: 0.25rem;">${error.message}</div>
                            </div>
                        </div>
                    </div>
                `;
                
                const errorElement = document.createElement('div');
                errorElement.innerHTML = errorHtml;
                document.body.appendChild(errorElement);
                
                // Auto-remove error message after 8 seconds
                setTimeout(() => {
                    if (document.body.contains(errorElement)) {
                        document.body.removeChild(errorElement);
                    }
                }, 8000);
            }
        });
    }

    /** Utility function to escape HTML to prevent XSS. */
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, match => ({'&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&#039;'})[match]);
    }

    // Initial fetch of data
    fetchAndPopulateTradeCategoriesFilter(); // Populate trade filter dropdown
    fetchCompanies(); // Fetch companies and render initially

    // Add event listeners for search and filters
    if (searchInput) {
        searchInput.addEventListener('input', filterAndSearchCompanies);
    }
    if (filterTradeSelect) {
        filterTradeSelect.addEventListener('change', filterAndSearchCompanies);
    }
    if (showInactiveCheckbox) {
        showInactiveCheckbox.addEventListener('change', filterAndSearchCompanies);
        // console.log('[JS directory.js] Event listener attached to showInactiveCheckbox.');
    } else {
        console.warn('[JS directory.js] showInactiveCheckbox not found.');
    }
});
