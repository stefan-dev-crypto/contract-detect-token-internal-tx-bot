function formatTimestamp() {
  return new Date().toISOString();
}

export function createLogger(workerId = 'main') {
  const prefix = `[${formatTimestamp()}] [${workerId}]`;

  return {
    info(message, ...args) {
      console.log(`${prefix} INFO`, message, ...args);
    },
    warn(message, ...args) {
      console.warn(`${prefix} WARN`, message, ...args);
    },
    error(message, ...args) {
      console.error(`${prefix} ERROR`, message, ...args);
    },
  };
}
