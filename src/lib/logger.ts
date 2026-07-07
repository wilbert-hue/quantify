// Central logger — open browser DevTools → Console to see all [Q] entries
const STYLE_LABEL = "background:#2563eb;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold";
const STYLE_OK    = "background:#16a34a;color:#fff;padding:1px 6px;border-radius:3px";
const STYLE_ERR   = "background:#dc2626;color:#fff;padding:1px 6px;border-radius:3px";
const STYLE_WARN  = "background:#d97706;color:#fff;padding:1px 6px;border-radius:3px";

export const log = {
  info(step: string, ...args: unknown[]) {
    console.log(`%c[Q]%c ${step}`, STYLE_LABEL, "", ...args);
  },
  ok(step: string, ...args: unknown[]) {
    console.log(`%c[Q ✓]%c ${step}`, STYLE_OK, "", ...args);
  },
  warn(step: string, ...args: unknown[]) {
    console.warn(`%c[Q !]%c ${step}`, STYLE_WARN, "", ...args);
  },
  error(step: string, ...args: unknown[]) {
    console.error(`%c[Q ✗]%c ${step}`, STYLE_ERR, "", ...args);
  },
};
