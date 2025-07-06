// admin-dashboard/routes/tradeCategories.js

const express = require('express');
const router = express.Router();
const { getDB } = require('../db'); 
const { ObjectId } = require('mongodb');

// Diagnostic log to confirm this file is loaded by Express
console.log('--- tradeCategories.js router loading ---'); 

const CATEGORY_COLLECTION = 'tradeCategories'; 

/**
 * @route   POST /api/trade-categories
 * @desc    Add a new trade category
 */
router.post('/', async (req, res) => {
    const { newCategoryName, newCategoryDescription } = req.body;
    console.log('[API POST /api/trade-categories] Received data:', req.body);

    if (!newCategoryName || typeof newCategoryName !== 'string' || newCategoryName.trim() === '') {
        return res.status(400).json({ message: 'Category name is required and must be a non-empty string.' });
    }

    const db = getDB();
    if (!db) {
        console.error('[API POST /api/trade-categories] Database not connected');
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        const categoryNameTrimmed = newCategoryName.trim();
        const existingCategory = await tradeCategoriesCollection.findOne({ 
            name: { $regex: `^${categoryNameTrimmed}$`, $options: 'i' } 
        });

        if (existingCategory) {
            console.warn(`[API POST /api/trade-categories] Category already exists: ${categoryNameTrimmed}`);
            return res.status(409).json({ message: `Trade category '${categoryNameTrimmed}' already exists.` });
        }

        const newCategory = {
            name: categoryNameTrimmed,
            description: (newCategoryDescription || '').trim(),
            commonQAs: [], 
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await tradeCategoriesCollection.insertOne(newCategory);

        if (result.acknowledged && result.insertedId) {
            const createdCategory = await tradeCategoriesCollection.findOne({ _id: result.insertedId });
            console.log('[API POST /api/trade-categories] Trade category added successfully:', createdCategory);
            res.status(201).json(createdCategory);
        } else {
            console.error('[API POST /api/trade-categories] Database insert failed. Result:', result);
            throw new Error('Failed to insert trade category into database.');
        }
    } catch (error) {
        console.error('[API POST /api/trade-categories] Error adding trade category:', error.message, error.stack);
        res.status(500).json({ message: `Error adding trade category: ${error.message}` });
    }
});

/**
 * @route   GET /api/trade-categories
 * @desc    Get all trade categories
 */
router.get('/', async (req, res) => {
    console.log('[API GET /api/trade-categories] Fetching all trade categories.');
    const db = getDB();
    if (!db) {
        console.error('[API GET /api/trade-categories] Database not connected');
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        const categories = await tradeCategoriesCollection.find({}).sort({ name: 1 }).toArray(); 
        console.log(`[API GET /api/trade-categories] Found ${categories.length} categories.`);
        res.json(categories);
    } catch (error) {
        console.error('[API GET /api/trade-categories] Error fetching trade categories:', error.message, error.stack);
        res.status(500).json({ message: `Error fetching trade categories: ${error.message}` });
    }
});

// ========================================================================
// == NEW ENDPOINT TO FETCH FORMATTED Q&A FOR A SPECIFIC CATEGORY BY NAME ==
// ========================================================================
/**
 * @route   GET /api/trade-categories/qas 
 * (Full path will be /api/trade-categories/qas because this router is mounted at /api/trade-categories)
 * @desc    Get formatted Q&A text for a specific trade category by name
 * @access  Public (or protected as per your app's needs)
 */
router.get('/qas', async (req, res) => {
    const { categoryName } = req.query;

    if (!categoryName) {
        return res.status(400).json({ message: 'Error: categoryName query parameter is required.' });
    }

    const db = getDB();
    if (!db) {
        console.error('[API GET /api/trade-categories/qas] Database not connected');
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        console.log(`[API GET /api/trade-categories/qas] Request for Q&A, category: "${categoryName}"`);

        // Find the category by its name (case-insensitive search is good practice)
        const categoryData = await tradeCategoriesCollection.findOne({ 
            name: { $regex: `^${categoryName}$`, $options: 'i' } 
        });

        if (!categoryData) {
            console.log(`[API GET /api/trade-categories/qas] Category not found by name: "${categoryName}"`);
            return res.status(200).json({ // Still 200 OK for Promise.all on frontend
                categoryName: categoryName,
                qnaText: `No category found with the name '${categoryName}'.` 
            });
        }

        let formattedQnaText = "";
        if (categoryData.commonQAs && Array.isArray(categoryData.commonQAs) && categoryData.commonQAs.length > 0) {
            categoryData.commonQAs.forEach(qaPair => {
                if (qaPair.question && qaPair.answer) { 
                    formattedQnaText += `Q: ${qaPair.question}\nA: ${qaPair.answer}\n`;
                    if (qaPair.keywords && Array.isArray(qaPair.keywords) && qaPair.keywords.length > 0) {
                        formattedQnaText += `Keywords: ${qaPair.keywords.join(', ')}\n`;
                    }
                    formattedQnaText += "\n"; 
                }
            });
            if (!formattedQnaText.trim()) {
                formattedQnaText = `No Q&A content defined for category '${categoryData.name}'.`;
            }
        } else {
            formattedQnaText = `No Q&A content specifically defined for category '${categoryData.name}'.`;
        }

        console.log(`[API GET /api/trade-categories/qas] Found and formatted Q&A for category: "${categoryData.name}"`);
        res.status(200).json({
            categoryName: categoryData.name, 
            qnaText: formattedQnaText.trim()
        });

    } catch (error) {
        console.error('[API GET /api/trade-categories/qas] Server error fetching category Q&A:', error.message, error.stack);
        res.status(500).json({ message: 'Internal server error while fetching Q&A.' });
    }
});
// ========================================================================
// == END OF NEW ENDPOINT                                                ==
// ========================================================================


/**
 * @route   PATCH /api/trade-categories/:id
 * @desc    Update a trade category's name or description
 */
router.patch('/:id', async (req, res) => {
    const categoryId = req.params.id;
    const { name, description } = req.body;
    console.log(`[API PATCH /api/trade-categories/${categoryId}] Received update data:`, req.body);

    if (!ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID format.' });
    }
    
    const db = getDB();
    if (!db) {
        console.error(`[API PATCH /api/trade-categories/${categoryId}] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        const updateDoc = { $set: {} };
        let hasUpdates = false;

        if (name && typeof name === 'string' && name.trim() !== '') {
            const nameTrimmed = name.trim();
            const existingCategoryWithNewName = await tradeCategoriesCollection.findOne({
                name: { $regex: `^${nameTrimmed}$`, $options: 'i' },
                _id: { $ne: new ObjectId(categoryId) } 
            });
            if (existingCategoryWithNewName) {
                return res.status(409).json({ message: `Another trade category with the name '${nameTrimmed}' already exists.` });
            }
            updateDoc.$set.name = nameTrimmed;
            hasUpdates = true;
        }
        if (typeof description === 'string') { 
            updateDoc.$set.description = description.trim();
            hasUpdates = true;
        }

        if (!hasUpdates) {
             const currentCategory = await tradeCategoriesCollection.findOne({ _id: new ObjectId(categoryId) });
             if (!currentCategory) return res.status(404).json({ message: 'Category not found.' });
             return res.json(currentCategory);
        }
        updateDoc.$set.updatedAt = new Date();

        const result = await tradeCategoriesCollection.updateOne(
            { _id: new ObjectId(categoryId) },
            updateDoc
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Category not found.' });
        }
        
        const updatedCategory = await tradeCategoriesCollection.findOne({ _id: new ObjectId(categoryId) });
        res.json(updatedCategory);

    } catch (error) {
        console.error(`[API PATCH /api/trade-categories/${categoryId}] Error updating category:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating category: ${error.message}` });
    }
});


/**
 * @route   DELETE /api/trade-categories/:id
 * @desc    Delete a trade category
 */
router.delete('/:id', async (req, res) => {
    const categoryId = req.params.id;
    console.log(`[API DELETE /api/trade-categories/${categoryId}] Attempting to delete category.`);

    if (!ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID format.' });
    }

    const db = getDB();
    if (!db) {
        console.error(`[API DELETE /api/trade-categories/${categoryId}] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);
    // Use the same collection as other company routes
    const companiesCollection = db.collection('companiesCollection');

    try {
        const categoryToDelete = await tradeCategoriesCollection.findOne({ _id: new ObjectId(categoryId) });
        if (!categoryToDelete) {
            return res.status(404).json({ message: 'Category not found.' });
        }

        const companiesUsingCategory = await companiesCollection.countDocuments({ tradeTypes: categoryToDelete.name });
        
        if (companiesUsingCategory > 0) {
            return res.status(400).json({ message: `Cannot delete category '${categoryToDelete.name}'. It is currently assigned to ${companiesUsingCategory} company/companies. Please reassign them first.` });
        }

        const result = await tradeCategoriesCollection.deleteOne({ _id: new ObjectId(categoryId) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Category not found for deletion.' });
        }
        
        res.json({ message: 'Trade category deleted successfully.' });

    } catch (error) {
        console.error(`[API DELETE /api/trade-categories/${categoryId}] Error deleting category:`, error.message, error.stack);
        res.status(500).json({ message: `Error deleting category: ${error.message}` });
    }
});

// --- Q&A Management Routes for a Specific Trade Category ---

/**
 * @route   POST /api/trade-categories/:categoryId/qas
 * @desc    Add a new Q&A pair to a specific trade category
 */
router.post('/:categoryId/qas', async (req, res) => {
    const { categoryId } = req.params;
    const { question, answer, keywords } = req.body; 

    console.log(`[API POST /api/trade-categories/${categoryId}/qas] Received new Q&A data:`, req.body);

    const db = getDB();
    if (!db) {
        console.error(`[API POST /api/trade-categories/${categoryId}/qas] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }
    if (!ObjectId.isValid(categoryId)) {
        console.warn(`[API POST /api/trade-categories/${categoryId}/qas] Invalid category ID format`);
        return res.status(400).json({ message: 'Invalid Trade Category ID format.' });
    }
    if (!question || typeof question !== 'string' || question.trim() === '') {
        return res.status(400).json({ message: 'Question is required.' });
    }
    if (!answer || typeof answer !== 'string' || answer.trim() === '') {
        return res.status(400).json({ message: 'Answer is required.' });
    }

    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);
    try {
        const newQA = {
            _id: new ObjectId(), 
            question: question.trim(),
            answer: answer.trim(),
            keywords: Array.isArray(keywords) ? keywords.map(kw => kw.trim()).filter(kw => kw) : [], 
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await tradeCategoriesCollection.updateOne(
            { _id: new ObjectId(categoryId) },
            { 
                $push: { commonQAs: { $each: [newQA], $sort: { createdAt: -1 } } }, 
                $set: { updatedAt: new Date() } 
            }
        );

        if (result.matchedCount === 0) {
            console.warn(`[API POST /api/trade-categories/${categoryId}/qas] Trade Category not found.`);
            return res.status(404).json({ message: 'Trade Category not found.' });
        }
        if (result.modifiedCount === 0) { 
            console.warn(`[API POST /api/trade-categories/${categoryId}/qas] Q&A not added, though category found. Result:`, result);
            return res.status(500).json({ message: 'Failed to add Q&A to the category.' });
        }

        console.log(`[API POST /api/trade-categories/${categoryId}/qas] Q&A added successfully. Q&A ID: ${newQA._id}`);
        res.status(201).json(newQA); 

    } catch (error) {
        console.error(`[API POST /api/trade-categories/${categoryId}/qas] Error adding Q&A:`, error.message, error.stack);
        res.status(500).json({ message: `Error adding Q&A: ${error.message}` });
    }
});

/**
 * @route   GET /api/trade-categories/:categoryId/qas
 * @desc    Get all Q&A pairs for a specific trade category
 */
router.get('/:categoryId/qas', async (req, res) => {
    const { categoryId } = req.params;
    console.log(`[API GET /api/trade-categories/${categoryId}/qas] Fetching Q&A list.`);

    if (!ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: 'Invalid Trade Category ID format.' });
    }

    const db = getDB();
    if (!db) {
        console.error(`[API GET /api/trade-categories/${categoryId}/qas] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }

    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);
    try {
        const category = await tradeCategoriesCollection.findOne(
            { _id: new ObjectId(categoryId) },
            { projection: { commonQAs: 1 } }
        );

        if (!category) {
            return res.status(404).json({ message: 'Trade Category not found.' });
        }

        res.json(Array.isArray(category.commonQAs) ? category.commonQAs : []);

    } catch (error) {
        console.error(`[API GET /api/trade-categories/${categoryId}/qas] Error fetching Q&As:`, error.message, error.stack);
        res.status(500).json({ message: `Error fetching Q&As: ${error.message}` });
    }
});

/**
 * @route   PATCH /api/trade-categories/:categoryId/qas/:qaId
 * @desc    Update a specific Q&A pair within a trade category
 */
router.patch('/:categoryId/qas/:qaId', async (req, res) => {
    const { categoryId, qaId } = req.params;
    const { question, answer, keywords } = req.body;

    console.log(`[API PATCH /api/trade-categories/${categoryId}/qas/${qaId}] Received update data:`, req.body);

    if (!ObjectId.isValid(categoryId) || !ObjectId.isValid(qaId)) {
        return res.status(400).json({ message: 'Invalid Category or Q&A ID format.' });
    }

    const db = getDB();
    if (!db) {
        console.error(`[API PATCH /api/trade-categories/${categoryId}/qas/${qaId}] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        const fieldsToUpdateInQA = {};
        let hasUpdates = false;

        if (question && typeof question === 'string' && question.trim() !== '') {
            fieldsToUpdateInQA['commonQAs.$.question'] = question.trim();
            hasUpdates = true;
        }
        if (answer && typeof answer === 'string' && answer.trim() !== '') {
            fieldsToUpdateInQA['commonQAs.$.answer'] = answer.trim();
            hasUpdates = true;
        }
        if (keywords && Array.isArray(keywords)) {
            fieldsToUpdateInQA['commonQAs.$.keywords'] = keywords.map(kw => kw.trim()).filter(kw => kw);
            hasUpdates = true;
        }
        
        if (!hasUpdates) {
            return res.status(400).json({ message: 'No valid fields provided for Q&A update.' });
        }
        fieldsToUpdateInQA['commonQAs.$.updatedAt'] = new Date();

        const result = await tradeCategoriesCollection.updateOne(
            { _id: new ObjectId(categoryId), "commonQAs._id": new ObjectId(qaId) },
            { 
                $set: { ...fieldsToUpdateInQA, updatedAt: new Date() } 
            }
        );

        if (result.matchedCount === 0) {
            console.warn(`[API PATCH /api/trade-categories/${categoryId}/qas/${qaId}] Category or Q&A not found.`);
            return res.status(404).json({ message: 'Category or Q&A not found.' });
        }
        
        console.log(`[API PATCH /api/trade-categories/${categoryId}/qas/${qaId}] Q&A updated. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
        
        const updatedCategory = await tradeCategoriesCollection.findOne(
            { _id: new ObjectId(categoryId) },
            { projection: { commonQAs: { $elemMatch: { _id: new ObjectId(qaId) } } } }
        );
        
        if (!updatedCategory || !updatedCategory.commonQAs || updatedCategory.commonQAs.length === 0) {
            return res.status(404).json({ message: 'Updated Q&A not found.'});
        }
        
        res.json(updatedCategory.commonQAs[0]);

    } catch (error) {
        console.error(`[API PATCH /api/trade-categories/${categoryId}/qas/${qaId}] Error updating Q&A:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating Q&A: ${error.message}` });
    }
});

/**
 * @route   DELETE /api/trade-categories/:categoryId/qas/:qaId
 * @desc    Delete a specific Q&A pair from a trade category
 */
router.delete('/:categoryId/qas/:qaId', async (req, res) => {
    const { categoryId, qaId } = req.params;
    console.log(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Attempting to delete Q&A.`);

    if (!ObjectId.isValid(categoryId) || !ObjectId.isValid(qaId)) {
        return res.status(400).json({ message: 'Invalid Category or Q&A ID format.' });
    }

    const db = getDB();
    if (!db) {
        console.error(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Database not connected`);
        return res.status(500).json({ message: 'Database not connected' });
    }
    const tradeCategoriesCollection = db.collection(CATEGORY_COLLECTION);

    try {
        const result = await tradeCategoriesCollection.updateOne(
            { _id: new ObjectId(categoryId) },
            {
                $pull: { commonQAs: { _id: new ObjectId(qaId) } },
                $set: { updatedAt: new Date() }
            }
        );

        if (result.matchedCount === 0) {
            console.warn(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Category not found.`);
            return res.status(404).json({ message: 'Category not found.' });
        }
        if (result.modifiedCount === 0) {
            console.warn(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Q&A not found within the category.`);
            return res.status(404).json({ message: 'Q&A not found within the category.' });
        }

        console.log(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Q&A deleted successfully.`);
        res.json({ message: 'Q&A pair deleted successfully.' });

    } catch (error) {
        console.error(`[API DELETE /api/trade-categories/${categoryId}/qas/${qaId}] Error deleting Q&A:`, error.message, error.stack);
        res.status(500).json({ message: `Error deleting Q&A: ${error.message}` });
    }
});


module.exports = router;
