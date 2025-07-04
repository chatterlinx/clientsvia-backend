const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const Employee = require('../models/Employee');

// List employees for the company. Staff only see their own record.
router.get('/', verifyToken, async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.user.role === 'staff') {
      filter._id = req.user.id;
    }
    const employees = await Employee.find(filter);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create employee - admin or manager only
router.post('/', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
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
    res.status(201).json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update employee - staff can edit only their profile
router.patch('/:id', verifyToken, async (req, res) => {
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
    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete employee - admin or manager only
router.delete('/:id', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const employee = await Employee.findOneAndDelete({
      _id: req.params.id,
      companyId: req.user.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
