const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/audit');
let Joi;
try {
  Joi = require('joi');
} catch (err) {
  Joi = require('../lib/joi');
}
const Employee = require('../models/Employee');

const createSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().optional().allow(null, ''),
  role: Joi.string().valid('admin', 'manager', 'staff').optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  schedule: Joi.array().items(
    Joi.object({
      day: Joi.string().required(),
      start: Joi.string().required(),
      end: Joi.string().required()
    })
  ).optional(),
  transferEligible: Joi.boolean().optional()
});

const updateSchema = createSchema.min(1);

// List employees for the company. Staff only see their own record.
async function listEmployees(req, res) {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.user.role === 'staff') {
      filter._id = req.user.id;
    }
    const employees = await Employee.find(filter);
    auditLog('list employees', req);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

router.get('/', verifyToken, listEmployees);

// Create employee - admin or manager only
async function createEmployee(req, res) {
  try {
    const { name, email, phone, role, status, schedule, transferEligible } = req.body;
    const employee = new Employee({
      companyId: req.user.companyId,
      name,
      email,
      phone,
      role,
      status,
      schedule: schedule || [],
      transferEligible
    });
    await employee.save();
    auditLog('create employee', req);
    res.status(201).json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

router.post('/', verifyToken, requireRole('admin', 'manager'), validateBody(createSchema), createEmployee);

// Update employee - staff can edit only their profile
async function updateEmployee(req, res) {
  const { id } = req.params;
  if (req.user.role === 'staff' && req.user.id !== id) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    const update = { ...req.body, updatedAt: new Date() };
    delete update.companyId;
    const employee = await Employee.findOneAndUpdate(
      { _id: id, companyId: req.user.companyId },
      update,
      { new: true }
    );
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    auditLog('update employee', req);
    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

router.patch('/:id', verifyToken, validateBody(updateSchema), updateEmployee);

// Delete employee - admin or manager only
async function deleteEmployee(req, res) {
  try {
    const employee = await Employee.findOneAndDelete({
      _id: req.params.id,
      companyId: req.user.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    auditLog('delete employee', req);
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

router.delete('/:id', verifyToken, requireRole('admin', 'manager'), deleteEmployee);

module.exports = router;
