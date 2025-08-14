/**
 * Boot validation for ResponseTrace schema
 * Ensures behaviors field is Array<Mixed>, not [String]
 */

const mongoose = require('mongoose');
const ResponseTrace = require('../models/ResponseTrace');

async function validateResponseTraceSchema() {
  console.log('[BOOT VALIDATION] Checking ResponseTrace schema...');
  
  try {
    const model = mongoose.model('ResponseTrace');
    const behaviorsPath = model.schema.path('behaviors');
    
    console.log('[BOOT VALIDATION] ResponseTrace model found');
    console.log('[BOOT VALIDATION] behaviors field type:', behaviorsPath?.instance);
    console.log('[BOOT VALIDATION] behaviors caster:', behaviorsPath?.caster?.instance);
    
    // Check if behaviors is properly configured as Array
    if (behaviorsPath?.instance !== 'Array') {
      console.error('🚨 CRITICAL: behaviors field is not Array type!');
      console.error('🚨 CRITICAL: Current type:', behaviorsPath?.instance);
      throw new Error('BOOT VALIDATION FAILED: behaviors must be Array type');
    }
    
    // Check if caster allows Mixed or subdocs (not String)
    if (behaviorsPath?.caster?.instance === 'String') {
      console.error('🚨 CRITICAL: behaviors caster is String - this will cause CastError!');
      throw new Error('BOOT VALIDATION FAILED: behaviors caster cannot be String');
    }
    
    console.log('✅ BOOT VALIDATION PASSED: ResponseTrace schema is correct');
    console.log('✅ behaviors is Array type with proper caster');
    
    return true;
  } catch (error) {
    console.error('❌ BOOT VALIDATION FAILED:', error.message);
    
    if (process.env.RUNTIME_STRICT_CONFIG === '1') {
      console.error('🚨 RUNTIME_STRICT_CONFIG=1: Refusing to start with invalid schema');
      process.exit(1);
    }
    
    return false;
  }
}

module.exports = { validateResponseTraceSchema };
