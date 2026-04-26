const transactionService = require('../services/transaction.service');
const logger = require('../utils/logger');

/**
 * GET /transactions
 * Lista de transacciones con filtros y paginación
 */
async function list(req, res) {
  try {
    const { page, limit, type, category, from, to, userId } = req.query;

    const result = await transactionService.getTransactions(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      type,
      category,
      from,
      to,
      userId,
    });

    return res.json(result);
  } catch (error) {
    logger.error('Error listing transactions:', error);
    return res.status(500).json({ error: 'Error al obtener transacciones' });
  }
}

/**
 * POST /transactions
 * Crear transacción manual desde el dashboard
 */
async function create(req, res) {
  try {
    const { type, amount, category, description, date, paymentMethod } = req.body;

    if (!type || !amount || !category) {
      return res.status(400).json({ error: 'type, amount y category son requeridos' });
    }

    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser income o expense' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'amount debe ser un número positivo' });
    }

    const transaction = await transactionService.createTransaction({
      userId: req.user.id,
      type,
      amount,
      category,
      description,
      date: date ? new Date(date) : new Date(),
      paymentMethod,
    });

    return res.status(201).json(transaction);
  } catch (error) {
    logger.error('Error creating transaction:', error);
    return res.status(500).json({ error: 'Error al crear transacción' });
  }
}

/**
 * DELETE /transactions/:id
 * Eliminar transacción
 */
async function remove(req, res) {
  try {
    const { id } = req.params;

    // Verificar que la transacción pertenece al usuario
    const { PrismaClient } = require('@prisma/client');
    const prisma = require('../config/database');

    const transaction = await prisma.transaction.findFirst({
      where: { 
        id, 
        household: { 
          members: { 
            some: { userId: req.user.id } 
          } 
        } 
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transacción no encontrada o sin permisos' });
    }

    await prisma.transaction.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting transaction:', error);
    return res.status(500).json({ error: 'Error al eliminar transacción' });
  }
}

/**
 * GET /transactions/summary
 * Resumen financiero del dashboard
 */
async function summary(req, res) {
  try {
    const data = await transactionService.getDashboardData(req.user.id);
    return res.json(data);
  } catch (error) {
    logger.error('Error getting summary:', error);
    return res.status(500).json({ error: 'Error al obtener resumen' });
  }
}

/**
 * GET /transactions/categories
 * Lista de categorías con totales
 */
async function categories(req, res) {
  try {
    const { monthOffset } = req.query;
    const data = await transactionService.getTopCategories(
      req.user.id,
      parseInt(monthOffset) || 0
    );
    return res.json(data);
  } catch (error) {
    logger.error('Error getting categories:', error);
    return res.status(500).json({ error: 'Error al obtener categorías' });
  }
}

module.exports = { list, create, remove, summary, categories };
