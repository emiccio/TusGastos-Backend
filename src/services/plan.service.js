const prisma = require('../config/database');
const logger = require('../utils/logger');

const PLAN_LIMITS = {
  FREE: {
    maxHouseholdsOwned: 1, // ¿Cuántos hogares puede crear?
    maxHouseholdMembers: 2, // ¿Cuántas personas pueden estar en su hogar?
  },
  PREMIUM: {
    maxHouseholdsOwned: 999,
    maxHouseholdMembers: 999,
  }
};

/**
 * Valida si un usuario puede crear/ser dueño de más hogares
 */
async function canCreateHousehold(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { ownedHouseholds: true }
  });

  if (!user) return false;

  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.FREE;
  return user.ownedHouseholds.length < limits.maxHouseholdsOwned;
}

/**
 * Valida si se puede agregar un miembro a un hogar
 */
async function canAddMemberToHousehold(householdId) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: { owner: true, members: true }
  });

  if (!household) return false;

  const limits = PLAN_LIMITS[household.owner.plan] || PLAN_LIMITS.FREE;
  return household.members.length < limits.maxHouseholdMembers;
}

/**
 * Valida si un usuario puede unirse a más hogares (ser miembro de más de uno)
 */
async function canJoinMoreHouseholds(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: true }
  });

  if (!user) return false;

  // Si es PREMIUM, no hay límite de membresías
  if (user.plan === 'PREMIUM') return true;

  // Si es FREE, solo puede pertenecer a 1 hogar en total
  return user.memberships.length < PLAN_LIMITS.FREE.maxHouseholdsOwned; // Usamos el mismo límite que para ser dueño
}

module.exports = {
  PLAN_LIMITS,
  canCreateHousehold,
  canAddMemberToHousehold,
  canJoinMoreHouseholds
};
