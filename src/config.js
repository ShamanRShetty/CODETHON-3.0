const { z } = require('zod');

const KNOWN_PLACEHOLDER_SECRETS = [
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'default-dev-jwt-secret-replace-in-prod-32c',
  'default-dev-otp-secret-replace-in-prod-32c',
  'change-me-long-random',
  'change-this-secret',
  'change-this-to-a-secure-random-secret',
];

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    BASE_URL: z.string().default('http://localhost:3000'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    MASTER_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be a 64-character hex string (32 bytes)'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    MAX_UPLOAD_MB: z.coerce.number().default(25),
    MAIL_MODE: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    DB_PATH: z.string().default('./storage/vaultlink.sqlite'),
    NODE_ENV: z.string().default('development'),
    TRUST_PROXY: z
      .union([z.boolean(), z.string(), z.number()])
      .default(false)
      .transform((val) => {
        if (typeof val === 'string') {
          if (val.toLowerCase() === 'true' || val === '1') return true;
          if (val.toLowerCase() === 'false' || val === '0') return false;
          if (/^\d+$/.test(val)) return Number(val);
          return val;
        }
        return Boolean(val);
      }),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (data.MASTER_KEY.toLowerCase() === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MASTER_KEY'],
          message: 'MASTER_KEY cannot use the public example key in production',
        });
      }
      if (KNOWN_PLACEHOLDER_SECRETS.includes(data.JWT_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET cannot use default placeholder in production',
        });
      }
      if (KNOWN_PLACEHOLDER_SECRETS.includes(data.OTP_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_SECRET'],
          message: 'OTP_SECRET cannot use default placeholder in production',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  console.error(`[Config Error] Invalid configuration: ${errors}`);
  process.exit(1);
}

if (parsed.data.MAIL_MODE === 'console' && parsed.data.NODE_ENV === 'production') {
  console.warn('[Warning] MAIL_MODE is set to "console" in production. Verification emails will not be delivered to recipients.');
}

module.exports = parsed.data;

