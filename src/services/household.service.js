const prisma = require('../config/database');
const logger = require('../utils/logger');
const { canAddMemberToHousehold } = require('./plan.service');

const INVITE_EXPIRY_DAYS = 7;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Devuelve información del hogar activo del usuario:
 * nombre, plan, lista de miembros, y si puede invitar más gente.
 */
async function getHouseholdInfo(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeHouseholdId: true }
  });

  let membership = await prisma.householdMember.findFirst({
    where: { 
      userId,
      householdId: user?.activeHouseholdId || undefined
    },
    include: {
      household: {
        include: {
          owner: { select: { id: true, phone: true, name: true, plan: true } },
          members: {
            include: {
              user: { select: { id: true, phone: true, name: true } },
            },
            orderBy: { joinedAt: 'asc' },
          },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  // Si no se encontró el "activo" (quizás ya no es miembro), buscar el primero disponible
  if (!membership && user?.activeHouseholdId) {
    membership = await prisma.householdMember.findFirst({
      where: { userId },
      include: {
        household: {
          include: {
            owner: { select: { id: true, phone: true, name: true, plan: true } },
            members: {
              include: {
                user: { select: { id: true, phone: true, name: true } },
              },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    if (membership) {
      // Actualizar el activeHouseholdId al nuevo encontrado
      await prisma.user.update({
        where: { id: userId },
        data: { activeHouseholdId: membership.householdId }
      });
    }
  }

  if (!membership) {
    throw new Error('El usuario no pertenece a ningún hogar');
  }

  const { household } = membership;
  const canInvite = await canAddMemberToHousehold(household.id);

  return {
    id: household.id,
    name: household.name,
    plan: household.owner.plan,
    isOwner: household.ownerId === userId,
    canInvite,
    members: household.members.map((m) => ({
      id: m.user.id,
      phone: m.user.phone,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  };
}

const userService = require('./user.service');

/**
 * Genera un token de invitación para el hogar activo del usuario, vinculado a un teléfono.
 * Reutiliza un invite vigente si ya existe uno PENDING para este hogar + teléfono.
 */
async function createInvite(householdId, createdById, phone) {
  if (!phone) throw new Error('El teléfono es requerido para invitar');
  const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, '');

  // Verificar que el usuario es ADMIN/owner del hogar
  const member = await prisma.householdMember.findUnique({
    where: { userId_householdId: { userId: createdById, householdId } },
  });

  if (!member || member.role !== 'ADMIN') {
    throw new Error('Solo el administrador del hogar puede crear invitaciones');
  }

  const canInvite = await canAddMemberToHousehold(householdId);
  if (!canInvite) {
    throw new Error('El hogar ya alcanzó el límite de miembros de su plan');
  }

  // Reutilizar invite pendiente si existe para este teléfono en este hogar
  const existing = await prisma.householdInvite.findFirst({
    where: {
      householdId,
      phone: normalizedPhone,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return buildInviteResponse(existing);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const invite = await prisma.householdInvite.create({
    data: { 
      householdId, 
      createdById, 
      phone: normalizedPhone, 
      status: 'PENDING',
      expiresAt 
    },
  });

  logger.info(`Invite created for household ${householdId} to phone ${normalizedPhone} by user ${createdById}`);
  return buildInviteResponse(invite);
}

function buildInviteResponse(invite) {
  const link = `${FRONTEND_URL}/join?token=${invite.token}`;
  return { token: invite.token, link, expiresAt: invite.expiresAt };
}

/**
 * Acepta la invitación pendiente para el usuario (basado en su teléfono).
 */
async function acceptInviteForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');

  const invite = await prisma.householdInvite.findFirst({
    where: {
      phone: user.phone,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    include: {
      household: { include: { members: true, owner: true } },
    },
  });

  if (!invite) {
    throw new Error('No tenés ninguna invitación pendiente');
  }

  // Si el usuario ya es miembro, simplemente marcamos como aceptada
  const alreadyMember = invite.household.members.some((m) => m.userId === userId);
  if (alreadyMember) {
    await prisma.householdInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', usedById: userId },
    });
    return { alreadyMember: true, householdName: invite.household.name };
  }

  // Si el plan es FREE, debe salir de su hogar actual primero
  if (user.plan === 'FREE') {
    await userService.leaveHousehold(userId);
  } else {
    // Si es PREMIUM, verificar si puede unirse a más (aunque PREMIUM suele ser ilimitado)
    const canJoin = await require('./plan.service').canJoinMoreHouseholds(userId);
    if (!canJoin) {
      throw new Error('Tu plan actual no permite pertenecer a más hogares.');
    }
  }

  // Verificar límite del plan del hogar destino
  const canInvite = await canAddMemberToHousehold(invite.householdId);
  if (!canInvite) {
    throw new Error('El hogar destino ya alcanzó el límite de miembros de su plan');
  }

  // Unirse y marcar invite como aceptado
  await prisma.$transaction([
    prisma.householdInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', usedById: userId },
    }),
    prisma.householdMember.create({
      data: {
        userId,
        householdId: invite.householdId,
        role: 'MEMBER',
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { activeHouseholdId: invite.householdId }
    })
  ]);

  logger.info(`User ${userId} accepted invite for household ${invite.householdId}`);
  return { alreadyMember: false, householdName: invite.household.name };
}

/**
 * Rechaza la invitación pendiente del usuario.
 */
async function declineInvite(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');

  const invite = await prisma.householdInvite.findFirst({
    where: {
      phone: user.phone,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
  });

  if (!invite) return;

  await prisma.householdInvite.update({
    where: { id: invite.id },
    data: { status: 'DECLINED' },
  });

  logger.info(`User ${userId} declined invite ${invite.id}`);
}

/**
 * Mantiene compatibilidad con el link del frontend (token-based).
 */
async function acceptInvite(token, userId) {
  const invite = await prisma.householdInvite.findUnique({
    where: { token },
  });

  if (!invite) throw new Error('Invitación no encontrada');
  if (invite.status !== 'PENDING') throw new Error('Esta invitación ya no es válida');
  if (invite.expiresAt < new Date()) throw new Error('Esta invitación ha expirado');
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (invite.phone !== user.phone) {
    throw new Error('Esta invitación no es para vos');
  }

  return acceptInviteForUser(userId);
}

/**
 * Lista todos los hogares a los que el usuario tiene acceso.
 */
async function listUserHouseholds(userId) {
  const memberships = await prisma.householdMember.findMany({
    where: { userId },
    include: {
      household: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          owner: { select: { plan: true } }
        }
      }
    }
  });

  return memberships.map(m => ({
    id: m.household.id,
    name: m.household.name,
    isOwner: m.household.ownerId === userId,
    plan: m.household.owner.plan,
    role: m.role
  }));
}

/**
 * Cambia el hogar activo del usuario, previa validación de pertenencia.
 */
async function switchActiveHousehold(userId, householdId) {
  // Validar que el usuario sea miembro
  const membership = await prisma.householdMember.findUnique({
    where: { userId_householdId: { userId, householdId } }
  });

  if (!membership) {
    throw new Error('No tenés acceso a este hogar');
  }

  // Actualizar preferencia
  const user = await prisma.user.update({
    where: { id: userId },
    data: { activeHouseholdId: householdId }
  });

  logger.info(`User ${userId} switched active household to ${householdId}`);
  return user;
}

/**
 * Crea un nuevo hogar y hace al usuario dueño y administrador.
 */
async function createHousehold(userId, name) {
  const { canCreateHousehold } = require('./plan.service');
  const allowed = await canCreateHousehold(userId);

  if (!allowed) {
    throw new Error('Tu plan actual no permite crear más hogares. Pasate a Premium para multihogar.');
  }

  const household = await prisma.household.create({
    data: {
      name,
      ownerId: userId,
      members: {
        create: {
          userId,
          role: 'ADMIN'
        }
      }
    }
  });

  // Establecer como activo automáticamente
  await prisma.user.update({
    where: { id: userId },
    data: { activeHouseholdId: household.id }
  });

  logger.info(`User ${userId} created new household ${household.id} ("${name}")`);
  return household;
}

module.exports = { 
  getHouseholdInfo, 
  createInvite, 
  acceptInvite, 
  acceptInviteForUser,
  declineInvite,
  listUserHouseholds, 
  switchActiveHousehold, 
  createHousehold 
};
