const prisma = require('../config/database');
const llmService = require('../services/llm.service');
const whatsappService = require('../services/whatsapp.service');
const transactionService = require('../services/transaction.service');
const { resolveDate } = require('../services/date.utils');
const logger = require('../utils/logger');

/**
 * GET /webhook
 * Verificación inicial del webhook por Meta
 */
async function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed');
  return res.sendStatus(403);
}

/**
 * POST /webhook
 * Procesa mensajes entrantes de WhatsApp
 */
async function handleWebhook(req, res) {
  // Responder 200 de inmediato a Meta (requieren respuesta rápida)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Verificar que sea un evento de WhatsApp Business
    if (body.object !== 'whatsapp_business_account') return;

    const messageData = whatsappService.extractMessageData(body);
    if (!messageData) return; // No es un mensaje de texto

    const { messageId, from, text, timestamp } = messageData;

    logger.info(`Incoming message from ${from}: "${text}"`);

    // ── Deduplicación ──────────────────────────────────────────
    // Meta puede enviar el mismo webhook más de una vez
    const existing = await prisma.whatsappMessage.findUnique({
      where: { messageId },
    });

    if (existing) {
      logger.warn(`Duplicate message ${messageId} ignored`);
      return;
    }

    // Registrar el mensaje entrante
    await prisma.whatsappMessage.create({
      data: { messageId, phone: from, body: text, direction: 'inbound' },
    });

    // Marcar como leído en WhatsApp
    await whatsappService.markAsRead(messageId);

    // ── Obtener o crear usuario ────────────────────────────────
    const user = await transactionService.getOrCreateUser(from);

    // ── Parsear mensaje con LLM ────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const parsed = await llmService.parseMessage(text, today);

    logger.debug(`LLM parsed: ${JSON.stringify(parsed)}`);

    let responseText = '';

    // ── Procesar según el tipo ─────────────────────────────────
    switch (parsed.type) {
      case 'expense':
      case 'income': {
        await transactionService.createTransaction({
          userId: user.id,
          type: parsed.type,
          amount: parsed.amount,
          category: parsed.category,
          description: parsed.description,
          date: resolveDate(parsed.date),
          rawMessage: text,
        });

        responseText = parsed.confirmation || (
          parsed.type === 'expense'
            ? `✅ Anotado: $${parsed.amount.toLocaleString('es-AR')} en ${parsed.category}`
            : `💰 Ingreso registrado: $${parsed.amount.toLocaleString('es-AR')}`
        );
        break;
      }

      case 'query': {
        const data = await transactionService.resolveQuery(
          user.id,
          parsed.queryType,
          parsed.period
        );

        responseText = await llmService.generateQueryResponse(parsed.queryType, data);
        break;
      }

      case 'unknown':
      default: {
        responseText =
          parsed.confirmation ||
          '🤔 No entendí bien. Podés decirme:\n• "gasté 20k en súper"\n• "cobré 500k"\n• "¿cuánto gasté este mes?"';
        break;
      }
    }

    // ── Enviar respuesta por WhatsApp ──────────────────────────
    await whatsappService.sendTextMessage(from, responseText);

    // Registrar mensaje saliente
    await prisma.whatsappMessage.create({
      data: {
        messageId: `out_${messageId}`,
        phone: from,
        body: responseText,
        direction: 'outbound',
      },
    });

    logger.info(`Response sent to ${from}: "${responseText}"`);
  } catch (error) {
    logger.error('Error processing webhook:', error);

    // Intentar enviar mensaje de error al usuario
    try {
      const messageData = whatsappService.extractMessageData(req.body);
      if (messageData?.from) {
        await whatsappService.sendTextMessage(
          messageData.from,
          '😅 Tuve un problema procesando tu mensaje. Intentá de nuevo en un momento.'
        );
      }
    } catch (_) {}
  }
}

module.exports = { verifyWebhook, handleWebhook };
