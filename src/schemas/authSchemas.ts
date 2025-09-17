import { z } from 'zod';

export const UsernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.-]+$/);

export const SessionRequestSchema = z.object({
  idToken: z.string().min(10)
});

export const UpdateMeSchema = z.object({
  username: UsernameSchema.optional(),
  photoURL: z.string().url().optional()
});

export type SessionRequest = z.infer<typeof SessionRequestSchema>;
export type UpdateMeRequest = z.infer<typeof UpdateMeSchema>;

export const OtpStartSchema = z.object({
  email: z.string().email()
});

export const OtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^[0-9]{6}$/),
  password: z.string().min(6).optional().or(z.literal(''))
});

export const EmailUsernameSchema = z.object({
  email: z.string().email(),
  username: UsernameSchema
});



