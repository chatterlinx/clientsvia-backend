// public/js/suggested-knowledge-management.js

document.addEventListener('DOMContentLoaded', () => {
    const entriesListDiv = document.getElementById('suggested-entries-list');
    const searchInput = document.getElementById('search-query');
    const filterStatus = document.getElementById('filter-status');
    const refreshButton = document.getElementById('refresh-entries');

    // Helper to show toast notifications
    function showToast(message, type = 'success', duration = 3000) {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast-notification show ${type}`;
        setTimeout(() => {
            toast.className = toast.className.replace('show', '');
        }, duration);
    }

    // Fetch and render suggested knowledge entries
    async function fetchAndRenderEntries() {
        entriesListDiv.innerHTML = '<p class="text-center text-gray-500">Loading suggested entries...</p>';
        const query = searchInput.value.trim();
        const statusFilter = filterStatus.value;

        let url = '/api/suggestions';
        const params = new URLSearchParams();
        if (query) params.append('query', query);
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (params.toString()) url += `?${params.toString()}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const entries = await response.json();

            entriesListDiv.innerHTML = '';
            if (entries.length === 0) {
                entriesListDiv.innerHTML = '<p class="text-center text-gray-500">No suggested entries found.</p>';
                return;
            }

            entries.forEach(entry => {
                const entryCard = document.createElement('div');
                entryCard.className = 'bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200';
                entryCard.innerHTML = `
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="font-semibold text-indigo-700">${entry.category || 'N/A'}</h4>
                        <span class="px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(entry.status)}">
                            ${entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        </span>
                    </div>
                    <p class="text-sm text-gray-800 mb-1"><strong>Q:</strong> ${entry.question}</p>
                    <p class="text-sm text-gray-600 mb-3"><strong>Suggested A:</strong> ${entry.suggestedAnswer}</p>
                    <div class="text-xs text-gray-500 mb-3">
                        Created: ${new Date(entry.createdAt).toLocaleString()}
                        ${entry.updatedAt && entry.createdAt !== entry.updatedAt ? ` | Updated: ${new Date(entry.updatedAt).toLocaleString()}` : ''}
                        ${entry.originalCallSid ? ` | Call SID: ${entry.originalCallSid}` : ''}
                    </div>
                    <div class="flex space-x-2">
                        <button class="approve-btn px-3 py-1 bg-green-500 text-white rounded-md text-sm hover:bg-green-600" data-id="${entry._id}">Approve & Add to KB</button>
                        <button class="edit-btn px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600" data-id="${entry._id}">Edit</button>
                        <button class="reject-btn px-3 py-1 bg-yellow-500 text-white rounded-md text-sm hover:bg-yellow-600" data-id="${entry._id}">Reject</button>
                        <button class="delete-btn px-3 py-1 bg-red-500 text-white rounded-md text-sm hover:bg-red-600" data-id="${entry._id}">Delete</button>
                    </div>
                `;
                entriesListDiv.appendChild(entryCard);
            });

            attachEventListeners();

        } catch (error) {
            console.error('Error fetching suggested entries:', error);
            entriesListDiv.innerHTML = '<p class="text-center text-red-500">Failed to load suggested entries.</p>';
            showToast('Failed to load suggested entries.', 'error');
        }
    }

    function getStatusClass(status) {
        switch (status) {
            case 'pending': return 'bg-blue-100 text-blue-800';
            case 'reviewed': return 'bg-purple-100 text-purple-800';
            case 'approved': return 'bg-green-100 text-green-800';
            case 'rejected': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    }

    // Attach event listeners to dynamically created buttons
    function attachEventListeners() {
        entriesListDiv.querySelectorAll('.approve-btn').forEach(button => {
            button.onclick = (e) => handleApprove(e.target.dataset.id);
        });
        entriesListDiv.querySelectorAll('.edit-btn').forEach(button => {
            button.onclick = (e) => handleEdit(e.target.dataset.id);
        });
        entriesListDiv.querySelectorAll('.reject-btn').forEach(button => {
            button.onclick = (e) => handleReject(e.target.dataset.id);
        });
        entriesListDiv.querySelectorAll('.delete-btn').forEach(button => {
            button.onclick = (e) => handleDelete(e.target.dataset.id);
        });
    }

    // Handle approving an entry
    async function handleApprove(id) {
        if (!confirm('Are you sure you want to approve this entry and add it to the main Knowledge Base?')) return;
        try {
            const response = await fetch(`/api/suggestions/${id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            showToast('Entry approved and added to KB successfully!');
            fetchAndRenderEntries();
        } catch (error) {
            console.error('Error approving entry:', error);
            showToast('Failed to approve entry.', 'error');
        }
    }

    // Handle editing an entry (simplified: will prompt for new values)
    async function handleEdit(id) {
        try {
            const response = await fetch(`/api/suggestions/${id}`);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const entry = await response.json();

            const newQuestion = prompt('Edit Question:', entry.question);
            const newSuggestedAnswer = prompt('Edit Suggested Answer:', entry.suggestedAnswer);
            const newCategory = prompt('Edit Category (optional):', entry.category || '');

            if (newQuestion === null || newSuggestedAnswer === null || newCategory === null) return; // User cancelled

            const updateResponse = await fetch(`/api/suggestions/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: newQuestion, suggestedAnswer: newSuggestedAnswer, category: newCategory, status: 'reviewed' })
            });
            if (!updateResponse.ok) throw new Error(`HTTP error! Status: ${updateResponse.status}`);
            showToast('Entry updated successfully!');
            fetchAndRenderEntries();
        } catch (error) {
            console.error('Error editing entry:', error);
            showToast('Failed to edit entry.', 'error');
        }
    }

    // Handle rejecting an entry
    async function handleReject(id) {
        if (!confirm('Are you sure you want to reject this entry? It will be marked as rejected.')) return;
        try {
            const response = await fetch(`/api/suggestions/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'rejected' })
            });
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            showToast('Entry rejected.', 'info');
            fetchAndRenderEntries();
        } catch (error) {
            console.error('Error rejecting entry:', error);
            showToast('Failed to reject entry.', 'error');
        }
    }

    // Handle deleting an entry
    async function handleDelete(id) {
        if (!confirm('Are you sure you want to permanently delete this suggested entry?')) return;
        try {
            const response = await fetch(`/api/suggestions/${id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            showToast('Entry deleted permanently!', 'info');
            fetchAndRenderEntries();
        } catch (error) {
            console.error('Error deleting entry:', error);
            showToast('Failed to delete entry.', 'error');
        }
    }

    // Event listeners for search and filter
    searchInput.addEventListener('input', fetchAndRenderEntries);
    filterStatus.addEventListener('change', fetchAndRenderEntries);
    refreshButton.addEventListener('click', fetchAndRenderEntries);

    // Initial fetch on page load
    fetchAndRenderEntries();
});
