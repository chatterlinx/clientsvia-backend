/**
 * Local Company Q&A Manager - Frontend Component for V2 Tab
 * Handles AI generation from business description, displays saved Q&As
 * Integrates with /api/company/:companyId/local-qna endpoints
 */

class LocalQnAManager {
    constructor(containerId, apiBaseUrl, companyId) {
        this.container = document.getElementById(containerId);
        this.apiBaseUrl = apiBaseUrl;
        this.companyId = companyId;
        this.qnas = [];
        this.init();
    }

    init() {
        // Wire generate button
        const generateBtn = document.getElementById('generateProfessionalQnaBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.generateQnAs();
            });
        } else {
            console.warn('Generate button not found - check ID');
        }

        // Load existing Q&As
        this.loadQnAs();

        // Edit/Delete handlers (delegate on table)
        this.container.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-qna-btn')) {
                this.editQnA(e.target.dataset.id);
            } else if (e.target.classList.contains('delete-qna-btn')) {
                this.deleteQnA(e.target.dataset.id);
            }
        });
    }

    async generateQnAs() {
        const businessTypeSelect = document.getElementById('businessTypeSelect');
        const customerNeedsInput = document.getElementById('customerNeedsInput');

        if (!businessTypeSelect || !customerNeedsInput) {
            this.showError('UI elements not found - check form IDs');
            return;
        }

        const businessType = businessTypeSelect.value;
        const description = customerNeedsInput.value.trim();

        if (!businessType || !description) {
            this.showError('Please select business type and enter description');
            return;
        }

        // Show loading
        const generateBtn = document.getElementById('generateProfessionalQnaBtn');
        const originalText = generateBtn.textContent;
        generateBtn.textContent = 'Generating...';
        generateBtn.disabled = true;
        this.showLoading();

        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/generate`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ businessType, description })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                this.showSuccess(`Generated ${result.meta.entriesGenerated} professional Q&As!`);
                this.loadQnAs(); // Reload to display
                customerNeedsInput.value = ''; // Clear input
            } else {
                this.showError('Generation failed: ' + result.error);
            }
        } catch (error) {
            console.error('Generation error:', error);
            this.showError('Failed to generate Q&As: ' + error.message);
        } finally {
            generateBtn.textContent = originalText;
            generateBtn.disabled = false;
            this.hideLoading();
        }
    }

    async loadQnAs() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error('Failed to load Q&As');

            const result = await response.json();
            this.qnas = result.data || [];
            this.renderQnAs();
        } catch (error) {
            console.error('Load Q&As error:', error);
            this.showError('Failed to load saved Q&As');
        }
    }

    renderQnAs() {
        const tableBody = document.getElementById('savedQnasTableBody'); // Assume tbody ID
        if (!tableBody) {
            console.warn('Table body not found - check ID: savedQnasTableBody');
            return;
        }

        tableBody.innerHTML = '';

        if (this.qnas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4">No saved Q&As yet. Generate some above!</td></tr>';
            return;
        }

        this.qnas.forEach(qna => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${qna.question.substring(0, 50)}${qna.question.length > 50 ? '...' : ''}</td>
                <td>${qna.answer.substring(0, 100)}${qna.answer.length > 100 ? '...' : ''}</td>
                <td>${qna.keywords.slice(0, 5).join(', ')}${qna.keywords.length > 5 ? '...' : ''}</td>
                <td>
                    <button class="btn btn-sm btn-primary edit-qna-btn" data-id="${qna._id}">Edit</button>
                    <button class="btn btn-sm btn-danger delete-qna-btn" data-id="${qna._id}">Delete</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Update count
        const countEl = document.querySelector('.qna-count'); // Assume class
        if (countEl) countEl.textContent = this.qnas.length;
    }

    async editQnA(qnaId) {
        const qna = this.qnas.find(q => q._id === qnaId);
        if (!qna) return;

        // Populate modal/form (assume edit modal with IDs: editQuestionInput, editAnswerInput, etc.)
        document.getElementById('editQuestionInput').value = qna.question;
        document.getElementById('editAnswerInput').value = qna.answer;
        // ... other fields ...

        // Show modal (assume ID: editQnaModal)
        document.getElementById('editQnaModal').style.display = 'block';

        // On save, call update endpoint
        const saveBtn = document.getElementById('saveEditQnaBtn');
        const originalSave = saveBtn.onclick;
        saveBtn.onclick = async () => {
            try {
                const updatedData = {
                    question: document.getElementById('editQuestionInput').value,
                    answer: document.getElementById('editAnswerInput').value,
                    // ... other fields
                };

                const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/${qnaId}`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });

                if (response.ok) {
                    this.showSuccess('Q&A updated');
                    document.getElementById('editQnaModal').style.display = 'none';
                    this.loadQnAs();
                } else {
                    this.showError('Update failed');
                }
            } catch (error) {
                this.showError('Update error: ' + error.message);
            }
            saveBtn.onclick = originalSave; // Restore
        };
    }

    async deleteQnA(qnaId) {
        if (!confirm('Delete this Q&A?')) return;

        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/${qnaId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                this.showSuccess('Q&A deleted');
                this.loadQnAs();
            } else {
                this.showError('Delete failed');
            }
        } catch (error) {
            this.showError('Delete error: ' + error.message);
        }
    }

    // UI Helpers (adapt from CompanyQnAManager patterns)
    showSuccess(message) {
        // Assume toast or alert div ID 'successToast'
        const toast = document.getElementById('successToast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        } else {
            alert('Success: ' + message);
        }
    }

    showError(message) {
        // Assume 'errorToast'
        const toast = document.getElementById('errorToast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 5000);
        } else {
            alert('Error: ' + message);
        }
    }

    showLoading() {
        // Spinner on container or button
        const spinner = document.createElement('div');
        spinner.id = 'loadingSpinner';
        spinner.innerHTML = '<div class="spinner-border"></div> Generating Q&As...';
        spinner.className = 'loading-overlay';
        this.container.appendChild(spinner);
    }

    hideLoading() {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.remove();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocalQnAManager;
}
