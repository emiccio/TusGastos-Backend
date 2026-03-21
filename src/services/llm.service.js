const OpenAI = require('openai');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Categorías predefinidas para mantener consistencia
const CATEGORIES = [
  'Supermercado',
  'Restaurantes',
  'Transporte',
  'Nafta',
  'Servicios',
  'Salud',
  'Farmacia',
  'Ropa',
  'Entretenimiento',
  'Educación',
  'Viajes',
  'Hogar',
  'Sueldo',
  'Freelance',
  'Transferencia',
  'Otros',
];

const SYSTEM_PROMPT = `Sos Lulu, el asistente financiero de TusGastos. Analizás mensajes de WhatsApp en español (especialmente argentino) para registrar gastos e ingresos, o responder consultas financieras.

Tu única tarea es devolver un JSON VÁLIDO sin texto adicional, sin markdown, sin explicaciones.

CATEGORÍAS DISPONIBLES: ${CATEGORIES.join(', ')}

TIPOS DE RESPUESTA:

1. REGISTRO DE GASTO:
{
  "type": "expense",
  "amount": <número en pesos, sin símbolo>,
  "category": "<categoría de la lista>",
  "description": "<descripción corta>",
  "date": "<fecha ISO 8601 o null si es hoy>",
  "confirmation": "<mensaje amigable confirmando el registro, máx 1 oración, con emoji>"
}

2. REGISTRO DE INGRESO:
{
  "type": "income",
  "amount": <número en pesos, sin símbolo>,
  "category": "<Sueldo | Freelance | Transferencia | Otros>",
  "description": "<descripción corta>",
  "date": "<fecha ISO 8601 o null si es hoy>",
  "confirmation": "<mensaje amigable confirmando el registro, máx 1 oración, con emoji>"
}

3. CONSULTA (cuando el usuario pregunta algo sobre sus finanzas):
{
  "type": "query",
  "queryType": "<balance | monthly_expenses | monthly_income | top_categories | recent>",
  "period": "<current_month | last_month | null>",
  "confirmation": "<mensaje diciendo que vas a buscar la info>"
}

4. MENSAJE NO ENTENDIDO:
{
  "type": "unknown",
  "confirmation": "<mensaje amigable pidiendo que reformule, con sugerencia de ejemplo>"
}

REGLAS DE INTERPRETACIÓN:
- "k" o "K" = miles (20k = 20000)
- "pesos", "$", sin unidad = pesos argentinos
- "ayer" = fecha de ayer
- "hoy", sin fecha = null (se usa la fecha actual)
- "el lunes", "el martes", etc = calcular fecha relativa
- Siempre redondear a 2 decimales si es necesario
- Si el monto es ambiguo, usar el más razonable
- category debe ser EXACTAMENTE una de las categorías listadas
- El campo confirmation siempre en segunda persona ("Ya anoté...", "Perfecto...")
- Tono: cercano, argentino, breve, útil

EJEMPLOS:
"gasté 20k en súper" → expense, 20000, Supermercado
"ayer pagué 10k de nafta" → expense, 10000, Nafta, date=ayer
"cobré 500k" → income, 500000, Sueldo
"me transfirieron 100k" → income, 100000, Transferencia
"cuánto gasté este mes" → query, monthly_expenses, current_month
"cuánto me queda" → query, balance, current_month
"en qué gasto más" → query, top_categories, current_month`;

/**
 * Parsea un mensaje de WhatsApp y devuelve la acción a realizar
 * @param {string} message - Mensaje del usuario
 * @param {string} todayDate - Fecha de hoy en ISO (para contexto del LLM)
 * @returns {Object} Acción parseada
 */
async function parseMessage(message, todayDate) {
  try {
    logger.debug(`Parsing message: "${message}"`);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Fecha de hoy: ${todayDate}\n\nMensaje: "${message}"`,
        },
      ],
      temperature: 0.1, // Baja temperatura para respuestas consistentes
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content;
    logger.debug(`LLM response: ${raw}`);

    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    logger.error('Error parsing message with LLM:', error);
    throw new Error('No pude entender el mensaje');
  }
}

/**
 * Genera una respuesta de consulta con los datos reales de la DB
 * @param {string} queryType - Tipo de consulta
 * @param {Object} data - Datos financieros del usuario
 * @returns {string} Respuesta para enviar por WhatsApp
 */
async function generateQueryResponse(queryType, data) {
  try {
    const dataStr = JSON.stringify(data, null, 2);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Sos Lulu, asistente financiero de TusGastos. Con los datos financieros del usuario, generás una respuesta breve, clara y amigable en español argentino. 
          - Máximo 3-4 líneas
          - Usá emojis con moderación
          - Formatá los montos con $ y puntos de miles (ej: $20.000)
          - Tono cercano y útil
          - Si hay algo llamativo (gasto alto, buen ahorro), mencionalo brevemente`,
        },
        {
          role: 'user',
          content: `Consulta: ${queryType}\nDatos: ${dataStr}\n\nGenerá una respuesta para el usuario.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    logger.error('Error generating query response:', error);
    return 'No pude obtener esa información en este momento. Intentá de nuevo en unos segundos 🙏';
  }
}

module.exports = { parseMessage, generateQueryResponse };
