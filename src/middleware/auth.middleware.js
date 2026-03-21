const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const logger = require('../utils/logger');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verificar JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Verificar que la sesión existe en DB (permite logout real)
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }

    req.user = session.user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Error de autenticación' });
  }
}

module.exports = authMiddleware;
