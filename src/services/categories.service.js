const prisma = require('../config/database');
const logger = require('../utils/logger');

// Categorías por defecto del sistema
const DEFAULT_CATEGORIES = [
  'Supermercado', 'Comida', 'Salidas', 'Transporte', 'Auto',
  'Casa', 'Salud', 'Farmacia', 'Ropa', 'Educación',
  'Viajes', 'Sueldo', 'Freelance', 'Transferencia', 'Otros',
];

/**
 * Obtiene o inicializa las categorías para un hogar (Lazy Seeding)
 */
async function getCategories(householdId) {
  let categories = await prisma.category.findMany({
    where: { householdId },
    orderBy: { name: 'asc' },
  });

  if (categories.length === 0) {
    // Si la casa no tiene categorías, inicializamos con las por defecto
    const defaults = DEFAULT_CATEGORIES.map(name => ({
      householdId,
      name,
      isCustom: false
    }));
    await prisma.category.createMany({ data: defaults });
    
    categories = await prisma.category.findMany({
      where: { householdId },
      orderBy: { name: 'asc' },
    });
  }

  return categories;
}

/**
 * Obtiene los nombres de todas las categorías activas (defaults + customizadas)
 * Usado para alimentar al LLM
 */
async function getCategoryNamesForLLM(householdId) {
  const customCategories = await getCategories(householdId);
  const customNames = customCategories.map(c => c.name);
  
  // Unimos default + custom sin duplicados
  const allNames = Array.from(new Set([...DEFAULT_CATEGORIES, ...customNames]));
  return allNames;
}

/**
 * Crea una nueva categoría personalizada para el hogar.
 * Requiere que el usuario sea PREMIUM (esta chequeo suele hacerse antes, en el middleware/controller).
 */
async function createCategory(householdId, { name, icon }) {
  // Verificar límite / si ya existe
  const exists = await prisma.category.findUnique({
    where: { householdId_name: { householdId, name: name.trim() } }
  });

  if (exists) {
    throw new Error('La categoría ya existe en este hogar');
  }

  const category = await prisma.category.create({
    data: {
      householdId,
      name: name.trim(),
      icon: icon || null,
      isCustom: true
    }
  });

  logger.info(`Custom category created: ${category.name} in household ${householdId}`);
  return category;
}

/**
 * Elimina una categoría personalizada
 */
async function deleteCategory(householdId, categoryId) {
  return await prisma.category.delete({
    where: { id: categoryId, householdId }
  });
}

// ── REGLAS ──────────────────────────────────────────────────────

async function getRules(householdId) {
  return await prisma.categoryRule.findMany({
    where: { householdId },
    include: { category: true },
    orderBy: { createdAt: 'desc' }
  });
}

async function createRule(householdId, { keyword, categoryId }) {
  const lowerKeyword = keyword.trim().toLowerCase();
  
  // Verificar si la categoría pertenece al hogar
  const category = await prisma.category.findFirst({
    where: { id: categoryId, householdId }
  });

  if (!category) {
    throw new Error('La categoría no existe o no pertenece a este hogar');
  }

  const exists = await prisma.categoryRule.findUnique({
    where: { householdId_keyword: { householdId, keyword: lowerKeyword } }
  });

  if (exists) {
    throw new Error('Ya existe una regla para esta palabra clave');
  }

  const rule = await prisma.categoryRule.create({
    data: {
      householdId,
      keyword: lowerKeyword,
      categoryId
    },
    include: { category: true }
  });

  return rule;
}

async function deleteRule(householdId, ruleId) {
  return await prisma.categoryRule.delete({
    where: { id: ruleId, householdId }
  });
}

/**
 * Evalúa las reglas de un hogar contra la descripción de un gasto.
 * Retorna el nombre de la categoría si hizo match, sino null.
 */
async function evaluateRules(householdId, description) {
  if (!description) return null;
  
  const rules = await getRules(householdId);
  const descLower = description.toLowerCase();

  for (const rule of rules) {
    if (descLower.includes(rule.keyword)) {
      return rule.category.name;
    }
  }

  return null;
}

module.exports = {
  DEFAULT_CATEGORIES,
  getCategories,
  getCategoryNamesForLLM,
  createCategory,
  deleteCategory,
  getRules,
  createRule,
  deleteRule,
  evaluateRules,
};
