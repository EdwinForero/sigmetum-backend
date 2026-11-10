# Enrutado de modelos por rol en ciclo-agentico: spec

Fecha: 2026-11-10 · Estado: cerrado

## Objetivo

Hoy los cuatro roles del núcleo `ciclo-agentico` heredan el modelo y el nivel de esfuerzo de la sesión, así que el coste y la calidad dependen de con qué sesión se lance `/ciclo`. Se quiere que cada rol use un modelo y un esfuerzo fijados por el propio plugin, y que las segundas opiniones y el fallo repetido del `developer` tengan una regla explícita. Es un cambio de configuración del flujo, no de la API. La idea y la tabla se inspiran en https://github.com/donimas/ai-routing (MIT); no se copian sus plantillas, su hook ni su `settings.json`.

Tabla decidida por el usuario:

| Rol | Modelo | Esfuerzo |
|---|---|---|
| requirements | sonnet | medium |
| architect | opus | high |
| developer | sonnet | medium |
| tester-documentador | sonnet | medium |
| Segunda opinión (plan o diff crítico) y revisión por escalado | opus | high, fijado en la propia llamada a `Agent`, no en un archivo |

Hechos verificados con la documentación de Claude Code 2.1.322 (a los que se atiene la spec):

- El frontmatter de un agente de plugin admite `model` (`sonnet`, `opus`, `haiku`, `fable`, ID completo o `inherit`) y `effort` (`low`, `medium`, `high`, `xhigh`, `max`; los niveles disponibles dependen del modelo).
- Precedencia de `model`: parámetro de la llamada a `Agent` > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > modelo de la sesión.
- Precedencia de `effort`: `CLAUDE_CODE_EFFORT_LEVEL` > parámetro de la llamada > frontmatter > nivel de la sesión.
- Un campo desconocido o mal escrito se ignora en silencio. Se detecta con `claude --debug` (buscando "does not recognize or apply") o con `claude plugin validate <ruta> --strict`, que también valida `agents/`. No está confirmado que `validate` avise de un campo desconocido dentro de un agente **(por confirmar)**.
- Un plugin cargado desde su carpeta toma los cambios con `/reload-plugins` o en la siguiente sesión.
- `permissionMode`, `hooks`, `mcpServers` e `initialPrompt` se ignoran en agentes de plugin.

## Criterios de aceptación

### De código

1. Los cuatro `plugins/ciclo-agentico/agents/*.md` declaran `model` y `effort` con los valores exactos de la tabla, con esos nombres de campo, sin quitar `name`, `description`, `tools` ni `skills`.
2. `plugins/ciclo-agentico/commands/ciclo.md` indica que la segunda opinión se pide con `model` opus y `effort` high en la propia llamada, y que las llamadas a los cuatro roles no pasan `model` para que mande el frontmatter.
3. Regla de escalado en `ciclo.md`:
   - El orquestador considera que el `developer` "falla lo mismo" cuando, en dos vueltas consecutivas, se cumple una de estas dos condiciones: (a) el texto de la devolución del tester es el mismo, o (b) el mismo comando de verificación falla con la misma línea clave. Ambas son comprobables comparando el texto o el comando y la línea clave que ya se muestran al escalar.
   - Al detectarlo, no relanza al `developer` sin más: pide una revisión con `model` opus y `effort` high en la llamada, pasándole el diff (`git diff HEAD` más archivos sin seguimiento) y el fallo.
   - Esa revisión cuenta como una vuelta y respeta `maxVueltas`. Sus conclusiones van como devolución al `developer` en la vuelta siguiente.
   - La revisión solo informa: no corrige nada ni hace commit.
   - Si el `developer` vuelve a fallar tras la revisión, el orquestador escala al usuario con el diff y el fallo.
4. Paso 0 de `ciclo.md`: avisa, sin bloquear, si `CLAUDE_CODE_SUBAGENT_MODEL` o `CLAUDE_CODE_EFFORT_LEVEL` están definidas, con el texto "la tabla de modelos está anulada por <nombre de la variable>". Solo se comprueba que la variable existe: nunca se imprime su valor.
5. Tests nuevos en `plugins/ciclo-agentico/tests/` (estilo de `estructura.test.mjs` y `portabilidad.test.mjs`) comprueban:
   - Por rol, los valores exactos de la tabla: requirements sonnet/medium, architect opus/high, developer sonnet/medium, tester-documentador sonnet/medium. Cambiar un valor obliga a cambiar el test a propósito.
   - Listas de validez: `model` en `sonnet`, `opus`, `haiku`, `fable`; `effort` en `low`, `medium`, `high`, `xhigh`, `max`.
   - Nombres de campo exactos, sin typos (por ejemplo `efort`, `modle` hacen fallar la prueba) y sin campos ignorados en plugins (`permissionMode`, `hooks`, `mcpServers`, `initialPrompt`).
   - Que `ciclo.md` recoge la segunda opinión con opus y high, la regla de escalado (criterio de "falla lo mismo", cuenta como vuelta, solo informa) y el aviso de variables del paso 0.
6. Versión 0.1.1 solo en `plugins/ciclo-agentico/.claude-plugin/plugin.json` (el catálogo `plugins/.claude-plugin/marketplace.json` no declara versión: verificado); entrada 0.1.1 en `CHANGELOG.md`; `manifiestos.test.mjs` fija 0.1.1 (versión y resumen del CHANGELOG).
7. Pasan `npm run agentes:test`, `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run docs:gate`.
8. No se toca código de la API (`routes/`, `middleware/`, `functions/`, `aws/`, `config/`) ni se añade un hook ni un `settings.json` de ai-routing.

### De documentación

1. `plugins/ciclo-agentico/README.md` explica: la tabla de modelos por rol, la precedencia de `model` y `effort`, que `CLAUDE_CODE_SUBAGENT_MODEL` y `CLAUDE_CODE_EFFORT_LEVEL` anulan la tabla (y que el paso 0 lo avisa), y la regla de escalado.
2. Ese README documenta qué medir, sin cambiar el flujo: vueltas por ciclo, devoluciones del tester y hallazgos de la segunda opinión, y cómo leerlos de la puerta final. Deja claro que aún no hay medición real.
3. `plugins/README.md`, `plugins/ciclo-agentico/README.md` y `docs/README.md` dejan como comprobación manual del usuario (no la ejecuta ningún rol ni `npm test`): `claude plugin validate plugins/ciclo-agentico --strict` y `claude --debug` buscando "does not recognize or apply"; y que tras el cambio hace falta `/reload-plugins` o una sesión nueva.
4. Constan como riesgo y paso posterior que las cachés `@locales-front` y `@locales-infra` quedan en 0.1.0 hasta copiar el núcleo (fuera de alcance), y la atribución a ai-routing (MIT) como inspiración.
5. `plugins/README.md` corrige la mención "versión 0.1.0" si deja de ser cierta, o la deja fechada como verificación histórica.
6. `docs/07-estado-y-deuda-tecnica.md`: solo la fecha "actualizado" de hoy (cierre documental obligatorio); no se añaden riesgos ni mediciones.

## Riesgos que recoge la spec

1. Coste y calidad: no hay medición real. Qué medir: vueltas por ciclo, devoluciones del tester y hallazgos de la segunda opinión (solo documentado en el README del plugin).
2. Un `effort` no válido para el modelo se ajusta o se ignora según la versión; medium y high deben ser válidos para sonnet y opus **(por confirmar con `claude --debug`)**.
3. El núcleo está copiado en tres repositorios y hay tres cachés (`ciclo-agentico@locales`, `@locales-front`, `@locales-infra`), cada una leída de su carpeta (ver `claude plugin list --json`). Este cambio solo afecta a la copia del backend: las otras dos quedan en 0.1.0 y los núcleos divergen hasta copiarlo (paso posterior, fuera de alcance).
4. `CLAUDE_CODE_SUBAGENT_MODEL` y `CLAUDE_CODE_EFFORT_LEVEL` en el equipo del usuario anulan la tabla; `CLAUDE_CODE_EFFORT_LEVEL` gana incluso al parámetro de la llamada. El paso 0 avisa, sin bloquear.
5. Un campo mal escrito se ignora en silencio: lo cubren los tests nuevos y la verificación manual.
6. El criterio "falla lo mismo" por coincidencia de texto puede no detectar un mismo fallo redactado distinto; el tope `maxVueltas` sigue siendo la red de seguridad.

## Fuera de alcance

- Copiar el núcleo a `sigmetum-frontend` y `sigmetum-infra` (se hará después).
- El hook de ai-routing, sus plantillas y su `settings.json`.
- Fijar el modelo en `.claude/settings.json` o en variables de entorno.
- Medir de forma automática coste o calidad, o cambiar el flujo o `docs/07` para registrar mediciones.
- Cambiar los plugins `backend-general`, `dominio-api-express` y `dominio-aws-s3`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta (no cambia rutas, respuestas, JWT ni CORS).
- `docs/integracion/para-infra.md`: no lo afecta (no cambian variables de entorno de la API ni permisos). Las variables de Claude Code no son de la API.
- Efecto indirecto: el núcleo copiado en frontend e infra queda en 0.1.0 hasta que se copie.

## Preguntas abiertas

Ninguna. Las cinco del primer borrador están resueltas por el usuario e incorporadas arriba.
