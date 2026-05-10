const categoriesService = require('./categories.service');
const transactionService = require('./transaction.service');

function normalize(text) {
  return text
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function looksLikeUncertainQuery(msg) {
  const uncertainty = [
    "no se",
    "no recuerdo",
    "ni idea",
    "no tengo claro",
  ];

  const financialQuestion = [
    "cuanto gaste",
    "cuanto cobre",
    "saldo",
    "balance",
    "mis gastos",
    "mis ingresos",
  ];

  return uncertainty.some(term => msg.includes(term)) &&
    financialQuestion.some(term => msg.includes(term));
}

function asksUnsupportedPeriod(msg) {
  const asksExpenses = msg.includes("cuanto gaste") || msg.includes("mis gastos") || msg.includes("resumen de gastos");
  const asksIncome = msg.includes("cuanto cobre") || msg.includes("mis ingresos") || msg.includes("resumen de ingresos");
  const unsupportedPeriod = ["hoy", "ayer", "semana", "semanal"].some(term => msg.includes(term));

  return (asksExpenses || asksIncome) && unsupportedPeriod;
}

async function handleCommand(message, user) {
  const msg = normalize(message);

  // ── DASHBOARD ─────────────────────────
  if (msg.includes("dashboard") || msg.includes("panel") || msg.includes("gestionando") || msg.includes("perfil")) {
    return {
      handled: true,
      type: "response",
      response: "Podés ver tu panel acá:\nhttps://gestionando-gastos.vercel.app/dashboard"
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
        `👋 Soy Lulú. Te ayudo a registrar y entender los gastos de tu casa desde WhatsApp.

💸 Para registrar gastos:
• "super 20k"
• "farmacia 8500 ayer"
• "nafta 12000 con crédito"

💰 Para registrar ingresos:
• "cobré 500k"
• "me transfirieron 100000"

🎙️ También podés mandarme un audio cortito con uno o varios movimientos.

📊 Para consultar:
• "¿cuánto gasté este mes?"
• "¿cuánto gasté en supermercado?"
• "saldo"

⚙️ Comandos:
• *panel*: abrir el dashboard
• *categorias*: ver categorías
• *hogares*: ver o cambiar hogar
• *ayuda*: ver este mensaje`
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
• "uber 3500"
• "supermercado 15000"
• "cobré 500k"`
    };
  }

  // ── QUERIES RÁPIDAS ───────────────────
  if (looksLikeUncertainQuery(msg)) {
    return {
      handled: true,
      type: "response",
      response:
        `🤔 Te puedo ayudar a revisarlo, pero no quiero asumir mal.

Probá preguntarme algo concreto como:
• "¿cuánto gasté este mes?"
• "¿cuánto gasté en supermercado?"
• "saldo"`
    };
  }

  if (asksUnsupportedPeriod(msg)) {
    return {
      handled: true,
      type: "response",
      response:
        `📊 Todavía no tengo bien afinadas las consultas por día o semana desde WhatsApp.

Por ahora preguntame:
• "¿cuánto gasté este mes?"
• "¿cuánto gasté en supermercado?"
• "saldo"`
    };
  }

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

  // ── HOGARES ───────────────────────────
  if (msg === "hogares" || msg === "casas") {
    const { listUserHouseholds } = require('./household.service');
    const households = await listUserHouseholds(user.id);
    const activeId = await transactionService.getActiveHousehold(user.id);

    if (households.length <= 1) {
      return {
        handled: true,
        type: "response",
        response: `Actualmente estás en el hogar: *${households[0]?.name || 'Hogar'}*.
Para tener múltiples hogares pasate a Premium en la web.`
      };
    }

    const list = households.map((h, i) =>
      `${i + 1}. ${h.name} ${h.id === activeId ? '*(activo)*' : ''}`
    ).join("\n");

    return {
      handled: true,
      type: "response",
      response: `🏘️ Tus hogares:
${list}

Para cambiar, escribí:
*cambiar hogar [número]*`
    };
  }

  if (msg.startsWith("cambiar hogar") || msg.startsWith("usar hogar")) {
    const parts = msg.split(" ");
    const target = parts[parts.length - 1]; // Tomar el último fragmento (número o nombre parcial)

    const { listUserHouseholds, switchActiveHousehold } = require('./household.service');
    const households = await listUserHouseholds(user.id);

    let selected = null;
    const index = parseInt(target) - 1;

    if (!isNaN(index) && households[index]) {
      selected = households[index];
    } else {
      selected = households.find(h => normalize(h.name).includes(normalize(target)));
    }

    if (!selected) {
      return {
        handled: true,
        type: "response",
        response: `No encontré ese hogar. Escribí *hogares* para ver la lista.`
      };
    }

    await switchActiveHousehold(user.id, selected.id);

    return {
      handled: true,
      type: "response",
      response: `✅ Ahora estás usando: *${selected.name}*`
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
