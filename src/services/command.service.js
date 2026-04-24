const categoriesService = require('./categories.service');
const transactionService = require('./transaction.service');

function normalize(text) {
  return text
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function handleCommand(message, user) {
  const msg = normalize(message);

  // ── DASHBOARD ─────────────────────────
  if (msg.includes("dashboard") || msg.includes("panel")) {
    return {
      handled: true,
      type: "response",
      response: "Podés ver tu panel acá:\nhttps://tus-gastos.vercel.app/dashboard"
    };
  }

  // ── AYUDA ─────────────────────────────
  if (
    msg.includes("ayuda") ||
    msg.includes("help") ||
    msg.includes("que puedo hacer") ||
    msg === "/start" ||
    msg === "menu"
  ) {
    return {
      handled: true,
      type: "response",
      response:
        `Soy Lulú y estoy acá para ayudarte a controlar tu plata.

Podés decirme cosas como:
• "super 20k"
• "cobré 500k"
• "farmacia 8500 ayer"

O preguntarme:
• "¿cuánto gasté hoy?"
• "saldo"
• "gastos de este mes"

Comandos directos:
- *panel*: link a la web
- *categorias*: lista de categorías
- *ayuda*: este mensaje`
    };
  }

  // ── CATEGORÍAS ────────────────────────
  if (msg.includes("categorias")) {
    const householdId = await transactionService.getActiveHousehold(user.id);
    const categories = await categoriesService.getCategoryNamesForLLM(householdId);

    return {
      handled: true,
      type: "response",
      response:
        `📂 Tus categorías disponibles:

${categories.map(c => `• ${c}`).join("\n")}

Ejemplo:
uber 3500
supermercado 15000`
    };
  }

  // ── QUERIES RÁPIDAS ───────────────────

  // Saldo / Balance
  if (msg.includes("saldo") || msg.includes("balance")) {
    return {
      handled: true,
      type: "query",
      queryType: "balance",
      period: "current_month"
    };
  }

  // Gastos
  if (
    msg === "gastos" ||
    msg.includes("cuanto gaste") ||
    msg.includes("mis gastos") ||
    msg.includes("resumen de gastos")
  ) {
    return {
      handled: true,
      type: "query",
      queryType: "monthly_expenses",
      period: "current_month"
    };
  }

  // Ingresos
  if (
    msg === "ingresos" ||
    msg.includes("cuanto cobre") ||
    msg.includes("mis ingresos") ||
    msg.includes("resumen de ingresos")
  ) {
    return {
      handled: true,
      type: "query",
      queryType: "monthly_income",
      period: "current_month"
    };
  }

  // Gracias
  if (msg.includes("gracias") || msg === "chau" || msg === "adios") {
    return {
      handled: true,
      type: "response",
      response: "¡De nada! Cualquier cosa avisame. 😊"
    };
  }

  return { handled: false };
}

module.exports = { handleCommand };
