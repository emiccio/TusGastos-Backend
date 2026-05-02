const prisma = require('../config/database');
const llmService = require('../services/llm.service');
const commandService = require('../services/command.service');
const whatsappService = require('../services/whatsapp.service');
const transactionService = require('../services/transaction.service');
const userService = require('../services/user.service');
const householdService = require('../services/household.service');
const categoriesService = require('../services/categories.service');
const transcriptionService = require('../services/transcription.service');
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

    let { messageId, from, text, audioId, type, timestamp, phoneNumberId } = messageData;
    
    // Evitar procesar mensajes de otros números en la misma cuenta de WhatsApp Business (WABA)
    if (phoneNumberId && phoneNumberId !== process.env.WHATSAPP_PHONE_NUMBER_ID) {
      logger.debug(`Ignoring message meant for different phone number ID: ${phoneNumberId}`);
      return;
    }

    logger.info(`Incoming message from ${from}: "${text}"`);

    // ── Deduplicación ──────────────────────────────────────────
    const existing = await prisma.whatsappMessage.findUnique({ where: { messageId } });
    if (existing) {
      logger.warn(`Duplicate message ${messageId} ignored`);
      return;
    }

    // convertir audio → texto
    if (type === 'audio' && audioId) {
      const audioBuffer = await whatsappService.downloadAudio(audioId);

      if (audioBuffer.length > 100 * 1024) {
        await whatsappService.sendTextMessage(
          from,
          '🎤 El audio es demasiado largo. Mandame uno cortito diciendo el gasto 🙂'
        );
        return;
      }
      text = await transcriptionService.transcribeAudio(audioBuffer);
    }

    if (!text) return;

    // ── Guardar mensaje ───────────────
    await prisma.whatsappMessage.create({
      data: { messageId, phone: from, body: text, direction: 'inbound' },
    });

    await whatsappService.markAsRead(messageId);
    await whatsappService.sendTypingIndicator(from, 'typing_on');

    // ── Obtener o crear usuario ────────────────────────────────
    const { user, created } = await userService.getOrCreateUserByPhone(from);

    // ── Intercepción de onboarding ─────────────────────────────
    if (user.onboardingStep !== null) {

      if (created) {
        // Primera vez que escribe — Lulú se presenta y pide el nombre
        const greeting =
          `¡Hola! 👋 Soy Lulú.\n\n` +
          `Te ayudo a registrar tus gastos e ingresos directamente por WhatsApp.\n\n` +
          `Nada de apps, planillas ni formularios 🙂 \n\n` +
          `Para empezar... ¿cómo te llamás?`;

        await whatsappService.sendTypingIndicator(from, 'typing_off');
        await whatsappService.sendTextMessage(from, greeting);
        await prisma.whatsappMessage.create({
          data: { messageId: `out_${messageId}`, phone: from, body: greeting, direction: 'outbound' },
        });
        logger.info(`Onboarding started for new user ${from}`);
        return;
      }

      if (user.onboardingStep === 'WAITING_NAME') {
        // Ya se presentó — lo que llegó ahora es el nombre
        const nombre = text.trim();

        await prisma.user.update({
          where: { id: user.id },
          data: { name: nombre, onboardingStep: null },
        });

        const welcome =
          `¡Listo ${nombre}! 🎉\n\n` +
          `Ya podés registrar gastos e ingresos conmigo.\n\n` +
          `Por ejemplo podés escribirme:\n` +
          `• "supermercado 8500"\n` +
          `• "cobré el sueldo 200k"\n` +
          `• "¿cuánto gasté esta semana?"\n\n` +
          `Probá mandarme tu primer gasto 🙂`;

        await whatsappService.sendTypingIndicator(from, 'typing_off');
        await whatsappService.sendTextMessage(from, welcome);
        await prisma.whatsappMessage.create({
          data: { messageId: `out_${messageId}`, phone: from, body: welcome, direction: 'outbound' },
        });
        logger.info(`Onboarding completed for user ${from} — name: "${nombre}"`);
        return;
      }
    }

    // ── Intercepción de invitación pendiente ───────────────────
    const pendingInvite = await prisma.householdInvite.findFirst({
      where: {
        phone: from,
        status: 'PENDING',
        expiresAt: { gt: new Date() }
      },
      include: { 
        household: { 
          select: { name: true, owner: { select: { name: true } } } 
        } 
      }
    });

    if (pendingInvite) {
      if (text.trim() === "1") {
        const result = await householdService.acceptInviteForUser(user.id);
        const msg = `✅ ¡Listo! Te uniste al hogar *${result.householdName}*.\n\nAhora tus gastos se anotarán ahí.`;
        await whatsappService.sendTextMessage(from, msg);
        return;
      } else if (text.trim() === "2") {
        await householdService.declineInvite(user.id);
        const msg = `Entendido. Seguís en tu hogar actual.`;
        await whatsappService.sendTextMessage(from, msg);
        return;
      } else {
        const inviterName = pendingInvite.household.owner.name || "Alguien";
        const prompt = `👋 ${inviterName} te invitó a su hogar *${pendingInvite.household.name}* en Lulú.\n\n` +
                       `Si aceptás, dejarás tu hogar actual y pasarás al nuevo (perderás tus datos actuales).\n\n` +
                       `1️⃣ Unirme al hogar\n` +
                       `2️⃣ Mantener mi hogar actual`;
        await whatsappService.sendTextMessage(from, prompt);
        return;
      }
    }

    // ── Flujo normal (usuario ya registrado) ───────────────────
    const householdId = await transactionService.getActiveHousehold(user.id);

    // ── Interceptar comandos (sin usar LLM) ─────────────────────
    const command = await commandService.handleCommand(text, user);

    if (command?.handled) {

      if (command.type === 'response') {
        await whatsappService.sendTypingIndicator(from, 'typing_off');
        await whatsappService.sendTextMessage(from, command.response);

        await prisma.whatsappMessage.create({
          data: {
            messageId: `out_${messageId}`,
            phone: from,
            body: command.response,
            direction: 'outbound',
          },
        });

        return;
      }

      if (command.type === 'query') {
        const data = await transactionService.resolveQuery(
          user.id,
          command.queryType,
          command.period
        );

        const responseText = await llmService.generateQueryResponse(
          command.queryType,
          data
        );

        await whatsappService.sendTypingIndicator(from, 'typing_off');
        await whatsappService.sendTextMessage(from, responseText);

        await prisma.whatsappMessage.create({
          data: {
            messageId: `out_${messageId}`,
            phone: from,
            body: responseText,
            direction: 'outbound',
          },
        });

        return;
      }
    }

    // Verificar si el dueño del hogar es Premium
    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: { owner: true },
    });
    const isPremium = household?.owner?.plan === 'PREMIUM';

    // Obtener categorías (lazy seeding si no existen) y prepararlas
    const categoriesArr = await categoriesService.getCategoryNamesForLLM(householdId);

    // ── Parsear mensaje con LLM ────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const parsed = await llmService.parseMessage(text, today, categoriesArr.join(', '));
    logger.debug(`LLM parsed: ${JSON.stringify(parsed)}`);

    const items = parsed.items || [];
    let responseText = parsed.confirmation || '';

    // ── Procesar cada ítem ─────────────────────────────────────
    for (const item of items) {
      switch (item.type) {
        case 'expense':
        case 'income': {
          let categoryToSave = item.category;

          if (isPremium && item.type === 'expense') {
            const ruleMatch = await categoriesService.evaluateRules(householdId, item.description);
            if (ruleMatch) {
              logger.info(`Rule matched for "${item.description}": replacing category ${categoryToSave} -> ${ruleMatch}`);
              categoryToSave = ruleMatch;
            }
          }

          await transactionService.createTransaction({
            userId: user.id,
            type: item.type,
            amount: item.amount,
            category: categoryToSave,
            description: item.description,
            date: resolveDate(item.date),
            paymentMethod: item.paymentMethod || 'cash',
            rawMessage: text,
          });
          logger.info(`Transaction created: ${item.type} $${item.amount} (${categoryToSave})`);
          break;
        }

        case 'query': {
          const data = await transactionService.resolveQuery(user.id, item.queryType, item.period, item.category || null);
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
    await whatsappService.sendTypingIndicator(from, 'typing_off');
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
    logger.error('Error processing webhook:', error.response?.data || error.message);
    try {
      const messageData = whatsappService.extractMessageData(req.body);
      if (messageData?.from) {
        await whatsappService.sendTypingIndicator(messageData.from, 'typing_off');
        await whatsappService.sendTextMessage(
          messageData.from,
          '😅 Tuve un problema procesando tu mensaje. Intentá de nuevo en un momento.'
        );
      }
    } catch (_) { }
  }
}

module.exports = { verifyWebhook, handleWebhook };