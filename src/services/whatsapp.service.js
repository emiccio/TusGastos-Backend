const axios = require('axios');
const logger = require('../utils/logger');

const WA_API_URL = 'https://graph.facebook.com/v19.0';

/**
 * Envía un mensaje de texto por WhatsApp
 * @param {string} to - Número de teléfono destino (con código de país, sin +)
 * @param {string} text - Texto del mensaje
 */
async function sendTextMessage(to, text) {
  // Ajuste para números de Argentina (549 -> 54) y México (521 -> 52) 
  // que WhatsApp API requiere enviar sin el 9 / 1
  if (to.startsWith('549')) to = '54' + to.slice(3);
  else if (to.startsWith('521')) to = '52' + to.slice(3);

  try {
    const response = await axios.post(
      `${WA_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.debug(`WhatsApp message sent to ${to}: ${response.data.messages?.[0]?.id}`);
    return response.data;
  } catch (error) {
    const errData = error.response?.data;
    logger.error(`Error sending WhatsApp message to ${to}:`, errData || error.message);
    throw error;
  }
}

/**
 * Marca un mensaje como leído
 * @param {string} messageId - ID del mensaje de WhatsApp
 */
async function markAsRead(messageId) {
  try {
    await axios.post(
      `${WA_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // No crítico si falla
    logger.warn(`Could not mark message ${messageId} as read`);
  }
}

/**
 * Extrae los datos del mensaje del payload del webhook de Meta
 * @param {Object} body - Body del webhook
 * @returns {Object|null} { messageId, from, text, timestamp } o null si no es mensaje de texto
 */
function extractMessageData(body) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Verificar que sea un mensaje nuevo (no status update)
    if (!value?.messages || value.messages.length === 0) return null;

    const message = value.messages[0];

    // Solo procesar mensajes de texto por ahora
    // if (message.type !== 'text') return null;

    return {
      messageId: message.id,
      from: message.from,
      type: message.type,
      text: message.text?.body || null,
      audioId: message.audio?.id || null,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
    };
  } catch (error) {
    logger.error('Error extracting message data:', error);
    return null;
  }
}

async function sendTypingIndicator(to, action = 'typing_on') {
  try {
    await axios.post(
      `${WA_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'typing',
        typing: {
          status: action,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    logger.warn(`Could not send typing indicator to ${to}`);
  }
}

async function getMediaUrl(mediaId) {
  const res = await axios.get(
    `${WA_API_URL}/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    }
  );

  return res.data.url;
}

async function downloadMedia(mediaUrl) {
  const res = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
  });

  return Buffer.from(res.data);
}

async function downloadAudio(mediaId) {
  const url = await getMediaUrl(mediaId);
  return downloadMedia(url);
}

module.exports = { sendTextMessage, markAsRead, extractMessageData, downloadAudio, sendTypingIndicator };
