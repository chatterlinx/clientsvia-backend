let Joi;
try {
  Joi = require('joi');
} catch (err) {
  Joi = require('../lib/joi');
}

// Pass a Joi schema, use as middleware
function validateBody(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ message: 'Invalid input', details: error.details });
    next();
  };
}

// Company validation schema
const companySchema = Joi.object({
  companyName: Joi.string().required(),
  ownerName: Joi.string().required(),
  ownerEmail: Joi.string().email().required(),
  ownerPhone: Joi.string().optional(),
  tradeType: Joi.string().optional()
});

const validateCompany = validateBody(companySchema);

module.exports = { validateBody, validateCompany };
