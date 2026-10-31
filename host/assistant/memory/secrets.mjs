// What looks like a secret, and how it is blanked out. Used where text could be stored (remember, update, the notes tidy writes)
// and where it is shown or sent on (forget previews, the turns tidy sends to the model). The match itself is never returned or
// logged: callers get the kind, or the text with the match replaced by [redacted].
//
// The patterns (a text is refused if ANY matches):
//   token            sk-… keys (OpenAI, Anthropic, DeepSeek style), GitHub ghp_/gho_/ghu_/ghs_/ghr_/github_pat_, Slack xox?-…,
//                    AWS access key ids (AKIA…), Google API keys (AIza…), JSON Web Tokens (eyJ….….…), "Bearer <long value>"
//   private_key      a -----BEGIN … PRIVATE KEY----- block
//   password         a secret word followed by a value: password, passwd, passcode, passphrase, pwd, secret, secret key, token,
//                    api key, access key, private key, credential(s), 密码, 口令, 密钥, 秘钥, 令牌, 验证码, then "is"/"was"/"are",
//                    "=", ":", 是 or 为, then 4 or more printable ASCII characters ("the password is hunter2", "DB_PASSWORD=x9y8z7",
//                    "密码是 hunter2"). A value in Chinese ("密码是我的生日") is not caught: it is not a string a program can use.
//   card             13-19 digits (spaces and dashes allowed) starting with 2-6 that pass the Luhn check
//   credentials_url  scheme://user:password@host
//   random_string    32 or more letters and digits with at least one lowercase, one uppercase and one digit (API keys); pure hex
//                    (hashes, commit ids) is deliberately not caught
// The rules lean towards refusing: the cost of a false refusal is one rephrased sentence.
const WORDS = '(?:pass(?:word|wd|code|phrase)|pwd|secret(?:[ _-]?(?:access[ _-]?)?key)?|token|api[ _-]?key|access[ _-]?key|private[ _-]?key|credentials?|密码|口令|密钥|秘钥|令牌|验证码)';
const JOIN = '(?:\\s+(?:is|was|are)\\s+|\\s*[=:：]\\s*|\\s*[是为]\\s*)';

const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
};
const isCard = (match) => {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
};

// `blank` says how to replace a match; `accept` filters matches that only look like the thing.
const RULES = [
  { kind: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'token', re: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{15,}/g },
  { kind: 'token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { kind: 'token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'token', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'token', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'token', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  { kind: 'credentials_url', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, blank: () => '[redacted]@' },
  { kind: 'password', re: new RegExp(`${WORDS}${JOIN}["'“‘\`]?([\\x21-\\x7E]{4,})`, 'gi'), blank: (match, value) => `${match.slice(0, match.length - value.length)}[redacted]` },
  { kind: 'card', re: /\b[2-6]\d(?:[ -]?\d){11,17}\b/g, accept: isCard },
  { kind: 'random_string', re: /\b(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,}\b/g },
];

/** The kind of the first secret found in the text ('token', 'password', 'card', ...), or null. */
export function findSecret(text) {
  const value = String(text ?? '');
  for (const { kind, re, accept } of RULES) {
    for (const match of value.matchAll(re)) if (!accept || accept(match[0])) return kind;
  }
  return null;
}

/** The text with every secret replaced by [redacted]. */
export function redact(text) {
  let value = String(text ?? '');
  for (const { re, accept, blank } of RULES) {
    value = value.replace(re, (...args) => {
      const match = args[0];
      if (accept && !accept(match)) return match;
      return blank ? blank(match, args[1]) : '[redacted]';
    });
  }
  return value;
}

/** Plain words for the kinds, for messages that must not repeat the value. */
export const SECRET_LABELS = {
  token: 'a token or key', password: 'a password', private_key: 'a private key', card: 'a card number',
  credentials_url: 'a web address with a password in it', random_string: 'a key',
};
