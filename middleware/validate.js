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
    if (error) {return res.status(400).json({ message: 'Invalid input', details: error.details });}
    next();
  };
}

module.exports = { validateBody };
