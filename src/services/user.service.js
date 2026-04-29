const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Obtiene o crea un usuario por número de teléfono.
 * Si es nuevo, verifica si tiene una invitación pendiente.
 * Si tiene invitación, se une a ese hogar. Si no, crea uno por defecto.
 */
async function getOrCreateUserByPhone(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });
  let created = false;

  if (!user) {
    // 1. Crear el usuario
    user = await prisma.user.create({ 
      data: { 
        phone, 
        onboardingStep: 'WAITING_NAME' 
      } 
    });
    created = true;
    logger.info(`New user created: ${phone}`);

    // 2. Buscar invitación pendiente por teléfono
    const pendingInvite = await prisma.householdInvite.findFirst({
      where: {
        phone,
        status: 'PENDING',
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (pendingInvite) {
      // 3a. Unirse al hogar invitado
      await joinHousehold(user.id, pendingInvite.householdId);
      
      // Marcar invitación como aceptada
      await prisma.householdInvite.update({
        where: { id: pendingInvite.id },
        data: { status: 'ACCEPTED', usedById: user.id }
      });
      
      logger.info(`User ${phone} auto-joined household ${pendingInvite.householdId} via pending invite`);
    } else {
      // 3b. Crear hogar por defecto
      const household = await prisma.household.create({
        data: {
          name: `Hogar`,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'ADMIN'
            }
          }
        }
      });
      
      // Establecer como activo
      await prisma.user.update({
        where: { id: user.id },
        data: { activeHouseholdId: household.id }
      });
      
      logger.info(`Default household ${household.id} created for new user ${phone}`);
    }
    
    // Recargar usuario para tener el activeHouseholdId actualizado
    user = await prisma.user.findUnique({ where: { id: user.id } });
  }

  return { user, created };
}

/**
 * Agrega a un usuario a un hogar y lo establece como activo.
 */
async function joinHousehold(userId, householdId) {
  // Crear membresía (si no existe)
  const membership = await prisma.householdMember.upsert({
    where: { userId_householdId: { userId, householdId } },
    update: { role: 'MEMBER' },
    create: {
      userId,
      householdId,
      role: 'MEMBER'
    }
  });

  // Establecer como activo
  await prisma.user.update({
    where: { id: userId },
    data: { activeHouseholdId: householdId }
  });

  return membership;
}

/**
 * El usuario sale de su hogar actual.
 * Si el hogar queda vacío o el usuario es el dueño, se elimina el hogar.
 */
async function leaveHousehold(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: true }
  });

  if (!user || user.memberships.length === 0) return;

  // Si tiene varios hogares (Premium), buscamos el activo o el primero
  const currentHouseholdId = user.activeHouseholdId || user.memberships[0].householdId;

  // Obtener info del hogar antes de borrar nada
  const household = await prisma.household.findUnique({
    where: { id: currentHouseholdId },
    include: { members: true }
  });

  if (!household) return;

  // Eliminar membresía
  await prisma.householdMember.delete({
    where: { userId_householdId: { userId, householdId: currentHouseholdId } }
  });

  // Lógica de limpieza:
  // - Si el usuario era el dueño
  // - O si el hogar se quedó sin miembros
  const isOwner = household.ownerId === userId;
  const remainingMembersCount = household.members.length - 1;

  if (isOwner || remainingMembersCount === 0) {
    await prisma.household.delete({
      where: { id: currentHouseholdId }
    });
    logger.info(`Household ${currentHouseholdId} deleted (User ${userId} was owner or it became empty)`);
  }

  // Limpiar activeHouseholdId
  await prisma.user.update({
    where: { id: userId },
    data: { activeHouseholdId: null }
  });
}

module.exports = {
  getOrCreateUserByPhone,
  joinHousehold,
  leaveHousehold
};
