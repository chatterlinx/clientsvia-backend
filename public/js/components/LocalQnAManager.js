/**
 * Local Company Q&A Manager - Frontend Component for V2 Tab
 * Handles AI generation from business description, displays saved Q&As
 * Integrates with /api/company/:companyId/local-qna endpoints
 * DEBUG: Added logs for troubleshooting button/API issues
 */

class LocalQnAManager {
    constructor(containerId, apiBaseUrl, companyId) {
        console.log('🔧 LocalQnAManager init called with containerId:', containerId, 'companyId:', companyId);
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('❌ LocalQnAManager: Container not found - ID:', containerId);
        } else {
            console.log('✅ LocalQnAManager: Container found');
        }
        this.apiBaseUrl = apiBaseUrl;
        this.companyId = companyId;
        this.qnas = [];
        this.init();
    }

    init() {
        console.log('🔧 LocalQnAManager: Starting init()');
        
        // Wire generate button
        const generateBtn = document.getElementById('generateProfessionalQnaBtn');
        console.log('🔧 Button search: generateProfessionalQnaBtn found?', !!generateBtn);
        if (generateBtn) {
            generateBtn.addEventListener('click', (e) => {
                console.log('🔥 Generate button clicked!');
                e.preventDefault();
                this.generateQnAs();
            });
        } else {
            console.warn('⚠️ Generate button not found - check HTML ID: generateProfessionalQnaBtn');
        }

        // Load existing Q&As
        console.log('🔧 Loading initial Q&As...');
        this.loadQnAs();

        // Edit/Delete handlers
        if (this.container) {
            this.container.addEventListener('click', (e) => {
                console.log('🔧 Click in container:', e.target.className);
                if (e.target.classList.contains('edit-qna-btn')) {
                    console.log('Edit clicked for ID:', e.target.dataset.id);
                    this.editQnA(e.target.dataset.id);
                } else if (e.target.classList.contains('delete-qna-btn')) {
                    console.log('Delete clicked for ID:', e.target.dataset.id);
                    this.deleteQnA(e.target.dataset.id);
                }
            });
        } else {
            console.error('❌ Container missing for event delegation');
        }
        console.log('✅ LocalQnAManager init complete');
    }

    async generateQnAs() {
        console.log('🚀 generateQnAs() started');
        
        const businessTypeSelect = document.getElementById('businessTypeSelect');
        const customerNeedsInput = document.getElementById('customerNeedsInput');
        
        console.log('🔍 Form elements: dropdown found?', !!businessTypeSelect, 'input found?', !!customerNeedsInput);

        if (!businessTypeSelect || !customerNeedsInput) {
            console.error('❌ Form elements missing - dropdown ID: businessTypeSelect, input ID: customerNeedsInput');
            this.showError('UI elements not found - check form IDs');
            return;
        }

        const businessType = businessTypeSelect.value;
        const description = customerNeedsInput.value.trim();
        
        console.log('📝 Generate params: type=', businessType, 'desc=', description);

        if (!businessType || !description) {
            console.warn('⚠️ Missing input: type=', businessType, 'desc length=', description.length);
            this.showError('Please select business type and enter description');
            return;
        }

        // Show loading
        const generateBtn = document.getElementById('generateProfessionalQnaBtn');
        const originalText = generateBtn ? generateBtn.textContent : 'Generate';
        if (generateBtn) {
            generateBtn.textContent = 'Generating...';
            generateBtn.disabled = true;
        }
        this.showLoading();

        try {
            console.log('🌐 Calling API:', `${this.apiBaseUrl}/company/${this.companyId}/local-qna/generate`);
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/generate`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ businessType, description })
            });
            
            console.log('📡 API Response status:', response.status, 'ok?', response.ok);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API Error response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText} - Body: ${errorText.substring(0, 200)}`);
            }

            const result = await response.json();
            console.log('✅ API Success data keys:', Object.keys(result), 'meta:', result.meta);

            if (result.success) {
                console.log('🎉 Generation success, entries:', result.meta.entriesGenerated);
                this.showSuccess(`Generated ${result.meta.entriesGenerated} professional Q&As!`);
                this.loadQnAs(); // Reload to display
                if (customerNeedsInput) customerNeedsInput.value = ''; // Clear input
            } else {
                console.error('❌ API success=false:', result.error);
                this.showError('Generation failed: ' + (result.error || 'Unknown'));
            }
        } catch (error) {
            console.error('💥 Generate error:', error);
            this.showError('Failed to generate Q&As: ' + error.message);
        } finally {
            if (generateBtn) {
                generateBtn.textContent = originalText;
                generateBtn.disabled = false;
            }
            this.hideLoading();
        }
    }

    async loadQnAs() {
        console.log('📥 loadQnAs() - fetching from API');
        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna`, {
                credentials: 'include'
            });
            
            console.log('📡 Load response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Load error:', errorText);
                throw new Error('Failed to load Q&As - Status: ' + response.status);
            }

            const result = await response.json();
            console.log('✅ Loaded Q&As count:', result.data ? result.data.length : 0);
            this.qnas = result.data || [];
            this.renderQnAs();
        } catch (error) {
            console.error('💥 Load error:', error);
            this.showError('Failed to load saved Q&As: ' + error.message);
        }
    }

    renderQnAs() {
        console.log('🎨 Rendering', this.qnas.length, 'Q&As');
        const tableBody = document.getElementById('savedQnasTableBody');
        if (!tableBody) {
            console.error('❌ Table body not found - ID: savedQnasTableBody');
            return;
        }

        tableBody.innerHTML = '';

        if (this.qnas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4">No saved Q&As yet. Generate some above!</td></tr>';
            console.log('ℹ️ No Q&As to render');
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
        const countEl = document.querySelector('.qna-count');
        if (countEl) {
            countEl.textContent = this.qnas.length;
            console.log('✅ Count updated to', this.qnas.length);
        } else {
            console.warn('⚠️ Count element not found - class: .qna-count');
        }
    }

    async editQnA(qnaId) {
        console.log('✏️ Edit Q&A:', qnaId);
        const qna = this.qnas.find(q => q._id === qnaId);
        if (!qna) {
            console.error('❌ Q&A not found for edit:', qnaId);
            return;
        }

        // Populate modal (assume IDs)
        const editQuestion = document.getElementById('editQuestionInput');
        const editAnswer = document.getElementById('editAnswerInput');
        if (editQuestion) editQuestion.value = qna.question;
        if (editAnswer) editAnswer.value = qna.answer;
        console.log('📝 Populated edit form');

        // Show modal
        const modal = document.getElementById('editQnaModal');
        if (modal) modal.style.display = 'block';

        // Save handler (assume button ID)
        const saveBtn = document.getElementById('saveEditQnaBtn');
        if (saveBtn) {
            const originalOnclick = saveBtn.onclick;
            saveBtn.onclick = async () => {
                console.log('💾 Saving edit...');
                try {
                    const updatedData = {
                        question: editQuestion ? editQuestion.value : '',
                        answer: editAnswer ? editAnswer.value : '',
                        // Add other fields if needed
                    };
                    console.log('📤 Edit data:', updatedData);

                    const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/${qnaId}`, {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updatedData)
                    });

                    console.log('📡 Edit response status:', response.status);
                    if (response.ok) {
                        this.showSuccess('Q&A updated');
                        if (modal) modal.style.display = 'none';
                        this.loadQnAs();
                    } else {
                        const errText = await response.text();
                        console.error('❌ Edit failed:', errText);
                        this.showError('Update failed: ' + errText);
                    }
                } catch (error) {
                    console.error('💥 Edit error:', error);
                    this.showError('Update error: ' + error.message);
                }
                saveBtn.onclick = originalOnclick;
            };
        }
    }

    async deleteQnA(qnaId) {
        console.log('🗑️ Delete Q&A:', qnaId);
        if (!confirm('Delete this Q&A?')) return;

        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/local-qna/${qnaId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            console.log('📡 Delete response status:', response.status);
            if (response.ok) {
                this.showSuccess('Q&A deleted');
                this.loadQnAs();
            } else {
                const errText = await response.text();
                console.error('❌ Delete failed:', errText);
                this.showError('Delete failed: ' + errText);
            }
        } catch (error) {
            console.error('💥 Delete error:', error);
            this.showError('Delete error: ' + error.message);
        }
    }

    // UI Helpers (with logs)
    showSuccess(message) {
        console.log('✅ Success toast:', message);
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
        console.error('❌ Error toast:', message);
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
        console.log('⏳ Showing loading spinner');
        const spinner = document.createElement('div');
        spinner.id = 'loadingSpinner';
        spinner.innerHTML = '<div class="spinner-border"></div> Generating Q&As...';
        spinner.className = 'loading-overlay';
        if (this.container) this.container.appendChild(spinner);
    }

    hideLoading() {
        console.log('✅ Hiding loading spinner');
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.remove();
    }
}

// Expose as global for browser <script> loading (no require)
if (typeof window !== 'undefined') {
    window.LocalQnAManager = LocalQnAManager;
    console.log('🌐 LocalQnAManager exposed as window.LocalQnAManager');
}

// Module export for Node (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocalQnAManager;
}
