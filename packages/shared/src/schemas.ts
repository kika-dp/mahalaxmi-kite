/**
 * Zod schemas for client-side forms (CRM & mobile). The API validates independently with
 * class-validator DTOs mirroring these rules.
 */
import { z } from 'zod';
import {
  ADJUSTMENT_TYPES,
  CASH_MOVEMENT_TYPES,
  PAYMENT_METHODS,
  PRODUCT_KINDS,
  ROLES,
  UNIT_TYPES,
} from './enums';
import { normalizeIndianPhone, passwordPolicyError, SKU_PATTERN, USERNAME_PATTERN } from './normalize';
import { tryRupeesToPaise } from './money';

/** A rupee amount entered as text ("12.50"); validated, not transformed. */
export const rupeeString = (opts: { required?: boolean; min?: number } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => (v === '' ? !opts.required : tryRupeesToPaise(v) !== null), {
      message: opts.required ? 'Enter a valid amount' : 'Enter a valid amount or leave empty',
    })
    .refine((v) => v === '' || opts.min === undefined || (tryRupeesToPaise(v) ?? 0) >= opts.min, {
      message: 'Amount is too low',
    });

export const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || normalizeIndianPhone(v) !== null, {
    message: 'Enter a valid 10-digit mobile number',
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your username or email').max(120),
  password: z.string().min(1, 'Enter your password').max(128),
  remember: z.boolean().optional(),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    const err = passwordPolicyError(v.newPassword);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: err });
    if (v.newPassword !== v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' });
    }
    if (v.newPassword === v.currentPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: 'New password must differ' });
    }
  });
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

export const productFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(120),
    sku: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => v === '' || SKU_PATTERN.test(v), 'Use letters, digits, - or _ (max 40)'),
    barcode: z.string().trim().max(64),
    categoryId: z.string().uuid('Select a category'),
    kind: z.enum(PRODUCT_KINDS as [string, ...string[]]),
    unitType: z.enum(UNIT_TYPES as [string, ...string[]]),
    description: z.string().max(1000),
    sellingPrice: rupeeString({ required: true }),
    purchasePrice: rupeeString(),
    mrp: rupeeString(),
    minStockAlert: z.coerce.number().int().min(0).max(1_000_000),
    supplierId: z.string(),
    isActive: z.boolean(),
    isFavorite: z.boolean(),
    favoriteOrder: z.coerce.number().int().min(0).max(999),
    openingStock: z.coerce.number().int().min(0).max(10_000_000).optional(),
    bundleItems: z
      .array(z.object({ componentProductId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(9999) }))
      .max(20),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'BUNDLE' && v.bundleItems.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bundleItems'], message: 'Add at least one component' });
    }
    const ids = v.bundleItems.map((b) => b.componentProductId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bundleItems'], message: 'Duplicate component' });
    }
  });
export type ProductForm = z.infer<typeof productFormSchema>;

export const userFormSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, '3–32 chars: a-z, 0-9, dot, dash, underscore'),
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(100),
  phone: optionalPhone,
  role: z.enum(ROLES as [string, ...string[]]),
  password: z.string().optional(),
  maxDiscountPercent: z.string().trim(),
});
export type UserForm = z.infer<typeof userFormSchema>;

export const adjustmentFormSchema = z.object({
  productId: z.string().uuid('Select a product'),
  type: z.enum(ADJUSTMENT_TYPES as [string, ...string[]]),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(1_000_000),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
export type AdjustmentForm = z.infer<typeof adjustmentFormSchema>;

export const paymentEntrySchema = z.object({
  method: z.enum(PAYMENT_METHODS as [string, ...string[]]),
  amount: rupeeString({ required: true, min: 1 }),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
});
export type PaymentEntryForm = z.infer<typeof paymentEntrySchema>;

export const customerFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter the customer name').max(100),
  phone: optionalPhone,
  address: z.string().trim().max(500),
  notes: z.string().trim().max(1000),
});
export type CustomerForm = z.infer<typeof customerFormSchema>;

export const supplierFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optionalPhone,
  address: z.string().trim().max(500),
  notes: z.string().trim().max(1000),
});
export type SupplierForm = z.infer<typeof supplierFormSchema>;

export const cashMovementSchema = z.object({
  type: z.enum(CASH_MOVEMENT_TYPES as [string, ...string[]]),
  amount: rupeeString({ required: true, min: 1 }),
  reason: z.string().trim().min(3).max(200),
});
export type CashMovementForm = z.infer<typeof cashMovementSchema>;
