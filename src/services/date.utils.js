/**
 * Utilidades de fecha simples para no depender de date-fns
 */

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function subMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function format(date, pattern) {
  if (pattern === 'MMMM yyyy') {
    return `${MONTHS_ES[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (pattern === 'dd/MM/yyyy') {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }
  return date.toISOString();
}

/**
 * Convierte expresiones de fecha en español a objetos Date
 * Usado cuando el LLM devuelve null (hoy) o una fecha ISO
 */
function resolveDate(dateStr) {
  if (!dateStr) return new Date();

  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  } catch (_) {}

  return new Date();
}

module.exports = { startOfMonth, endOfMonth, startOfDay, endOfDay, subMonths, format, resolveDate };
