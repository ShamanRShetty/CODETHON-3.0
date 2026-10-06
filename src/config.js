const { z } = require('zod');

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  BASE_URL: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be a 64-character hex string (32 bytes)'),
  OTP_SECRET: z.string().min(1, 'OTP_SECRET is required'),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
  MAIL_MODE: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  DB_PATH: z.string().default('./storage/vaultlink.sqlite'),
  NODE_ENV: z.string().default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  console.error(`[Config Error] Invalid configuration: ${errors}`);
  process.exit(1);
}

module.exports = parsed.data;
