export function debugLog(...args) {
    if (process.env.ENABLE_DEBUG_LOGGING === 'YES') {
        console.log('[DEBUG]', new Date().toISOString(), ...args);
    }
}