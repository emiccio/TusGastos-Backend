const categoriesService = require('../services/categories.service');
const transactionService = require('../services/transaction.service');

// Middleware manual/helper para conseguir el household actual y verificar plan.
// (Asumimos que req.user.id viene seteado por auth middleware)
async function getHouseholdAndCheckPremium(userId) {
  const householdId = await transactionService.getActiveHousehold(userId);
  const prisma = require('../config/database');
  const household = await prisma.household.findUnique({ where: { id: householdId }, include: { owner: true } });
  
  if (household?.owner?.plan !== 'PREMIUM') {
    throw new Error('PREMIUM_REQUIRED');
  }
  
  return householdId;
}

async function getCategories(req, res) {
  try {
    const householdId = await transactionService.getActiveHousehold(req.user.id);
    const categories = await categoriesService.getCategories(householdId);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createCategory(req, res) {
  try {
    const householdId = await getHouseholdAndCheckPremium(req.user.id);
    const category = await categoriesService.createCategory(householdId, req.body);
    res.status(201).json(category);
  } catch (error) {
    if (error.message === 'PREMIUM_REQUIRED') {
      return res.status(403).json({ error: 'Disponible solo en Plan Premium' });
    }
    res.status(400).json({ error: error.message });
  }
}

async function deleteCategory(req, res) {
  try {
    const householdId = await getHouseholdAndCheckPremium(req.user.id);
    await categoriesService.deleteCategory(householdId, req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error.message === 'PREMIUM_REQUIRED') {
      return res.status(403).json({ error: 'Disponible solo en Plan Premium' });
    }
    res.status(400).json({ error: error.message });
  }
}

async function getRules(req, res) {
  try {
    const householdId = await transactionService.getActiveHousehold(req.user.id);
    const rules = await categoriesService.getRules(householdId);
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createRule(req, res) {
  try {
    const householdId = await getHouseholdAndCheckPremium(req.user.id);
    const rule = await categoriesService.createRule(householdId, req.body);
    res.status(201).json(rule);
  } catch (error) {
    if (error.message === 'PREMIUM_REQUIRED') {
      return res.status(403).json({ error: 'Disponible solo en Plan Premium' });
    }
    res.status(400).json({ error: error.message });
  }
}

async function deleteRule(req, res) {
  try {
    const householdId = await getHouseholdAndCheckPremium(req.user.id);
    await categoriesService.deleteRule(householdId, req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error.message === 'PREMIUM_REQUIRED') {
      return res.status(403).json({ error: 'Disponible solo en Plan Premium' });
    }
    res.status(400).json({ error: error.message });
  }
}

module.exports = {
  getCategories,
  createCategory,
  deleteCategory,
  getRules,
  createRule,
  deleteRule,
};
