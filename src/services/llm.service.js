const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

// ── Clientes ────────────────────────────────────────────────────
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ── Configuración ───────────────────────────────────────────────
// LLM_PROVIDER=openai | gemini | auto
// "auto" usa gemini primero (free tier), con fallback a openai
const PRIMARY = process.env.LLM_PROVIDER || 'auto';

const CATEGORIES = [
  'Supermercado', 'Restaurantes', 'Transporte', 'Nafta',
  'Servicios', 'Salud', 'Farmacia', 'Ropa', 'Entretenimiento',
  'Educación', 'Viajes', 'Hogar', 'Sueldo', 'Freelance',
  'Transferencia', 'Otros',
];

const SYSTEM_PROMPT = `Sos Lulu, el asistente financiero de TusGastos. Analizás mensajes de WhatsApp en español (especialmente argentino) para registrar gastos e ingresos, o responder consultas financieras.

Tu única tarea es devolver un JSON VÁLIDO sin texto adicional, sin markdown, sin explicaciones.

CATEGORÍAS DISPONIBLES: ${CATEGORIES.join(', ')}

ESTRUCTURA DE RESPUESTA — siempre devolvés este objeto raíz:
{
  "items": [...],
  "confirmation": "<mensaje amigable resumiendo todo lo que hiciste, con emoji>"
}

Donde "items" es un array con UNO o MÁS elementos. Cada elemento puede ser:

1. GASTO:
{
  "type": "expense",
  "amount": <número en pesos, sin símbolo>,
  "category": "<categoría de la lista>",
  "description": "<descripción corta>",
  "date": "<fecha ISO 8601 o null si es hoy>"
}

2. INGRESO:
{
  "type": "income",
  "amount": <número en pesos, sin símbolo>,
  "category": "<Sueldo | Freelance | Transferencia | Otros>",
  "description": "<descripción corta>",
  "date": "<fecha ISO 8601 o null si es hoy>"
}

3. CONSULTA:
{
  "type": "query",
  "queryType": "<balance | monthly_expenses | monthly_income | top_categories | recent>",
  "period": "<current_month | last_month | null>"
}

4. MENSAJE NO ENTENDIDO:
{
  "type": "unknown"
}

REGLAS:
- "k" o "K" = miles (20k = 20000)
- "ayer" = fecha de ayer, "hoy" o sin fecha = null
- category debe ser EXACTAMENTE una de las categorías listadas
- Si el mensaje tiene MÚLTIPLES gastos/ingresos, creá un item por cada uno
- Si hay una consulta, items tiene un solo elemento de tipo query
- Si no entendés nada, items tiene un solo elemento de tipo unknown
- confirmation siempre en segunda persona, resumí todos los ítems registrados
- Solo JSON, sin explicaciones ni markdown

EJEMPLOS:
"gasté 20k en súper" → items: [{expense, 20000, Supermercado}]
"carnicería 23k, verdulería 17k, panadería 3500" → items: [{expense, 23000, Supermercado}, {expense, 17000, Supermercado}, {expense, 3500, Supermercado}]
"ayer pagué 10k de nafta" → items: [{expense, 10000, Nafta, date=ayer}]
"cobré 500k" → items: [{income, 500000, Sueldo}]
"cuánto gasté este mes" → items: [{query, monthly_expenses, current_month}]`;

const QUERY_SYSTEM_PROMPT = `Sos Lulu, asistente financiero de TusGastos. Con los datos financieros del usuario generás una respuesta breve, clara y amigable en español argentino.
- Máximo 3-4 líneas
- Usá emojis con moderación
- Formatá los montos con $ y puntos de miles (ej: $20.000)
- Tono cercano y útil
- Si hay algo llamativo (gasto alto, buen ahorro), mencionalo brevemente`;

// ── Providers ───────────────────────────────────────────────────

async function parseWithOpenAI(message, todayDate) {
  if (!openai) throw new Error('OpenAI no configurado — falta OPENAI_API_KEY');
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Fecha de hoy: ${todayDate}\n\nMensaje: "${message}"` },
    ],
    temperature: 0.1,
    max_tokens: 300,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(completion.choices[0].message.content);
}

async function parseWithGemini(message, todayDate) {
  if (!gemini) throw new Error('Gemini no configurado — falta GEMINI_API_KEY');
  const model = gemini.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
    },
  });
  const prompt = `${SYSTEM_PROMPT}\n\nFecha de hoy: ${todayDate}\n\nMensaje: "${message}"`;
  const result = await model.generateContent(prompt);
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(raw);
}

async function queryWithOpenAI(queryType, data) {
  if (!openai) throw new Error('OpenAI no configurado');
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: QUERY_SYSTEM_PROMPT },
      { role: 'user', content: `Consulta: ${queryType}\nDatos: ${JSON.stringify(data, null, 2)}\n\nGenerá una respuesta para el usuario.` },
    ],
    temperature: 0.7,
    max_tokens: 200,
  });
  return completion.choices[0].message.content;
}

async function queryWithGemini(queryType, data) {
  if (!gemini) throw new Error('Gemini no configurado');
  const model = gemini.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
  });
  const prompt = `${QUERY_SYSTEM_PROMPT}\n\nConsulta: ${queryType}\nDatos: ${JSON.stringify(data, null, 2)}\n\nGenerá una respuesta para el usuario.`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── Lógica de selección y fallback ──────────────────────────────

function getProviderOrder() {
  if (PRIMARY === 'openai') return ['openai', 'gemini'];
  if (PRIMARY === 'gemini') return ['gemini', 'openai'];
  // auto: gemini primero (1500 req/día gratis), openai como respaldo
  if (gemini && openai) return ['gemini', 'openai'];
  if (gemini) return ['gemini'];
  if (openai) return ['openai'];
  throw new Error('Sin LLM configurado. Agregá GEMINI_API_KEY o OPENAI_API_KEY en las variables de entorno.');
}

function isRetryableError(err) {
  // Errores donde tiene sentido probar el otro provider
  const status = err.status || err.httpStatusCode;
  const msg = err.message || '';
  return (
    status === 404 ||                          // Model not found / deprecado
    status === 429 ||                          // Rate limit / quota
    status === 401 ||                          // Auth inválida
    status === 403 ||                          // Forbidden
    msg.includes('quota') ||
    msg.includes('RESOURCE_EXHAUSTED') ||      // Gemini quota
    msg.includes('not found') ||               // Model deprecado
    msg.includes('API key') ||
    msg.includes('billing')
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withFallback(openAiFn, geminiFn, fnName) {
  const order = getProviderOrder();
  let lastError;

  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      logger.debug(`LLM [${provider}]: ${fnName}`);
      const result = provider === 'openai'
        ? await openAiFn()
        : await geminiFn();
      return result;
    } catch (err) {
      lastError = err;
      const isRateLimit = err.status === 429;
      const hasNextProvider = i < order.length - 1;

      if (!isRetryableError(err)) {
        throw err; // Error no recuperable
      }

      if (isRateLimit && !hasNextProvider) {
        // Último provider con rate limit — esperar 3s y reintentar una vez
        logger.warn(`LLM [${provider}] rate limit → esperando 3s y reintentando`);
        await sleep(3000);
        try {
          const result = provider === 'openai'
            ? await openAiFn()
            : await geminiFn();
          return result;
        } catch (retryErr) {
          lastError = retryErr;
        }
      } else if (hasNextProvider) {
        logger.warn(`LLM [${provider}] falló (${err.status || err.message}) → fallback al otro provider`);
      }
    }
  }

  throw lastError;
}

// ── API pública ─────────────────────────────────────────────────

async function parseMessage(message, todayDate) {
  try {
    logger.debug(`Parsing: "${message}"`);
    const result = await withFallback(
      () => parseWithOpenAI(message, todayDate),
      () => parseWithGemini(message, todayDate),
      'parseMessage'
    );
    logger.debug(`LLM parsed: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logger.error('Error parsing message with LLM:', error);
    throw new Error('No pude entender el mensaje');
  }
}

async function generateQueryResponse(queryType, data) {
  try {
    return await withFallback(
      () => queryWithOpenAI(queryType, data),
      () => queryWithGemini(queryType, data),
      'generateQueryResponse'
    );
  } catch (error) {
    logger.error('Error generating query response:', error);
    return 'No pude obtener esa información en este momento. Intentá de nuevo en unos segundos 🙏';
  }
}

module.exports = { parseMessage, generateQueryResponse };
