const logger = require('../utils/logger');
const { getHouseholdInfo, createInvite, acceptInvite } = require('../services/household.service');
const { getActiveHousehold } = require('../services/transaction.service');

/**
 * GET /api/household
 * Devuelve info del hogar activo del usuario autenticado.
 */
async function getHousehold(req, res) {
  try {
    const info = await getHouseholdInfo(req.user.id);
    return res.json(info);
  } catch (error) {
    logger.error('getHousehold error:', error);
    return res.status(400).json({ error: error.message });
  }
}

/**
 * POST /api/household/invite
 * Genera un link de invitación al hogar activo.
 */
async function invite(req, res) {
  try {
    const householdId = await getActiveHousehold(req.user.id);
    const result = await createInvite(householdId, req.user.id);
    return res.json(result);
  } catch (error) {
    logger.error('invite error:', error);
    const status = error.message.includes('límite') ? 403 : 400;
    return res.status(status).json({ error: error.message });
  }
}

/**
 * POST /api/household/join
 * Acepta una invitación usando el token recibido.
 * Body: { token: string }
 */
async function join(req, res) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'El token es requerido' });
    }
    const result = await acceptInvite(token, req.user.id);
    return res.json(result);
  } catch (error) {
    logger.error('join error:', error);
    const status = error.message.includes('no encontrada') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
}

module.exports = { getHousehold, invite, join };
