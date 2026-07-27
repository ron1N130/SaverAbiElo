// The scheduled refresh uses the same implementation and championship ID as
// the public endpoint. The cron URL includes `noCache=true`, so this invocation
// rebuilds the Redis snapshot instead of returning the previous one.
export { default } from "./uniliga-stats.js";
