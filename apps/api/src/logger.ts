const fmt = (level: string, msg: string, meta?: unknown) => {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`;
  return meta === undefined ? line : `${line} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
};

export const logger = {
  info: (msg: string, meta?: unknown) => console.log(fmt('INFO ', msg, meta)),
  warn: (msg: string, meta?: unknown) => console.warn(fmt('WARN ', msg, meta)),
  error: (msg: string, meta?: unknown) => console.error(fmt('ERROR', msg, meta)),
  debug: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') console.log(fmt('DEBUG', msg, meta));
  },
};
