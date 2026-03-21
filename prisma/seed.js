require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Crear usuario de prueba
  const user = await prisma.user.upsert({
    where: { phone: '5492236146209' },
    update: {},
    create: {
      phone: '5492236146209',
      name: 'Elias',
    },
  });

  console.log(`✅ User: ${user.phone}`);

  // Crear transacciones de prueba
  const now = new Date();
  const transactions = [
    { type: 'income', amount: 500000, category: 'Sueldo', description: 'Sueldo marzo', date: new Date(now.getFullYear(), now.getMonth(), 1) },
    { type: 'income', amount: 100000, category: 'Freelance', description: 'Proyecto web', date: new Date(now.getFullYear(), now.getMonth(), 5) },
    { type: 'expense', amount: 20000, category: 'Supermercado', description: 'Supermercado Día', date: new Date(now.getFullYear(), now.getMonth(), 8) },
    { type: 'expense', amount: 15000, category: 'Nafta', description: 'YPF', date: new Date(now.getFullYear(), now.getMonth(), 10) },
    { type: 'expense', amount: 18200, category: 'Restaurantes', description: 'Almuerzo trabajo', date: new Date(now.getFullYear(), now.getMonth(), 12) },
    { type: 'expense', amount: 9800, category: 'Servicios', description: 'Luz', date: new Date(now.getFullYear(), now.getMonth(), 14) },
    { type: 'expense', amount: 12500, category: 'Salud', description: 'Farmacia', date: new Date(now.getFullYear(), now.getMonth(), 15) },
    { type: 'expense', amount: 35000, category: 'Supermercado', description: 'Compra semanal', date: new Date(now.getFullYear(), now.getMonth(), 17) },
    { type: 'expense', amount: 8000, category: 'Transporte', description: 'SUBE', date: new Date(now.getFullYear(), now.getMonth(), 18) },
    { type: 'expense', amount: 25000, category: 'Entretenimiento', description: 'Cine + cena', date: new Date(now.getFullYear(), now.getMonth(), 19) },
  ];

  for (const t of transactions) {
    await prisma.transaction.create({
      data: { ...t, userId: user.id },
    });
  }

  console.log(`✅ ${transactions.length} transactions created`);
  console.log('\n🎉 Seed completed!');
  console.log(`\nPara usar el dashboard, logueate con el número: 5491100000000`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
