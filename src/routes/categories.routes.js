const express = require('express');
const router = express.Router();
const categoriesController = require('../controllers/categories.controller');
const auth = require('../middleware/auth');

// Todas protegidas por el middleware de auth
router.use(auth);

// Categorías
router.get('/', categoriesController.getCategories);
router.post('/', categoriesController.createCategory);
router.delete('/:id', categoriesController.deleteCategory);

// Reglas
router.get('/rules', categoriesController.getRules);
router.post('/rules', categoriesController.createRule);
router.delete('/rules/:id', categoriesController.deleteRule);

module.exports = router;
