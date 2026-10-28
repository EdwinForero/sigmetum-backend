---
name: security-pre-merge
description: Lista de comprobación de seguridad antes de fusionar en la rama principal. Úsala antes de abrir o fusionar una PR que toque autenticación, rutas, middleware o dependencias.
---

# Seguridad antes de fusionar

Esta lista es el procedimiento; las normas, su motivo y el estado de cada una están en la guía de seguridad de las `guias` de `.claude/flujo.json`.

1. **Secretos**: revisa `git diff` en busca de credenciales, tokens o claves escritas a mano; todo lo sensible sale de variables de entorno registradas en el módulo de validación.
2. **Higiene de `.env`**: `.env` no está preparado para commit; `.env.example` refleja las variables nuevas, sin valores reales.
3. **Autenticación**: toda ruta protegida nueva usa el middleware de token del proyecto; el control de acceso nunca depende del cliente.
4. **CORS**: se respeta el origen permitido configurado y ninguna respuesta añade cabeceras CORS permisivas por su cuenta.
5. **Límite de peticiones**: las rutas sensibles (autenticación, subida, borrado) están cubiertas por el limitador de peticiones.
6. **Dependencias**: ejecuta `npm audit` y revisa cada dependencia nueva (mantenimiento y necesidad); nunca `npm audit fix --force`.
7. **Respuestas de error**: el manejador de errores no expone trazas ni mensajes internos en producción; nada lo esquiva.
8. **Saneado de entrada**: el texto del usuario que acaba en claves de almacenamiento o nombres de archivo se valida contra una lista de permitidos, para evitar recorridos de ruta o inyección de claves.
9. **Contraseñas y tokens**: hash de contraseñas con una librería probada (p. ej. bcrypt) y tokens firmados con la librería estándar; sin criptografía propia ni comparaciones en texto plano.
10. **Documentación y verificación**: aplica `docsRegla` de `.claude/flujo.json` (su apartado de antes de fusionar), ejecuta las entradas de `verificacion` y anota en la PR todo lo que cambie el contrato con el frontend (las guías de `integracion` de `.claude/flujo.json`).
