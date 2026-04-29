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
    const { phone } = req.body;
    const householdId = await getActiveHousehold(req.user.id);
    const result = await createInvite(householdId, req.user.id, phone);
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

/**
 * GET /api/household/list
 * Lista todos los hogares a los que pertenece el usuario.
 */
async function listHouseholds(req, res) {
  try {
    const { listUserHouseholds } = require('../services/household.service');
    const households = await listUserHouseholds(req.user.id);
    return res.json(households);
  } catch (error) {
    logger.error('listHouseholds error:', error);
    return res.status(500).json({ error: 'Error al listar hogares' });
  }
}

/**
 * POST /api/household/switch
 * Cambia el hogar activo del usuario.
 * Body: { householdId: string }
 */
async function switchHousehold(req, res) {
  try {
    const { householdId } = req.body;
    if (!householdId) {
      return res.status(400).json({ error: 'El ID del hogar es requerido' });
    }

    const { switchActiveHousehold } = require('../services/household.service');
    const user = await switchActiveHousehold(req.user.id, householdId);

    return res.json({ success: true, activeHouseholdId: user.activeHouseholdId });
  } catch (error) {
    logger.error('switchHousehold error:', error);
    return res.status(400).json({ error: error.message });
  }
}

/**
 * POST /api/household
 * Crea un nuevo hogar para el usuario (solo si el plan lo permite).
 * Body: { name: string }
 */
async function createHousehold(req, res) {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'El nombre del hogar es requerido' });
    }

    const { createHousehold: createHouseholdService } = require('../services/household.service');
    const household = await createHouseholdService(req.user.id, name);

    return res.json(household);
  } catch (error) {
    logger.error('createHousehold error:', error);
    const status = error.message.includes('límite') ? 403 : 400;
    return res.status(status).json({ error: error.message });
  }
}

/**
 * PUT /api/household/name
 * Actualiza el nombre del hogar activo.
 * Body: { name: string }
 */
async function updateName(req, res) {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const { updateHouseholdName } = require('../services/household.service');
    const householdId = await getActiveHousehold(req.user.id);
    const updatedHousehold = await updateHouseholdName(req.user.id, householdId, name);

    return res.json(updatedHousehold);
  } catch (error) {
    logger.error('updateName error:', error);
    const status = error.message.includes('administradores') ? 403 : 400;
    return res.status(status).json({ error: error.message });
  }
}

module.exports = { getHousehold, invite, join, listHouseholds, switchHousehold, createHousehold, updateName };
