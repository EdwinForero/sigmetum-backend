---
name: env-var-change
description: Lista de comprobación para añadir, renombrar o quitar variables de entorno. Úsala siempre que cambie el módulo de validación de variables de entorno, el archivo .env o el .env.example.
---

# Cambio de variables de entorno

1. **Regístrala**: añade el nombre al módulo de validación de variables de entorno que nombra la guía del proyecto (las `guias` de `.claude/flujo.json`), en la lista de obligatorias o en la de solo-local si únicamente hace falta en desarrollo.
2. **Falla pronto**: comprueba que la validación sigue ejecutándose al principio del arranque, para que una variable ausente detenga el servidor al iniciar y no a mitad de una petición.
3. **Valida el valor, no solo que exista**: formato, rango o lista de permitidos, según diga la guía de configuración del proyecto.
4. **Documéntala**: añádela a `.env.example` con un valor de ejemplo, nunca con uno real.
5. **Sin restos**: si la renombras o la quitas, busca todos los usos del nombre antiguo (`process.env.NOMBRE_ANTIGUO` o equivalente) y actualízalos.
6. **Alcance correcto**: no la marques como obligatoria si de verdad es opcional; usa un valor por defecto en el código y registra la variable opcional, con su motivo, donde indique la guía del proyecto.
7. **Secretos**: ningún valor real en el repositorio, en `.env.example`, en la documentación ni en los logs (guía de seguridad del proyecto).
8. **Infraestructura**: avisa a la infraestructura si la variable debe existir en los entornos desplegados; la validación solo comprueba el entorno del proceso en ejecución.
9. **Documentación y verificación**: aplica `docsRegla` de `.claude/flujo.json` (la tabla de variables de la documentación de configuración) y ejecuta las entradas de `verificacion`.
