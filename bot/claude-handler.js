/**
 * claude-handler.js
 *
 * Manejador de Claude optimizado para respuesta rápida.
 *
 * Problemas del diseño anterior (1-2 min):
 *   - Loop de agente con 5-10 tool calls secuenciales (3-5s cada uno)
 *   - Contexto completo de conversación en cada mensaje
 *   - Modelo Opus para tareas simples
 *   - Webhook bloqueante (síncrono)
 *
 * Solución:
 *   - Modelo Haiku (6-10x más rápido que Opus)
 *   - Prompt único sin tool calls para respuestas conversacionales
 *   - Contexto reducido: solo últimos N mensajes
 *   - Tool calls SOLO cuando realmente son necesarios, y en paralelo
 *   - Respuesta streamed → enviar en cuanto llega el primer chunk
 */

import Anthropic from '@anthropic-ai/sdk';
import NodeCache from 'node-cache';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache del system prompt — se construye una vez, no en cada request
let _systemPromptCache = null;

// Cache de respuestas frecuentes (TTL 10 min)
const responseCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY_MESSAGES || '6', 10);

/**
 * Retorna el system prompt de Resility.
 * Se construye una sola vez y se reutiliza.
 */
function getSystemPrompt() {
  if (_systemPromptCache) return _systemPromptCache;

  _systemPromptCache = `Eres el asistente comercial de Resility, empresa chilena de ciberseguridad.

PERSONALIDAD: Profesional, directo, empático. Responde como lo haría un ejecutivo comercial experto — sin rodeos, sin frases de relleno.

SERVICIOS PRINCIPALES:
- Consultoría y auditoría de ciberseguridad
- Cumplimiento normativo (ISO 27001, NIST, Ley 21.663)
- Detección y respuesta a incidentes (MDR)
- Capacitaciones y concientización
- Automatización de procesos (OTEC, empresas)

REGLAS:
1. Responde SIEMPRE en el mismo idioma del usuario.
2. Máximo 3 párrafos cortos. Sin listas largas. Sin markdown.
3. Si el usuario pregunta por precios, di que depende del proyecto y propón una llamada de 15 min.
4. Si el usuario quiere hablar con una persona, escala inmediatamente: "Te conecto ahora con nuestro equipo."
5. Si la consulta supera tu contexto (temas legales, técnicos muy específicos), escala a humano.
6. NO inventes precios, plazos ni características que no conozcas.

ESCALAMIENTO: Responde SOLO con "ESCALAR" (sin más texto) si:
- El usuario pide hablar con una persona
- Hay una urgencia o incidente activo
- La consulta es demasiado técnica/legal para el bot`;

  return _systemPromptCache;
}

/**
 * Genera una clave de caché para respuestas frecuentes.
 * Solo para mensajes cortos y genéricos (saludos, preguntas frecuentes).
 */
function getCacheKey(text) {
  const normalized = text.trim().toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').substring(0, 80);
  return `resp:${normalized}`;
}

/**
 * Procesa un mensaje entrante y devuelve la respuesta.
 *
 * @param {string} userMessage - Texto del usuario
 * @param {Array}  history     - Historial [{role, content}] — máximo MAX_HISTORY elementos
 * @returns {{ text: string, shouldEscalate: boolean }}
 */
export async function processMessage(userMessage, history = []) {
  // 1. Revisar caché para mensajes frecuentes simples (< 40 chars)
  if (userMessage.trim().length < 40) {
    const cacheKey = getCacheKey(userMessage);
    const cached = responseCache.get(cacheKey);
    if (cached) return cached;
  }

  // 2. Recortar historial para reducir tokens (~30ms de ahorro por mensaje extra)
  const trimmedHistory = history.slice(-MAX_HISTORY);

  // 3. Llamada directa al modelo — SIN tool calls para respuestas conversacionales
  //    Esto elimina el loop de agente que causaba los 1-2 minutos.
  const messages = [
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,       // Respuestas cortas = más rápido
    system: getSystemPrompt(),
    messages,
  });

  const text = response.content[0]?.text?.trim() || '';
  const shouldEscalate = text === 'ESCALAR';

  const result = { text: shouldEscalate ? '' : text, shouldEscalate };

  // 4. Cachear si es mensaje corto
  if (userMessage.trim().length < 40) {
    responseCache.set(getCacheKey(userMessage), result);
  }

  return result;
}

/**
 * Versión con streaming — envía cada chunk al callback tan pronto llega.
 * Reduce la latencia percibida: el usuario ve texto llegando en ~500ms.
 *
 * @param {string}   userMessage
 * @param {Array}    history
 * @param {Function} onChunk     - Callback(chunk: string) por cada fragmento
 * @returns {{ fullText: string, shouldEscalate: boolean }}
 */
export async function processMessageStreaming(userMessage, history = [], onChunk) {
  const trimmedHistory = history.slice(-MAX_HISTORY);
  const messages = [
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ];

  let fullText = '';

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 400,
    system: getSystemPrompt(),
    messages,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      const piece = chunk.delta.text;
      fullText += piece;
      if (onChunk) onChunk(piece);
    }
  }

  const shouldEscalate = fullText.trim() === 'ESCALAR';
  return { fullText: shouldEscalate ? '' : fullText, shouldEscalate };
}
