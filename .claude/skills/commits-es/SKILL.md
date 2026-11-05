---
name: commits-es
description: Revisa git status y git diff y propone una lista ordenada de commits atómicos en Conventional Commits en español. Espera el OK del usuario antes de ejecutar nada.
disable-model-invocation: true
---

# Commits atómicos en español

Tu tarea es **proponer** los commits del trabajo pendiente y esperar la aprobación. No ejecutes `git add` ni `git commit` hasta recibir el OK.

## Pasos
1. Corré `git status`, `git diff --stat` y `git diff` (incluí `--staged` si hay cambios en el área de preparación). Mirá también `git log --oneline -5` para respetar el estilo de los ámbitos usados.
2. Agrupá los cambios por **una sola intención lógica** cada grupo. Si un archivo mezcla intenciones distintas, avisalo en lugar de forzar un commit grande.
3. Ordená los commits para que cada uno deje el proyecto compilable (dependencias de abajo hacia arriba: configuración, esquema, tipos, lógica, rutas).
4. Excluí siempre `.env`, `.env.*`, credenciales y `src/generated/`. Si aparecen en el estado, avisalo.

## Formato obligatorio
`tipo(ámbito): descripción breve en minúsculas`
* Tipos permitidos: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`.
* Ámbitos habituales: `backend`, `prisma`, `ventas` (usá el módulo o capa afectada).
* Descripción en español, imperativa, sin punto final y sin mayúscula inicial.
* Cada mensaje termina con la línea `Co-Authored-By` que indique la configuración de atribución de la sesión.

## Qué presentar
Una lista numerada y, debajo, los comandos exactos listos para ejecutar:

```bash
git add <archivos>
git commit -m "tipo(ámbito): descripción"
```

Agregá una nota breve con cualquier decisión que el usuario deba revisar (por ejemplo, un archivo dudoso o un tipo alternativo).

Terminá preguntando si se aprueban. Solo con el OK ejecutá los comandos, en el orden propuesto, y mostrá `git status` y `git log --oneline` al final. Nunca hagas `git push` salvo pedido explícito.
