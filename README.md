# Iberia Publisher

Panel web + bot de Discord para publicar mensajes, guardar plantillas y editar mensajes ya enviados.

## Variables de entorno
`DISCORD_TOKEN`, `GUILD_ID`, `ADMIN_PASSWORD` (20+ caracteres) y `MONGODB_URI` (MongoDB Atlas, gratis).

## Base de datos
Guarda: opciones de los desplegables, plantillas y mensajes enviados (para poder editarlos).
Sin `MONGODB_URI` usa un archivo local que Render Free borra en cada reinicio/deploy.

## Render + UptimeRobot
1. Repo privado en GitHub → Render → New + → Blueprint.
2. Rellena las 4 variables.
3. UptimeRobot: monitor HTTP(s) a `https://TU-APP.onrender.com/health` cada 5 min.

## Editar mensajes
Solo se pueden editar los enviados desde este panel (después de añadir la base de datos).
Un mensaje V2 solo se puede editar como V2, y uno clásico como clásico. Las imágenes subidas desde
el PC no se guardan en plantillas (usa URL), pero sí se conservan al editar un mensaje enviado.
