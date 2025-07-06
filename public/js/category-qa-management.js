// admin-dashboard/public/js/category-qa-management.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('[JS - category-qa-management.js] DOMContentLoaded: Script initiated. (v_qa_delete_active)');

    // Get categoryId and categoryName from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const categoryId = urlParams.get('categoryId');
    const categoryName = urlParams.get('categoryName'); 

    // DOM Elements
    const categoryNameDisplay = document.getElementById('category-name-display');
    const categoryIdDisplay = document.getElementById('category-id-display');
    const categoryNameInListTitle = document.getElementById('category-name-in-list-title');
    
    const qaForm = document.getElementById('add-qa-form'); 
    const qaFormTitle = document.getElementById('qa-form-title');
    const editingQaIdInput = document.getElementById('editingQaId'); 
    const questionInput = document.getElementById('newQuestion'); 
    const answerInput = document.getElementById('newAnswer');
    const keywordsInput = document.getElementById('newKeywords');
    const qaFormSubmitButton = document.getElementById('qa-form-submit-button');
    const qaFormCancelEditButton = document.getElementById('qa-form-cancel-edit-button');
    
    const qaListContainer = document.getElementById('qa-list-container');
    const noQasMessage = document.getElementById('no-qas-message');

    let currentQAs = []; 

    if (categoryNameDisplay && categoryName) {
        categoryNameDisplay.textContent = categoryName;
    } else if (categoryNameDisplay) {
        categoryNameDisplay.textContent = 'Category';
    }
    if (categoryIdDisplay && categoryId) {
        categoryIdDisplay.textContent = `Category ID: ${categoryId}`;
    } else if (categoryIdDisplay) {
        categoryIdDisplay.textContent = 'Category ID: Not found';
    }
    if (categoryNameInListTitle && categoryName) {
        categoryNameInListTitle.textContent = categoryName;
    } else if (categoryNameInListTitle) {
        categoryNameInListTitle.textContent = "this Category";
    }

    if (!categoryId) {
        console.error('[JS] No categoryId found in URL. Cannot manage Q&As.');
        if (qaListContainer) qaListContainer.innerHTML = '<p class="text-red-500 p-4">Error: No Category ID specified in the URL. Please go back to Trade Categories and select one.</p>';
        if (qaForm) qaForm.style.display = 'none'; 
        return; 
    }

    function resetQaFormToAdMode() {
        console.log('[JS] resetQaFormToAdMode: Resetting form.');
        if (qaForm) qaForm.reset();
        if (editingQaIdInput) editingQaIdInput.value = '';
        if (qaFormTitle) qaFormTitle.innerHTML = '<i class="fas fa-plus-circle mr-2 text-green-600"></i>Add New Q&A Pair';
        if (qaFormSubmitButton) {
            qaFormSubmitButton.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Q&A';
            qaFormSubmitButton.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
            qaFormSubmitButton.classList.add('bg-green-600', 'hover:bg-green-700');
            qaFormSubmitButton.disabled = false;
        }
        if (qaFormCancelEditButton) qaFormCancelEditButton.classList.add('hidden');
        if (questionInput) questionInput.focus();
    }

    async function fetchQAsForCategory() {
        if (!qaListContainer) {
            console.error('[JS] fetchQAsForCategory: qaListContainer not found.');
            return;
        }
        qaListContainer.innerHTML = '<p class="text-gray-500 italic p-4"><i class="fas fa-spinner fa-spin mr-2"></i>Loading Q&A...</p>';
        if (noQasMessage) noQasMessage.classList.add('hidden');

        try {
            const response = await fetch(`/api/trade-categories/${categoryId}/qas`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Failed to fetch Q&A data. Status: ${response.status}`);
            }
            const qas = await response.json();
            if (Array.isArray(qas)) {
                currentQAs = qas;
            } else {
                currentQAs = [];
                console.warn(`[JS] fetchQAsForCategory: Unexpected response format for category ${categoryId}.`);
            }
            console.log(`[JS] fetchQAsForCategory: Q&As for category ${categoryId}:`, currentQAs);
            renderQAs(currentQAs);
        } catch (error) {
            console.error(`[JS] fetchQAsForCategory: Error fetching Q&As for category ${categoryId}:`, error);
            if (qaListContainer) {
                qaListContainer.innerHTML = `<p class="text-red-500 p-4"><i class="fas fa-exclamation-triangle mr-2"></i>Error loading Q&A: ${error.message}</p>`;
            }
        }
    }

    function renderQAs(qas) {
        if (!qaListContainer) return;
        qaListContainer.innerHTML = ''; 

        if (!qas || qas.length === 0) {
            if (noQasMessage) noQasMessage.classList.remove('hidden');
            return;
        }
        if (noQasMessage) noQasMessage.classList.add('hidden');

        const sortedQAs = [...qas].sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
            const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
            return dateB - dateA; 
        });

        sortedQAs.forEach(qa => {
            const qaElement = document.createElement('div');
            qaElement.className = 'qa-item';
            qaElement.dataset.qaId = qa._id; 

            let keywordsText = '';
            if (qa.keywords && qa.keywords.length > 0) {
                keywordsText = `Keywords: ${qa.keywords.join(', ')}`;
            }

            qaElement.innerHTML = `
                <div>
                    <p class="qa-question"><i class="fas fa-question-circle text-blue-500 mr-2"></i>${escapeHTML(qa.question)}</p>
                    <p class="qa-answer mt-1 pl-6"><i class="fas fa-comment-dots text-green-500 mr-2"></i>${escapeHTML(qa.answer)}</p>
                    ${keywordsText ? `<p class="qa-keywords pl-6">${escapeHTML(keywordsText)}</p>` : ''}
                    <p class="text-xs text-gray-400 mt-1 pl-6">
                        Added: ${qa.createdAt ? new Date(qa.createdAt).toLocaleString() : 'N/A'}
                        ${(qa.updatedAt && qa.updatedAt !== qa.createdAt) ? `<br>Updated: ${new Date(qa.updatedAt).toLocaleString()}` : ''}
                    </p>
                </div>
                <div class="qa-actions mt-2 sm:mt-0 flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                    <button data-id="${qa._id}" class="edit-qa-btn text-sm bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-1 px-3 rounded-md flex items-center w-full sm:w-auto justify-center">
                        <i class="fas fa-edit mr-1.5"></i>Edit
                    </button>
                    <button data-id="${qa._id}" class="delete-qa-btn text-sm bg-red-500 hover:bg-red-600 text-white font-medium py-1 px-3 rounded-md flex items-center w-full sm:w-auto justify-center">
                        <i class="fas fa-trash-alt mr-1.5"></i>Delete
                    </button>
                </div>
            `;
            qaListContainer.appendChild(qaElement);
        });
        attachQAActionListeners();
    }

    function attachQAActionListeners() {
        console.log("[JS] attachQAActionListeners: Attaching listeners to Q&A buttons.");
        document.querySelectorAll('.edit-qa-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', handleEditQAInitiate); 
        });
        document.querySelectorAll('.delete-qa-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', handleDeleteQA); 
        });
    }

    async function handleQaFormSubmit(event) {
        event.preventDefault();
        if (!questionInput || !answerInput || !keywordsInput || !editingQaIdInput) {
            console.error("[JS] handleQaFormSubmit: Form input elements not found.");
            return;
        }
        const question = questionInput.value.trim();
        const answer = answerInput.value.trim();
        const keywordsString = keywordsInput.value.trim();
        const keywords = keywordsString ? keywordsString.split(',').map(kw => kw.trim()).filter(kw => kw) : [];
        const qaIdToEdit = editingQaIdInput.value;

        if (!question || !answer) {
            alert('Question and Answer are required.');
            return;
        }
        const submitButton = qaFormSubmitButton;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${qaIdToEdit ? 'Updating' : 'Adding'} Q&A...`;
        }
        const method = qaIdToEdit ? 'PATCH' : 'POST';
        const endpoint = qaIdToEdit 
            ? `/api/trade-categories/${categoryId}/qas/${qaIdToEdit}` 
            : `/api/trade-categories/${categoryId}/qas`;
        const payload = { question, answer, keywords };
        console.log(`[JS] handleQaFormSubmit: Mode: ${qaIdToEdit ? 'Edit' : 'Add'}, Endpoint: ${endpoint}, Payload:`, payload);
        try {
            const response = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(payload),
            });
            const result = await response.json(); 
            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }
            console.log(`[JS] handleQaFormSubmit: Q&A ${qaIdToEdit ? 'updated' : 'added'} successfully:`, result);
            if (qaIdToEdit) { 
                const index = currentQAs.findIndex(qa => qa._id === qaIdToEdit);
                if (index > -1) currentQAs[index] = result;
            } else { 
                currentQAs.unshift(result); 
            }
            renderQAs(currentQAs); 
            resetQaFormToAdMode();
            alert(`Q&A pair ${qaIdToEdit ? 'updated' : 'added'} successfully!`);
        } catch (error) {
            console.error(`[JS] handleQaFormSubmit: Error ${qaIdToEdit ? 'updating' : 'adding'} Q&A:`, error);
            alert(`Error ${qaIdToEdit ? 'updating' : 'adding'} Q&A: ${error.message}`);
        } finally {
            if (submitButton) { 
                submitButton.disabled = false;
                if (editingQaIdInput.value) { 
                     qaFormSubmitButton.innerHTML = '<i class="fas fa-save mr-2"></i>Update Q&A';
                } else {
                     qaFormSubmitButton.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Q&A';
                }
            }
        }
    }

    function handleEditQAInitiate(event) {
        const qaId = event.currentTarget.dataset.id;
        console.log(`[JS] handleEditQAInitiate: Initiating edit for Q&A ID ${qaId}`);
        const qaToEdit = currentQAs.find(qa => qa._id === qaId);
        if (!qaToEdit) {
            alert('Error: Q&A not found for editing.');
            console.error(`[JS] handleEditQAInitiate: Q&A with ID ${qaId} not found in currentQAs.`);
            return;
        }
        if (qaFormTitle) qaFormTitle.innerHTML = '<i class="fas fa-edit mr-2 text-yellow-500"></i>Edit Q&A Pair';
        if (questionInput) questionInput.value = qaToEdit.question;
        if (answerInput) answerInput.value = qaToEdit.answer;
        if (keywordsInput) keywordsInput.value = (qaToEdit.keywords || []).join(', ');
        if (editingQaIdInput) editingQaIdInput.value = qaId; 
        if (qaFormSubmitButton) {
            qaFormSubmitButton.innerHTML = '<i class="fas fa-save mr-2"></i>Update Q&A';
            qaFormSubmitButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            qaFormSubmitButton.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
        }
        if (qaFormCancelEditButton) qaFormCancelEditButton.classList.remove('hidden');
        if (qaForm) qaForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (questionInput) questionInput.focus();
        console.log(`[JS] handleEditQAInitiate: Form populated for Q&A ID ${qaId}`);
    }

    /**
     * Handles deleting a Q&A pair.
     */
    async function handleDeleteQA(event) {
        const qaId = event.currentTarget.dataset.id;
        const qaToDelete = currentQAs.find(qa => qa._id === qaId);
        if (!qaToDelete) {
            alert("Error: Q&A not found for deletion.");
            console.error(`[JS] handleDeleteQA: Q&A with ID ${qaId} not found for deletion.`);
            return;
        }

        if (!confirm(`Are you sure you want to delete the question: "${escapeHTML(qaToDelete.question)}"? This action cannot be undone.`)) {
            return;
        }
        console.log(`[JS] handleDeleteQA: Deleting Q&A ID ${qaId} for category ${categoryId}`);
        
        const deleteButton = event.currentTarget;
        if (deleteButton) {
            deleteButton.disabled = true;
            deleteButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Deleting...';
        }

        try {
            // *** ACTUAL API CALL FOR DELETING Q&A ***
            const response = await fetch(`/api/trade-categories/${categoryId}/qas/${qaId}`, { 
                method: 'DELETE' 
            });
            
            const result = await response.json(); 
            if (!response.ok) {
                throw new Error(result.message || `Failed to delete Q&A. Status: ${response.status}`);
            }

            // Successfully deleted on server, now update UI
            currentQAs = currentQAs.filter(qa => qa._id !== qaId);
            renderQAs(currentQAs);
            alert(result.message || 'Q&A pair deleted successfully!');
            console.log(`[JS] handleDeleteQA: Q&A ID ${qaId} deleted successfully from category ${categoryId}.`);

        } catch (error) {
            console.error('[JS] handleDeleteQA: Error deleting Q&A:', error);
            alert(`Error deleting Q&A: ${error.message}`);
            if (deleteButton) { 
                deleteButton.disabled = false;
                deleteButton.innerHTML = '<i class="fas fa-trash-alt mr-1.5"></i>Delete'; 
            }
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

    if (qaForm) {
        qaForm.addEventListener('submit', handleQaFormSubmit); 
        console.log('[JS] Event listener attached to qaForm.');
    } else {
        console.error('[JS] qaForm not found. Cannot attach listener.');
    }

    if (qaFormCancelEditButton) {
        qaFormCancelEditButton.addEventListener('click', resetQaFormToAdMode);
    }

    fetchQAsForCategory();
});
