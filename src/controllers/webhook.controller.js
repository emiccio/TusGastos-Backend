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

    if (body.object !== 'whatsapp_business_account') return;

    const messageData = whatsappService.extractMessageData(body);
    if (!messageData) return;

    const { messageId, from, text, timestamp } = messageData;
    logger.info(`Incoming message from ${from}: "${text}"`);

    // ── Deduplicación ──────────────────────────────────────────
    const existing = await prisma.whatsappMessage.findUnique({ where: { messageId } });
    if (existing) {
      logger.warn(`Duplicate message ${messageId} ignored`);
      return;
    }

    await prisma.whatsappMessage.create({
      data: { messageId, phone: from, body: text, direction: 'inbound' },
    });

    await whatsappService.markAsRead(messageId);

    // ── Obtener o crear usuario ────────────────────────────────
    const user = await transactionService.getOrCreateUser(from);

    // ── Parsear mensaje con LLM ────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const parsed = await llmService.parseMessage(text, today);
    logger.debug(`LLM parsed: ${JSON.stringify(parsed)}`);

    // El LLM ahora devuelve siempre { items: [...], confirmation: "..." }
    const items = parsed.items || [];
    let responseText = parsed.confirmation || '';

    // ── Procesar cada ítem ─────────────────────────────────────
    for (const item of items) {
      switch (item.type) {
        case 'expense':
        case 'income': {
          await transactionService.createTransaction({
            userId: user.id,
            type: item.type,
            amount: item.amount,
            category: item.category,
            description: item.description,
            date: resolveDate(item.date),
            rawMessage: text,
          });
          logger.info(`Transaction created: ${item.type} $${item.amount} (${item.category})`);
          break;
        }

        case 'query': {
          const data = await transactionService.resolveQuery(user.id, item.queryType, item.period);
          // Para queries, el responseText lo genera el LLM con los datos reales
          responseText = await llmService.generateQueryResponse(item.queryType, data);
          break;
        }

        case 'unknown':
        default: {
          responseText = parsed.confirmation ||
            '🤔 No entendí bien. Podés decirme:\n• "carnicería 23k, verdulería 17k"\n• "cobré 500k"\n• "¿cuánto gasté este mes?"';
          break;
        }
      }
    }

    // Si el LLM no devolvió confirmation, armar una genérica
    if (!responseText) {
      const txItems = items.filter(i => i.type === 'expense' || i.type === 'income');
      if (txItems.length > 0) {
        const total = txItems.reduce((sum, i) => sum + (i.amount || 0), 0);
        responseText = txItems.length === 1
          ? `✅ Anotado $${txItems[0].amount.toLocaleString('es-AR')} en ${txItems[0].category}`
          : `✅ Listo! Anoté ${txItems.length} movimientos por $${total.toLocaleString('es-AR')} en total`;
      }
    }

    // ── Enviar respuesta ───────────────────────────────────────
    await whatsappService.sendTextMessage(from, responseText);

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
