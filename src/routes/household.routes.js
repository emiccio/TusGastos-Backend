const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const householdController = require('../controllers/household.controller');

router.get('/', authMiddleware, householdController.getHousehold);
router.post('/invite', authMiddleware, householdController.invite);
router.post('/join', authMiddleware, householdController.join);

module.exports = router;
