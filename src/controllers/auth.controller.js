const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { getOrCreateUser } = require('../services/transaction.service');
const whatsappService = require('../services/whatsapp.service');
const logger = require('../utils/logger');

// TTL del código OTP en minutos
const OTP_TTL_MINUTES = 10;

/**
 * Genera un código numérico de 6 dígitos
 */
function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /auth/request-otp
 * Recibe el número, genera un código y lo manda por WhatsApp
 */
async function requestOtp(req, res) {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'El número de teléfono es requerido' });
    }

    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, '');

    // Verificar que el usuario existe y tiene el onboarding completo
    const existingUser = await prisma.user.findUnique({ where: { phone: normalizedPhone } });

    if (!existingUser) {
      // No revelar si el usuario existe o no — mensaje genérico
      return res.status(404).json({
        error: 'no_account',
        message: 'No encontramos una cuenta con ese número. ¿Ya te registraste por WhatsApp?',
      });
    }

    if (existingUser.onboardingStep !== null) {
      return res.status(403).json({
        error: 'onboarding_incomplete',
        message: 'Todavía no terminaste el registro. Continuá la conversación con Lulú por WhatsApp.',
      });
    }

    // Invalidar OTPs anteriores del mismo usuario
    await prisma.otpCode.deleteMany({ where: { userId: existingUser.id } });

    // Crear nuevo OTP
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await prisma.otpCode.create({
      data: { userId: existingUser.id, code, expiresAt },
    });

    // Mandar el código por WhatsApp
    await whatsappService.sendTextMessage(
      normalizedPhone,
      `Tu código de acceso a Lulú es: *${code}*\n\nVálido por ${OTP_TTL_MINUTES} minutos. No lo compartas con nadie.`
    );

    logger.info(`OTP sent to ${normalizedPhone}`);

    return res.json({ success: true, message: 'Código enviado por WhatsApp' });

  } catch (error) {
    logger.error('requestOtp error:', error);
    return res.status(500).json({ error: 'Error al enviar el código' });
  }
}

/**
 * POST /auth/login
 * Recibe el número + código OTP y devuelve el JWT si es válido
 */
async function login(req, res) {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: 'Número y código son requeridos' });
    }

    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, '');

    const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(401).json({ error: 'Código inválido o expirado' });
    }

    // Verificar onboarding (doble chequeo por si acaso)
    if (user.onboardingStep !== null) {
      return res.status(403).json({
        error: 'onboarding_incomplete',
        message: 'Todavía no terminaste el registro. Continuá la conversación con Lulú por WhatsApp.',
      });
    }

    // Buscar OTP válido
    const otp = await prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!otp) {
      return res.status(401).json({ error: 'Código inválido o expirado' });
    }

    // Marcar OTP como usado
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    // Generar JWT
    const token = jwt.sign(
      { userId: user.id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.session.create({
      data: { userId: user.id, token, expiresAt },
    });

    logger.info(`User ${normalizedPhone} logged in via OTP`);

    return res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        plan: user.plan,
        activeHouseholdId: user.activeHouseholdId,
      },
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
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      phone: true,
      name: true,
      plan: true,
      activeHouseholdId: true,
    },
  });

  return res.json({ user });
}

module.exports = { requestOtp, login, logout, me };