const prisma = require('../config/database');
const logger = require('../utils/logger');
const { startOfMonth, endOfMonth, startOfDay, endOfDay, subMonths, format } = require('./date.utils');

/**
 * Obtiene o crea un usuario por número de teléfono
 */
async function getOrCreateUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    user = await prisma.user.create({ data: { phone } });
    logger.info(`New user created: ${phone}`);
  }

  return user;
}

/**
 * Crea una transacción
 */
async function createTransaction({ userId, type, amount, category, description, date, rawMessage }) {
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type,
      amount,
      category,
      description: description || null,
      date: date ? new Date(date) : new Date(),
      rawMessage: rawMessage || null,
    },
  });

  logger.info(`Transaction created: ${type} $${amount} (${category}) for user ${userId}`);
  return transaction;
}

/**
 * Obtiene el balance del mes actual
 */
async function getMonthlyBalance(userId, monthOffset = 0) {
  const now = new Date();
  const targetMonth = subMonths(now, monthOffset);
  const from = startOfMonth(targetMonth);
  const to = endOfMonth(targetMonth);

  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: from, lte: to } },
    select: { type: true, amount: true },
  });

  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const expenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    period: format(targetMonth, 'MMMM yyyy'),
    income,
    expenses,
    balance: income - expenses,
    transactionCount: transactions.length,
  };
}

/**
 * Obtiene gastos agrupados por categoría del mes actual
 */
async function getTopCategories(userId, monthOffset = 0) {
  const now = new Date();
  const targetMonth = subMonths(now, monthOffset);
  const from = startOfMonth(targetMonth);
  const to = endOfMonth(targetMonth);

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: 'expense', date: { gte: from, lte: to } },
    select: { category: true, amount: true },
  });

  // Agrupar por categoría
  const grouped = transactions.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});

  // Ordenar por monto descendente
  const sorted = Object.entries(grouped)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    period: format(targetMonth, 'MMMM yyyy'),
    categories: sorted,
    totalExpenses: transactions.reduce((sum, t) => sum + t.amount, 0),
  };
}

/**
 * Obtiene las últimas transacciones
 */
async function getRecentTransactions(userId, limit = 5) {
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: limit,
    select: {
      type: true,
      amount: true,
      category: true,
      description: true,
      date: true,
    },
  });

  return transactions;
}

/**
 * Obtiene datos completos para el dashboard (usado por la API REST)
 */
async function getDashboardData(userId) {
  const [currentMonth, lastMonth, topCategories, recent] = await Promise.all([
    getMonthlyBalance(userId, 0),
    getMonthlyBalance(userId, 1),
    getTopCategories(userId, 0),
    getRecentTransactions(userId, 10),
  ]);

  return { currentMonth, lastMonth, topCategories, recent };
}

/**
 * Obtiene transacciones con filtros (para la tabla del frontend)
 */
async function getTransactions(userId, { page = 1, limit = 20, type, category, from, to } = {}) {
  const where = { userId };

  if (type) where.type = type;
  if (category) where.category = category;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Resuelve una consulta de tipo "query" del LLM y devuelve los datos
 */
async function getCategoryExpenses(userId, category, monthOffset = 0) {
  const now = new Date();
  const targetMonth = subMonths(now, monthOffset);
  const from = startOfMonth(targetMonth);
  const to = endOfMonth(targetMonth);

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: 'expense', category, date: { gte: from, lte: to } },
    select: { amount: true, description: true, date: true },
    orderBy: { date: 'desc' },
  });

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);

  return {
    period: format(targetMonth, 'MMMM yyyy'),
    category,
    total,
    count: transactions.length,
    transactions: transactions.slice(0, 5), // últimas 5 para contexto
  };
}

async function resolveQuery(userId, queryType, period, category = null) {
  const monthOffset = period === 'last_month' ? 1 : 0;

  switch (queryType) {
    case 'balance':
    case 'monthly_expenses':
    case 'monthly_income':
      return getMonthlyBalance(userId, monthOffset);
    case 'top_categories':
      return getTopCategories(userId, monthOffset);
    case 'category_expenses':
      return getCategoryExpenses(userId, category || 'Otros', monthOffset);
    case 'recent':
      return getRecentTransactions(userId, 5);
    default:
      return getMonthlyBalance(userId, 0);
  }
}

module.exports = {
  getOrCreateUser,
  createTransaction,
  getMonthlyBalance,
  getTopCategories,
  getRecentTransactions,
  getDashboardData,
  getTransactions,
  resolveQuery,
};
