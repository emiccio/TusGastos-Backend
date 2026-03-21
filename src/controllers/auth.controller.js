const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { getOrCreateUser } = require('../services/transaction.service');
const logger = require('../utils/logger');

/**
 * POST /auth/login
 * Login simple por número de teléfono
 * En producción se podría agregar OTP vía WhatsApp
 */
async function login(req, res) {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'El número de teléfono es requerido' });
    }

    // Normalizar teléfono (remover espacios, guiones, +)
    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, '');

    const user = await getOrCreateUser(normalizedPhone);

    // Generar JWT
    const token = jwt.sign(
      { userId: user.id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    // Guardar sesión
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.session.create({
      data: { userId: user.id, token, expiresAt },
    });

    logger.info(`User ${normalizedPhone} logged in`);

    return res.json({
      token,
      user: { id: user.id, phone: user.phone, name: user.name },
    });
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
}

/**
 * POST /auth/logout
 */
async function logout(req, res) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await prisma.session.deleteMany({ where: { token } });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cerrar sesión' });
  }
}

/**
 * GET /auth/me
 */
async function me(req, res) {
  return res.json({
    user: { id: req.user.id, phone: req.user.phone, name: req.user.name },
  });
}

module.exports = { login, logout, me };
