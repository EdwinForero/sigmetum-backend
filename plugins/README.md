# Plugins locales (marketplace `locales`)

Esta carpeta es un marketplace local de Claude Code: `.claude-plugin/marketplace.json` declara, con el nombre `locales`, los plugins hermanos que viven aquí. Cada plugin es una carpeta con su `.claude-plugin/plugin.json` y sus `skills/<nombre>/SKILL.md`. Es el **único** documento que nombra las skills del proyecto y dice dónde están; el resto de la documentación enlaza aquí.

Las skills son el procedimiento paso a paso; las normas y su motivo están en las guías del proyecto (las `guias` de `.claude/flujo.json`). Se usan juntas.

## Plugins y skills

| Plugin | Perfil (tag) | Skills | Cuándo se usa |
|---|---|---|---|
| [`ciclo-agentico`](ciclo-agentico/README.md) | `base` | `principios`, `refresh-estado` (más los comandos `/ciclo` y `/ciclo-init` y los cuatro roles) | Núcleo portable del flujo agéntico; en todo proyecto que lo adopte |
| `backend-general` | `backend` | `env-var-change`, `security-pre-merge` | **Generales**: siempre en un backend (cambiar variables de entorno; antes de fusionar una PR) |
| `dominio-api-express` | `api-express` | `new-endpoint` | **Específica** del dominio API con Express: al crear o cambiar una ruta |
| `dominio-aws-s3` | `aws-s3` | `s3-operation-review` | **Específica** del dominio S3: al tocar operaciones del bucket, versionado o URL prefirmadas |

Las skills de dominio remiten entre sí cuando hace falta (por ejemplo, `new-endpoint` pide `s3-operation-review` si la ruta toca S3).

## Cómo se activan

Cada entrada del marketplace lleva un tag `perfil:<x>`. Los `perfiles` de `.claude/flujo.json` deciden qué plugins aplican al proyecto, y `marketplaceLocal` apunta a esta carpeta (`"plugins"`). Con eso, `npm run agentes:bootstrap` (o `-- --dry-run` para solo informar) lista los plugins locales que faltan, marcados con `[local]`, y, si se confirma, ejecuta una vez `claude plugin marketplace add ./plugins` y `claude plugin install <plugin>@locales` por cada uno. A mano es lo mismo:

```
claude plugin marketplace add ./plugins
claude plugin install ciclo-agentico@locales
claude plugin install backend-general@locales
```

`skillsProyecto` de `.claude/flujo.json` lista las carpetas `skills/` de los plugins del proyecto para que los roles del ciclo las consulten.

Verificado el 28/10/2026 en Windows: `claude plugin marketplace add ./plugins` (desde la raíz del repositorio) funciona, Claude Code guarda el origen como directorio con **ruta absoluta**, y los cuatro ids `…@locales` se instalan en el ámbito de usuario (versión 0.1.0). Por eso el marketplace queda registrado por equipo: cada equipo nuevo debe ejecutarlo una vez.

Si editas un plugin que ya está instalado, lee [Tras cambiar un plugin local](#tras-cambiar-un-plugin-local).

## Tras cambiar un plugin local

Claude Code ejecuta los comandos, agentes y skills de un plugin instalado desde su copia en la caché (`~/.claude/plugins/cache`), no desde esta carpeta: un cambio aquí no llega a la sesión hasta que se actualiza el plugin.

1. Si el cambio altera el comportamiento, sube `version` en el `.claude-plugin/plugin.json` del plugin y, en el núcleo, añade la entrada en `ciclo-agentico/CHANGELOG.md` (y ajusta la versión que fija `ciclo-agentico/tests/manifiestos.test.mjs`).
2. Actualiza o reinstala el plugin: `claude plugin marketplace update locales` y después `claude plugin update <plugin>@locales`, o `claude plugin uninstall <plugin>@locales` y `claude plugin install <plugin>@locales` **(por confirmar: que `update` recoja los cambios de un marketplace local sin subir la versión)**.
3. Reinicia la sesión de Claude Code para que cargue la copia nueva.

Los scripts que se ejecutan como entradas de `verificacion` de `.claude/flujo.json` (por ejemplo, `npm run docs:gate`, que llama a `plugins/ciclo-agentico/scripts/docs-gate.mjs`) usan la copia del repositorio, así que ven el cambio sin reinstalar nada.

## Añadir una categoría nueva

Por ejemplo, un plugin para un frontend:

1. Crea `plugins/dominio-frontend/` con `.claude-plugin/plugin.json` (`name`, `version`, `description`, `author`) y `skills/<nombre>/SKILL.md` (con `name` igual a la carpeta y una `description` que diga cuándo usarla). Las skills no pueden ir anidadas en subcarpetas de `skills/`: la categoría es el plugin.
2. Añade su entrada a `.claude-plugin/marketplace.json` con `source: "./dominio-frontend"` y `tags: ["perfil:frontend"]`. No añadas campos que el validador no conozca.
3. Añade `frontend` a `perfiles` y la carpeta `skills/` a `skillsProyecto` en `.claude/flujo.json`.
4. Añade la fila a la tabla de este documento.
5. Comprueba con `claude plugin validate plugins --strict`, `claude plugin validate plugins/dominio-frontend --strict` y `npm run agentes:test`.

## Sacar el núcleo a otro repositorio

`ciclo-agentico` no depende de nada de esta carpeta ni del proyecto. Para usarlo en otro repositorio, copia la carpeta `ciclo-agentico/` y crea allí su marketplace (uno propio con una entrada `source: "./ciclo-agentico"`, o súmalo al marketplace local de ese repositorio). Las pruebas de `tests/` de esta carpeta son del marketplace y de las skills del proyecto; las del núcleo viajan con él en `ciclo-agentico/tests/`.
