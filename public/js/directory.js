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
        const ownerName = company.ownerName || 'N/A';
        const displayPhone = company.contactPhone || company.ownerPhone || 'N/A';
        const addressCity = company.address && company.address.city ? company.address.city : 'N/A';
        const addressState = company.address && company.address.state ? company.address.state : 'N/A';

        let tradeTypesDisplay = 'N/A';
        if (Array.isArray(company.tradeTypes) && company.tradeTypes.length > 0) {
            tradeTypesDisplay = company.tradeTypes.map(type => escapeHTML(type)).join(', ');
        } else if (typeof company.tradeType === 'string' && company.tradeType) {
            tradeTypesDisplay = escapeHTML(company.tradeType);
        }

        const companyId = company._id || '#';
        const isActive = typeof company.isActive === 'boolean' ? company.isActive : true;

        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-2">
                    <h3 class="text-xl font-semibold text-indigo-700 truncate" title="${escapeHTML(companyName)}">${escapeHTML(companyName)}</h3>
                    <span class="status-badge text-xs font-medium px-2.5 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <p class="text-xs text-gray-400 mb-1">ID: ${escapeHTML(companyId)}</p>
                <p class="text-sm text-gray-600 mb-1"><i class="fas fa-user-tie mr-2 text-gray-500"></i>Owner: ${escapeHTML(ownerName)}</p>
                <p class="text-sm text-gray-600 mb-1"><i class="fas fa-phone-alt mr-2 text-gray-500"></i>Contact: ${escapeHTML(displayPhone)}</p>
                <p class="text-sm text-gray-600 mb-1"><i class="fas fa-map-marker-alt mr-2 text-gray-500"></i>Location: ${escapeHTML(addressCity)}, ${escapeHTML(addressState)}</p>
                <p class="text-sm text-gray-600 mb-1"><i class="fas fa-tags mr-2 text-gray-500"></i>Trades: ${tradeTypesDisplay}</p>
            </div>
            <div class="mt-4 pt-3 border-t border-gray-200 actions flex justify-between items-center">
                <a href="/company-profile.html?id=${companyId}" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium"><i class="fas fa-eye mr-1"></i>View Profile</a>
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
        if (!confirm(`Are you sure you want to delete "${companyName}" (ID: ${companyId})? This action cannot be undone.`)) {
            return;
        }
        console.log(`[JS directory.js] Deleting company ID: ${companyId}`);
        try {
            const baseApiUrl = getBaseApiUrl();
            // --- CHANGE #2 WAS HERE ---
            const deleteApiUrl = `${baseApiUrl}/api/company/${companyId}`; // Path from routes/company.js
            console.log('[JS directory.js] Deleting company from:', deleteApiUrl);

            const response = await fetch(deleteApiUrl, {
                method: 'DELETE',
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to delete company and could not parse error.' }));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            allCompanies = allCompanies.filter(company => company._id !== companyId);
            filterAndSearchCompanies();
            alert(`Company "${companyName}" deleted successfully.`);
        } catch (error) {
            console.error('[JS directory.js] Error deleting company:', error);
            alert(`Failed to delete company: ${error.message}`);
        }
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
