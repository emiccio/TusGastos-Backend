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
  const membership = await prisma.householdMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
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
  });

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

/**
 * Genera un token de invitación para el hogar activo del usuario.
 * Reutiliza un invite vigente si ya existe uno sin usar para este hogar+usuario.
 */
async function createInvite(householdId, createdById) {
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

  // Reutilizar invite pendiente si existe
  const existing = await prisma.householdInvite.findFirst({
    where: {
      householdId,
      createdById,
      used: false,
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
    data: { householdId, createdById, expiresAt },
  });

  logger.info(`Invite created for household ${householdId} by user ${createdById}`);
  return buildInviteResponse(invite);
}

function buildInviteResponse(invite) {
  const link = `${FRONTEND_URL}/join?token=${invite.token}`;
  return { token: invite.token, link, expiresAt: invite.expiresAt };
}

/**
 * Acepta una invitación y agrega al usuario al hogar.
 */
async function acceptInvite(token, userId) {
  const invite = await prisma.householdInvite.findUnique({
    where: { token },
    include: {
      household: {
        include: { members: true, owner: true },
      },
    },
  });

  if (!invite) {
    throw new Error('Invitación no encontrada');
  }
  if (invite.used) {
    throw new Error('Esta invitación ya fue utilizada');
  }
  if (invite.expiresAt < new Date()) {
    throw new Error('Esta invitación ha expirado');
  }

  // Si el usuario ya es miembro, simplemente lo marcamos como usado y redirigimos
  const alreadyMember = invite.household.members.some((m) => m.userId === userId);
  if (alreadyMember) {
    await prisma.householdInvite.update({
      where: { token },
      data: { used: true, usedById: userId },
    });
    return { alreadyMember: true, householdName: invite.household.name };
  }

  // Verificar que el usuario pueda unirse a más hogares (límite del plan del usuario)
  const canJoin = await require('./plan.service').canJoinMoreHouseholds(userId);
  if (!canJoin) {
    throw new Error('Tu plan actual no permite pertenecer a más de un hogar. Pasate a Premium para multihogar.');
  }

  // Verificar límite del plan del hogar
  const canInvite = await canAddMemberToHousehold(invite.householdId);
  if (!canInvite) {
    throw new Error('El hogar ya alcanzó el límite de miembros de su plan');
  }

  // Agregar miembro y marcar invite como usado en una transacción
  await prisma.$transaction([
    prisma.householdMember.create({
      data: {
        userId,
        householdId: invite.householdId,
        role: 'MEMBER',
      },
    }),
    prisma.householdInvite.update({
      where: { token },
      data: { used: true, usedById: userId },
    }),
  ]);

  logger.info(`User ${userId} joined household ${invite.householdId} via invite ${token}`);
  return { alreadyMember: false, householdName: invite.household.name };
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

module.exports = { getHouseholdInfo, createInvite, acceptInvite, listUserHouseholds, switchActiveHousehold, createHousehold };
