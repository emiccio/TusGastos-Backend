const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const householdController = require('../controllers/household.controller');

router.get('/', authMiddleware, householdController.getHousehold);
router.post('/', authMiddleware, householdController.createHousehold);
router.get('/list', authMiddleware, householdController.listHouseholds);
router.post('/invite', authMiddleware, householdController.invite);
router.post('/join', authMiddleware, householdController.join);
router.post('/switch', authMiddleware, householdController.switchHousehold);
router.put('/name', authMiddleware, householdController.updateName);

module.exports = router;
