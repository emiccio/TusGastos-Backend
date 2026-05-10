const prisma = require('../config/database');
const llmService = require('../services/llm.service');
const commandService = require('../services/command.service');
const whatsappService = require('../services/whatsapp.service');
const transactionService = require('../services/transaction.service');
const userService = require('../services/user.service');
const householdService = require('../services/household.service');
const categoriesService = require('../services/categories.service');
const transcriptionService = require('../services/transcription.service');
const { resolveDate, format } = require('../services/date.utils');
const logger = require('../utils/logger');

const AUDIO_MAX_BYTES = 100 * 1024;

function formatMoney(amount) {
  return `$${Number(amount || 0).toLocaleString('es-AR')}`;
}

function formatMovementDate(date) {
  const movementDate = date instanceof Date ? date : new Date(date);
  const today = new Date();

  if (
    movementDate.getFullYear() === today.getFullYear() &&
    movementDate.getMonth() === today.getMonth() &&
    movementDate.getDate() === today.getDate()
  ) {
    return 'Hoy';
  }

  return format(movementDate, 'dd/MM/yyyy');
}

function normalizeCategory(category) {
  return category && String(category).trim() ? String(category).trim() : 'Otros';
}

function isValidTransactionItem(item) {
  return (
    item &&
    ['expense', 'income'].includes(item.type) &&
    Number.isFinite(Number(item.amount)) &&
    Number(item.amount) > 0
  );
}

function buildSavedMovementsResponse(savedItems, householdName) {
  const title = savedItems.length === 1
    ? `Listo, registré este ${savedItems[0].type === 'income' ? 'ingreso' : 'gasto'}:`
    : `Listo, registré estos ${savedItems.length} movimientos:`;

  const lines = savedItems.map((item, index) => {
    const prefix = savedItems.length > 1 ? `${index + 1}. ` : '';
    const name = item.description || (item.type === 'income' ? 'Ingreso' : 'Gasto');

    return [
      `${prefix}*${name}*`,
      `Monto: ${formatMoney(item.amount)}`,
      `Categoría: ${item.category}`,
      `Fecha: ${formatMovementDate(item.date)}`,
      householdName ? `Hogar: ${householdName}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `${title}\n\n${lines}\n\nSi querés corregir algo, podés ajustarlo desde el panel.`;
}

function buildClarificationResponse() {
  return `No lo guardé porque me faltó un dato claro.

Podés mandármelo así:
• "super 20k"
• "cobré 500k"
• "ayer pagué 10k de nafta y 30k de seguro"`;
}

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
      let audioBuffer;

      try {
        audioBuffer = await whatsappService.downloadAudio(audioId);
      } catch (error) {
        logger.error('Error downloading WhatsApp audio:', error.response?.data || error.message);
        await whatsappService.sendTextMessage(
          from,
          'No pude descargar el audio. Probá mandármelo de nuevo en un momento.'
        );
        return;
      }

      if (audioBuffer.length > AUDIO_MAX_BYTES) {
        await whatsappService.sendTextMessage(
          from,
          'El audio es demasiado largo para procesarlo bien. Mandame uno más cortito, idealmente con uno o pocos movimientos.'
        );
        return;
      }

      try {
        text = await transcriptionService.transcribeAudio(audioBuffer);
      } catch (error) {
        const message = ['EMPTY_AUDIO', 'EMPTY_TRANSCRIPTION'].includes(error.code || error.message)
          ? 'No llegué a entender el audio. Mandame otro más claro o escribime el gasto en texto.'
          : 'Tuve un problema transcribiendo el audio. Probá de nuevo en un momento o mandámelo escrito.';

        await whatsappService.sendTextMessage(from, message);
        return;
      }
    }

    if (!text || !text.trim()) {
      if (type === 'audio') {
        await whatsappService.sendTextMessage(
          from,
          'No llegué a entender el audio. Mandame otro más claro o escribime el gasto en texto.'
        );
      }
      return;
    }

    text = text.trim();

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
    let responseText = '';
    const savedItems = [];
    const transactionItems = items.filter(item => ['expense', 'income'].includes(item.type));

    if (transactionItems.some(item => !isValidTransactionItem(item))) {
      logger.warn(`Message ignored due to invalid transaction item: ${JSON.stringify(items)}`);
      responseText = buildClarificationResponse();
    } else {
      // ── Procesar cada ítem ─────────────────────────────────────
      for (const item of items) {
        switch (item.type) {
          case 'expense':
          case 'income': {

            const movementDate = resolveDate(item.date);
            let categoryToSave = normalizeCategory(item.category);

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
              amount: Number(item.amount),
              category: categoryToSave,
              description: item.description,
              date: movementDate,
              paymentMethod: item.paymentMethod || 'cash',
              rawMessage: text,
            });
            logger.info(`Transaction created: ${item.type} $${item.amount} (${categoryToSave})`);
            savedItems.push({
              ...item,
              amount: Number(item.amount),
              category: categoryToSave,
              date: movementDate,
            });
            break;
          }

          case 'query': {
            const data = await transactionService.resolveQuery(user.id, item.queryType, item.period, item.category || null);
            responseText = await llmService.generateQueryResponse(item.queryType, data);
            break;
          }

          case 'unknown':
          default: {
            responseText = buildClarificationResponse();
            break;
          }
        }
      }
    }

    if (savedItems.length > 0) {
      responseText = buildSavedMovementsResponse(savedItems, household?.name);
    }

    if (!responseText) {
      responseText = buildClarificationResponse();
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
