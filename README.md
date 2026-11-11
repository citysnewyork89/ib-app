# Iberia Publisher – despliegue en Render (24/7)

## 1. Sube el código a GitHub (repositorio PRIVADO)
El `.env` NO se sube (ya está en .gitignore). Nunca pegues el token en el código.

## 2. En Render
1. New + → **Blueprint** → elige tu repo (lee `render.yaml`).
2. Rellena las 3 variables cuando te las pida:
   - `DISCORD_TOKEN`, `GUILD_ID`, `ADMIN_PASSWORD` (larga, 20+ caracteres).
3. Deploy. Tu web quedará en `https://iberia-publisher.onrender.com` (HTTPS automático).

## Por qué plan Starter (7 $/mes)
- El plan **Free se duerme a los 15 min** sin visitas y el bot se desconecta → NO es 24/7.
- Los menús desplegables se guardan en `data/menus.json`; en Free ese disco se borra en cada reinicio.
  Starter + disco persistente (`/var/data`) lo soluciona.

## Si quieres Free igualmente
Quita `plan: starter` y el bloque `disk`/`DATA_DIR`, y usa UptimeRobot para hacer ping a `/health` cada 5 min.
Aviso: los menús guardados se perderán en cada reinicio/redeploy.

## Seguridad incluida
- Comparación de contraseña segura + bloqueo tras 10 fallos (15 min) por IP
- Validación de IDs, cabeceras de seguridad, errores controlados sin tumbar el servidor
- Token y contraseña solo en variables de entorno

⚠ Si el token de Discord se ha compartido alguna vez, regéneralo en el Developer Portal.
