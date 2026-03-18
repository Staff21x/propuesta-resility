# Diagnóstico y optimización — Tiempo de respuesta del bot

## Problema

El bot tardaba **1-2 minutos** por interacción, haciendo inviable una experiencia conversacional real.

---

## Causas raíz identificadas (desde los logs)

### 1. Loop de agente con múltiples tool calls secuenciales ← **mayor impacto**

El diseño de agente con herramientas genera un loop:

```
Usuario envía mensaje
  → LLM decide qué tool usar          (~2-3s)
  → Tool 1 ejecuta (CRM lookup)       (~500ms)
  → LLM procesa resultado             (~2-3s)
  → Tool 2 ejecuta (intent classify)  (~500ms)
  → LLM procesa resultado             (~2-3s)
  → Tool 3 ejecuta (response format)  (~500ms)
  → LLM genera respuesta final        (~2-3s)
  Total: ~15-20s por ciclo, x4-5 ciclos = 60-100s
```

**Solución:** Eliminar el loop de agente para conversaciones normales. Un único call directo al LLM con un system prompt bien diseñado reemplaza 4-5 tool calls.

### 2. Modelo incorrecto para la tarea

| Modelo         | Latencia típica | Uso correcto                     |
|----------------|-----------------|----------------------------------|
| claude-opus-4  | 8-15s           | Análisis complejo, código largo  |
| claude-sonnet  | 3-6s            | Razonamiento moderado            |
| claude-haiku   | 0.8-2s          | Chat, respuestas cortas ✓        |

Para conversación de WhatsApp, **Haiku es la elección correcta**.

### 3. Contexto excesivo en cada llamada

Enviar las últimas 20-50 mensajes de historial añade tokens innecesarios.
Con **6 mensajes de contexto** el modelo mantiene conversación coherente y procesa 3-4x más rápido.

### 4. Webhook síncrono (bloquea hasta obtener respuesta)

```
WhatsApp → Webhook → espera respuesta de Claude → responde 200
```

Si Claude tarda 30s, el webhook no responde en 30s. WhatsApp puede reintentar, generando respuestas duplicadas.

**Solución:** Retornar `202 Accepted` inmediatamente y procesar en background.

### 5. Sin anti-duplicado

Sin un mecanismo que detecte "ya estoy procesando este contacto", los reenvíos de WhatsApp generan múltiples respuestas simultáneas, saturando la API y aumentando latencia.

---

## Solución implementada

```
bot/
├── index.js              # Baileys + orquestación. Retorna 202 inmediato.
├── claude-handler.js     # Llamada directa a Haiku. Sin tool calls para chat.
├── conversation-store.js # Historial en memoria (últimos 6 mensajes)
├── .env.example          # Variables de entorno documentadas
└── package.json
```

### Benchmark esperado

| Métrica              | Antes   | Después   |
|----------------------|---------|-----------|
| Tiempo de respuesta  | 60-120s | 2-5s      |
| Tool calls por msg   | 4-8     | 0 (chat directo) |
| Tokens por request   | ~4,000  | ~800      |
| Costo por conversación | alto  | ~10x menor |

---

## Variables de entorno clave

```bash
CLAUDE_MODEL=claude-haiku-4-5-20251001   # Más rápido
MAX_HISTORY_MESSAGES=6                    # No enviar más de esto al modelo
```

## Cuándo SÍ usar tool calls / agente

Reservar el modo agente para flujos que genuinamente lo necesitan:
- Consultar disponibilidad de agenda (API externa)
- Registrar lead en CRM después de calificar interés
- Buscar información técnica en base de conocimiento

En esos casos, ejecutar las tools **en paralelo** cuando no hay dependencias entre ellas.
