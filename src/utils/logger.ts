// src/utils/logger.ts
const isDebug = process.env.ENABLE_DEBUG_LOGGING === 'YES';

export const debugLog = (...args: any[]) => {
  if (isDebug) console.log('[DEBUG]', ...args);
};

export const logger = {
  info: (...args: any[]) => console.log('ℹ️', ...args),
  warn: (...args: any[]) => console.warn('⚠️', ...args),
  error: (...args: any[]) => console.error('❌', ...args),
  debug: debugLog
};