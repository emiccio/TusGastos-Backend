const express = require('express');
const router = express.Router();
const { verifyWebhook, handleWebhook } = require('../controllers/webhook.controller');

// Meta verifica el webhook con GET
router.get('/', verifyWebhook);

// Meta envía mensajes con POST
router.post('/', handleWebhook);

module.exports = router;
