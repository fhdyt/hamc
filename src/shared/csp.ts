export function buildCsp(dev: boolean): string {
  const script = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
  const connect = dev
    ? "'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
    : "'self'"
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
