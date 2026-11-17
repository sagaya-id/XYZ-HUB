// Type shim so the Worker can import SheetJS' ESM build explicitly; the
// package's CommonJS entry cannot be resolved by esbuild on platform "neutral".
declare module 'xlsx/xlsx.mjs' {
  export * from 'xlsx'
}
