const mongoose = require('mongoose');

/**
 * API Validation Utilities for ClientsVia Backend
 * 
 * These utilities ensure all CRUD operations validate IDs and entities exist
 * before performing operations, as per requirements.
 */

const API_BASE_URL = 'https://clientsvia-backend.onrender.com';

// Helper to validate MongoDB ObjectId format
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Validate company exists
async function validateCompanyExists(companyId) {
  if (!companyId) {
    throw new Error('Company ID is required');
  }
  
  if (!isValidObjectId(companyId)) {
    throw new Error('Invalid company ID format');
  }
  
  const Company = require('../models/v2Company');
  const company = await Company.findById(companyId);
  
  if (!company) {
    throw new Error(`Company with ID ${companyId} not found`);
  }
  
  return company;
}

// Validate trade category exists within a company
async function validateTradeCategoryExists(companyId, categoryId) {
  const company = await validateCompanyExists(companyId);
  
  if (!isValidObjectId(categoryId)) {
    throw new Error('Invalid trade category ID format');
  }
  
  const category = company.tradeTypes.id(categoryId);
  if (!category) {
    throw new Error(`Trade category with ID ${categoryId} not found in company ${companyId}`);
  }
  
  return { company, category };
}

// Validate Q&A exists within a trade category
async function validateQAExists(companyId, categoryId, qaId) {
  const { company, category } = await validateTradeCategoryExists(companyId, categoryId);
  
  if (!isValidObjectId(qaId)) {
    throw new Error('Invalid Q&A ID format');
  }
  
  if (!category.qaPairs) {
    throw new Error(`No Q&A found for category ${categoryId}`);
  }
  
  const qa = category.qaPairs.id(qaId);
  if (!qa) {
    throw new Error(`Q&A with ID ${qaId} not found in category ${categoryId}`);
  }
  
  return { company, category, qa };
}

// V2 DELETED: Employee validation - Employee model not in V2 system
// async function validateEmployeeExists(employeeId) {
//   if (!employeeId) {
//     throw new Error('Employee ID is required');
//   }
//   
//   if (!isValidObjectId(employeeId)) {
//     throw new Error('Invalid employee ID format');
//   }
//   
//   const Employee = require('../models/v2Employee');
//   const employee = await Employee.findById(employeeId);
//   
//   if (!employee) {
//     throw new Error(`Employee with ID ${employeeId} not found`);
//   }
//   
//   return employee;
// }

// Validate user exists (for Google OAuth)
async function validateUserExists(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  if (!isValidObjectId(userId)) {
    throw new Error('Invalid user ID format');
  }
  
  const User = require('../models/v2User');
  const user = await User.findById(userId);
  
  if (!user) {
    throw new Error(`User with ID ${userId} not found`);
  }
  
  return user;
}

// Get API configuration based on environment variables and company settings
function getAPIConfig(company = null) {
  return {
    baseUrl: API_BASE_URL,
    elevenLabs: {
      apiKey: company?.aiSettings?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY,
      voiceId: company?.aiSettings?.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID,
      configured: !!(company?.aiSettings?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY)
    }
  };
}

// Middleware to validate and attach company to request
function validateCompanyMiddleware(req, res, next) {
  const companyId = req.params.companyId || req.body.companyId;
  
  if (!companyId) {
    return res.status(400).json({ message: 'Company ID is required' });
  }
  
  validateCompanyExists(companyId)
    .then(company => {
      req.company = company;
      next();
    })
    .catch(err => {
      if (err.message.includes('not found')) {
        return res.status(404).json({ message: err.message });
      }
      return res.status(400).json({ message: err.message });
    });
}

// Error handler for validation errors
function handleValidationError(err, req, res, next) {
  if (err.message.includes('not found')) {
    return res.status(404).json({ message: err.message });
  }
  
  if (err.message.includes('Invalid') || err.message.includes('required')) {
    return res.status(400).json({ message: err.message });
  }
  
  // Pass other errors to default handler
  next(err);
}

module.exports = {
  isValidObjectId,
  validateCompanyExists,
  validateTradeCategoryExists,
  validateQAExists,
  validateEmployeeExists,
  validateUserExists,
  getAPIConfig,
  validateCompanyMiddleware,
  handleValidationError,
  API_BASE_URL
};
