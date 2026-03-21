const express = require('express');
const router = express.Router();
const transactionsController = require('../controllers/transactions.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

router.get('/', transactionsController.list);
router.post('/', transactionsController.create);
router.delete('/:id', transactionsController.remove);
router.get('/summary', transactionsController.summary);
router.get('/categories', transactionsController.categories);

module.exports = router;
