// admin-dashboard/public/js/trade-category-management.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('[JS - trade-category-management.js] DOMContentLoaded: Script initiated. (v_navigate_to_qa)');

    const addCategoryForm = document.getElementById('add-trade-category-form');
    const newCategoryNameInput = document.getElementById('newCategoryName');
    const newCategoryDescriptionInput = document.getElementById('newCategoryDescription');
    const categoryListContainer = document.getElementById('trade-category-list');
    const noCategoriesMessage = document.getElementById('no-categories-message');

    let allTradeCategories = []; 

    async function fetchTradeCategories() {
        if (!categoryListContainer) {
            console.error('[JS] fetchTradeCategories: categoryListContainer element NOT FOUND.');
            return;
        }
        console.log('[JS] fetchTradeCategories: Setting "Loading categories..." message.');
        categoryListContainer.innerHTML = '<p class="text-gray-500 italic p-4"><i class="fas fa-spinner fa-spin mr-2"></i>Loading categories...</p>';
        if (noCategoriesMessage) noCategoriesMessage.classList.add('hidden');

        try {
            const response = await fetch('/api/trade-categories');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Failed to fetch categories. Status: ${response.status}`);
            }
            allTradeCategories = await response.json();
            console.log('[JS] fetchTradeCategories: Successfully fetched categories:', allTradeCategories);
            renderTradeCategories(allTradeCategories);
        } catch (error) {
            console.error('[JS] fetchTradeCategories: Error fetching categories:', error);
            if (categoryListContainer) {
                categoryListContainer.innerHTML = `<p class="text-red-500 p-4"><i class="fas fa-exclamation-triangle mr-2"></i>Error loading categories: ${error.message}</p>`;
            }
        }
    }

    function renderTradeCategories(categories) {
        if (!categoryListContainer) {
            console.error('[JS] renderTradeCategories: categoryListContainer is NULL. Cannot render.');
            return;
        }
        console.log('[JS] renderTradeCategories: Starting. Current innerHTML of list container before clear:', categoryListContainer.innerHTML);
        
        categoryListContainer.innerHTML = ''; 
        console.log('[JS] renderTradeCategories: Cleared innerHTML. List container innerHTML is now empty.');


        if (!categories || categories.length === 0) {
            console.log('[JS] renderTradeCategories: No categories to render or categories array is empty.');
            if (noCategoriesMessage) {
                noCategoriesMessage.classList.remove('hidden');
                console.log('[JS] renderTradeCategories: "No categories" message SHOWN.');
            }
            return;
        }

        console.log(`[JS] renderTradeCategories: Processing ${categories.length} categories.`);
        if (noCategoriesMessage) {
            noCategoriesMessage.classList.add('hidden');
            console.log('[JS] renderTradeCategories: "No categories" message HIDDEN.');
        }

        categories.forEach((category, index) => {
            console.log(`[JS] renderTradeCategories: Loop ${index + 1} - Processing category:`, category);
            if (!category || typeof category.name === 'undefined' || typeof category._id === 'undefined') { 
                console.error(`[JS] renderTradeCategories: Loop ${index + 1} - Invalid category object or missing name/_id:`, category);
                return; 
            }

            const categoryElement = document.createElement('div');
            categoryElement.className = 'category-item p-4'; 
            categoryElement.dataset.categoryId = category._id;

            categoryElement.innerHTML = `
                <div class="flex-grow">
                    <h3 class="font-semibold text-lg text-indigo-700">${escapeHTML(category.name)}</h3>
                    <p class="text-sm text-gray-600 mt-1">${escapeHTML(category.description || 'No description provided.')}</p>
                    <p class="text-xs text-gray-400 mt-1">ID: ${category._id}</p>
                </div>
                <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-2 sm:mt-0">
                    <button data-id="${category._id}" data-name="${escapeHTML(category.name)}" class="manage-qa-btn text-sm bg-blue-500 hover:bg-blue-600 text-white font-medium py-1.5 px-3 rounded-md flex items-center w-full sm:w-auto justify-center">
                        <i class="fas fa-book-open mr-1.5"></i>Manage Q&A
                    </button>
                    <button data-id="${category._id}" data-name="${escapeHTML(category.name)}" class="edit-category-btn text-sm bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-1.5 px-3 rounded-md flex items-center w-full sm:w-auto justify-center">
                        <i class="fas fa-edit mr-1.5"></i>Edit
                    </button>
                    <button data-id="${category._id}" data-name="${escapeHTML(category.name)}" class="delete-category-btn text-sm bg-red-500 hover:bg-red-600 text-white font-medium py-1.5 px-3 rounded-md flex items-center w-full sm:w-auto justify-center">
                        <i class="fas fa-trash-alt mr-1.5"></i>Delete
                    </button>
                </div>
            `;
            try {
                categoryListContainer.appendChild(categoryElement);
                console.log(`[JS] renderTradeCategories: Loop ${index + 1} - Appended category element for: ${category.name}`);
            } catch (e) {
                console.error(`[JS] renderTradeCategories: Loop ${index + 1} - Error appending child for category ${category.name}:`, e);
            }
        });
        
        console.log('[JS] renderTradeCategories: Finished appending all category elements. Final innerHTML of list container:', categoryListContainer.innerHTML);
        attachCategoryActionListeners();
    }
    
    function attachCategoryActionListeners() {
        console.log('[JS] attachCategoryActionListeners: Attaching listeners...');
        document.querySelectorAll('.edit-category-btn').forEach(btn => {
            // Clone and replace to remove old listeners, then add new one
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                const categoryId = e.currentTarget.dataset.id;
                const categoryName = e.currentTarget.dataset.name;
                handleEditCategory(categoryId, categoryName);
            });
        });
        document.querySelectorAll('.delete-category-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                const categoryId = e.currentTarget.dataset.id;
                const categoryName = e.currentTarget.dataset.name;
                handleDeleteCategory(categoryId, categoryName);
            });
        });
        document.querySelectorAll('.manage-qa-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                const categoryId = e.currentTarget.dataset.id;
                const categoryName = e.currentTarget.dataset.name;
                console.log(`[JS] Navigating to Q&A for category: ${categoryName} (ID: ${categoryId})`);
                window.location.href = `/category-qa-management.html?categoryId=${categoryId}&categoryName=${encodeURIComponent(categoryName)}`;
            });
        });
        console.log('[JS] attachCategoryActionListeners: Listeners attached.');
    }

    async function handleAddCategory(event) {
        event.preventDefault();
        if (!newCategoryNameInput || !newCategoryDescriptionInput) {
            console.error("[JS] handleAddCategory: Form input elements not found.");
            return;
        }
        const categoryName = newCategoryNameInput.value.trim();
        const categoryDescription = newCategoryDescriptionInput.value.trim();
        if (!categoryName) {
            alert('Category name is required.');
            newCategoryNameInput.focus();
            return;
        }
        const submitButton = addCategoryForm.querySelector('button[type="submit"]');
        if(submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Adding...';
        }
        try {
            const response = await fetch('/api/trade-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ 
                    newCategoryName: categoryName, 
                    newCategoryDescription: categoryDescription 
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }
            console.log('[JS] handleAddCategory: Category added successfully:', result);
            allTradeCategories.push(result); 
            allTradeCategories.sort((a, b) => a.name.localeCompare(b.name)); 
            renderTradeCategories(allTradeCategories);
            addCategoryForm.reset(); 
            alert(`Trade category "${categoryName}" added successfully!`);
        } catch (error) {
            console.error('[JS] handleAddCategory: Error adding category:', error);
            alert(`Error adding category: ${error.message}`);
        } finally {
            if(submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Category';
            }
        }
    }

    async function handleEditCategory(categoryId, currentName) {
        const newName = prompt(`Enter new name for category "${currentName}":`, currentName);
        if (newName === null || newName.trim() === "") { 
            if (newName !== null && newName.trim() === "") alert("Category name cannot be empty.");
            return;
        }
        const category = allTradeCategories.find(cat => cat._id === categoryId);
        const newDescription = prompt(`Enter new description for category "${newName.trim()}":`, category ? category.description : "");
        if (newDescription === null) return; 

        console.log(`[JS] handleEditCategory: Updating category ID ${categoryId} to Name: "${newName.trim()}", Desc: "${newDescription.trim()}"`);
        try {
            const response = await fetch(`/api/trade-categories/${categoryId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `Failed to update category. Status: ${response.status}`);
            }
            const index = allTradeCategories.findIndex(cat => cat._id === categoryId);
            if (index > -1) allTradeCategories[index] = result; 
            allTradeCategories.sort((a, b) => a.name.localeCompare(b.name));
            renderTradeCategories(allTradeCategories);
            alert(`Category "${result.name}" updated successfully!`);
        } catch (error) {
            console.error('[JS] handleEditCategory: Error:', error);
            alert(`Error updating category: ${error.message}`);
        }
    }

    async function handleDeleteCategory(categoryId, categoryName) {
        if (!confirm(`Are you sure you want to delete the category "${categoryName}" (ID: ${categoryId})? This action cannot be undone and might affect companies using this category.`)) {
            return;
        }
        console.log(`[JS] handleDeleteCategory: Deleting category ID ${categoryId}`);
        try {
            const response = await fetch(`/api/trade-categories/${categoryId}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `Failed to delete category. Status: ${response.status}`);
            }
            allTradeCategories = allTradeCategories.filter(cat => cat._id !== categoryId);
            renderTradeCategories(allTradeCategories);
            alert(result.message || `Category "${categoryName}" deleted successfully!`);
        } catch (error) {
            console.error('[JS] handleDeleteCategory: Error:', error);
            alert(`Error deleting category: ${error.message}`);
        }
    }

    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    if (addCategoryForm) {
        addCategoryForm.addEventListener('submit', handleAddCategory);
        console.log('[JS] Event listener attached to addCategoryForm.');
    } else {
        console.error('[JS] addCategoryForm not found. Cannot attach listener.');
    }
    fetchTradeCategories();
});
