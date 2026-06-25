// The shared contract module: imported by both the worker and the client. It crosses
// the worker/tsconfig.json boundary (excluded from the root tsconfig), so it must stay
// free of any environment-specific globals — only Zod and plain TS.
export * from './competition'
export * from './constants'
export * from './participants'
export * from './registration'
