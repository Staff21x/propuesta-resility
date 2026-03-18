/**
 * conversation-store.js
 *
 * Almacén de historial de conversación en memoria.
 * Guarda solo los últimos N mensajes por número de teléfono.
 *
 * Si se configura REDIS_URL, usar una implementación Redis en su lugar.
 * Por ahora in-process es suficiente y añade 0ms de latencia.
 */

const MAX_MESSAGES_PER_CONTACT = parseInt(process.env.MAX_HISTORY_MESSAGES || '6', 10);

// Map<phoneNumber, Array<{role, content, ts}>>
const store = new Map();

export function addMessage(phone, role, content) {
  if (!store.has(phone)) store.set(phone, []);
  const history = store.get(phone);
  history.push({ role, content, ts: Date.now() });

  // Mantener solo los últimos N mensajes
  if (history.length > MAX_MESSAGES_PER_CONTACT) {
    history.splice(0, history.length - MAX_MESSAGES_PER_CONTACT);
  }
}

export function getHistory(phone) {
  return (store.get(phone) || []).map(({ role, content }) => ({ role, content }));
}

export function clearHistory(phone) {
  store.delete(phone);
}

/** Limpia conversaciones inactivas (> 2 horas) para liberar memoria */
export function pruneStale(maxAgeMs = 2 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [phone, history] of store.entries()) {
    const lastTs = history[history.length - 1]?.ts ?? 0;
    if (lastTs < cutoff) store.delete(phone);
  }
}

// Limpieza automática cada hora
setInterval(() => pruneStale(), 60 * 60 * 1000);
