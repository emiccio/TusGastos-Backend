# AGENTS.md — Backend

## Proposito

Esta carpeta contiene el backend de GestionAndo/TusGastos. Expone la API HTTP, procesa el webhook de WhatsApp y concentra la logica de negocio sobre autenticacion, hogares, categorias y transacciones.

Stack actual:
- Node.js
- Express
- Prisma
- PostgreSQL / Supabase

## Estructura de trabajo

- `src/index.js`: entrypoint del servidor, middlewares globales y registro de rutas
- `src/routes`: definicion de endpoints y middlewares por recurso
- `src/controllers`: adaptacion HTTP, validacion de request y armado de response
- `src/services`: logica de negocio e integraciones
- `src/middleware`: auth y otras preocupaciones transversales
- `src/utils`: utilidades compartidas como logging
- `prisma`: schema, migraciones y seed

Regla general: mantener la separacion `routes -> controllers -> services`. Evitar meter logica de negocio en rutas o controladores.

## Comandos utiles

- `npm run dev`: levanta el backend con `nodemon`
- `npm start`: inicia el servidor con Node
- `npm run db:generate`: regenera el cliente de Prisma
- `npm run db:migrate`: aplica migraciones en deploy
- `npm run db:migrate:dev`: crea/aplica migraciones en desarrollo
- `npm run db:seed`: carga datos de prueba
- `npm run db:studio`: abre Prisma Studio

## Reglas para cambios

- No cambiar contratos HTTP sin revisar el impacto en frontend, especialmente sobre `auth`, `transactions`, `household` y `categories`.
- No tocar flujos de `auth`, `webhook` o `household` sin validar payloads, middlewares, codigos de respuesta y variables de entorno involucradas.
- Si cambia el schema de Prisma, el cambio debe incluir migracion y contemplar compatibilidad con queries existentes y con `prisma/seed.js`.
- Mantener consistencia entre rutas, controladores y servicios. Si aparece logica repetida, moverla a `services` o `utils`.
- Revisar con especial cuidado cualquier cambio que afecte `src/services/llm.service.js`, `whatsapp.service.js` o `transcription.service.js`, porque integran con servicios externos.

## Validacion esperada

- Levantar el backend localmente si el cambio afecta runtime o wiring general.
- Correr `npm run db:generate` si se modifican modelos de Prisma.
- Correr la migracion adecuada si cambia `prisma/schema.prisma`.
- Probar de forma directa los endpoints afectados.
- Confirmar que `/health` siga respondiendo si se toca bootstrap, middlewares o configuracion global.

## Alcance y cuidado

- Ignorar artefactos o dependencias instaladas como `node_modules`.
- No editar secretos ni asumir que `.env` local representa produccion.
- Si un cambio requiere tocar deploy o infraestructura, revisar tambien `render.yaml` y `railway.toml`.
