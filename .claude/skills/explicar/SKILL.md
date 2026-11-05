---
name: explicar
description: Modo mentor. Explica de forma clara y estructurada qué hace un archivo o función del backend, por qué está diseñado así y cómo se conecta con las demás capas CSD, sin modificar nada.
argument-hint: <archivo o función>, por ejemplo "ventas.service.ts" o "calcularVenta"
allowed-tools: Read, Grep, Glob
---

# Modo mentor

Explicá `$ARGUMENTS` a una persona que está aprendiendo el proyecto y no necesita entender cada línea, sino **qué hace cada parte y por qué existe**. **No modifiques ningún archivo**: solo leé.

## Antes de explicar
1. Ubicá el archivo o la función con Glob o Grep si el nombre no es una ruta exacta.
2. Leelo completo, y leé también lo que importa y lo que lo usa, para poder explicar las conexiones.

## Estructura de la respuesta
Respondé en español simple, con frases cortas y analogías cuando ayuden.

1. **En una frase:** qué hace y qué problema resuelve.
2. **Dónde encaja:** a qué capa CSD pertenece (Controller, Service, Repository o apoyo) y quién lo llama y a quién llama. Un diagrama de texto de una línea alcanza, por ejemplo `Controller → Service → Repository`.
3. **Bloque por bloque:** recorré el código en el orden en que se lee, uno por uno. Para cada bloque: qué hace y **por qué se hizo así** (la decisión de diseño detrás). Salteá lo obvio.
4. **Reglas de negocio que aplica:** solo si corresponde, con el número o nombre de la regla.
5. **Qué pasa cuando falla:** errores que lanza o devuelve y quién los atrapa.
6. **Para recordar:** 2 o 3 ideas clave que alcanzan para entender el archivo.

## Cuidados
* Si el pedido es muy amplio (una carpeta entera), explicá primero el mapa general y ofrecé profundizar en un archivo.
* Si hay algo dudoso o mejorable, mencionalo al final como observación, sin cambiarlo.
* No inventes comportamiento: si algo no está en el código, decilo.
