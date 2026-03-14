import Stripe from 'stripe';

// SECURITY: Stripe secret key must be set via environment variable — never hardcode
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn('STRIPE_SECRET_KEY not set. Stripe payments will not work.');
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: '2024-11-20.acacia' } as any)
  : null as unknown as Stripe;

// Plan configurations — price IDs loaded from environment variables
// Set STRIPE_PRICE_* env vars to your actual Stripe price IDs
export const PLANS = {
  // BYOL Plans (Bring Your Own License)
  starter_byol: {
    name: 'Starter',
    displayName: 'Starter (BYOL)',
    monthlyPriceId: process.env.STRIPE_PRICE_STARTER_BYOL_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_STARTER_BYOL_ANNUAL || '',
    maxProjects: 2,
    maxDocumentsPerProject: 10,
    maxStorageGB: 1,
    features: ['1 discipline included', 'Code compliance checker (BYOL)', '1 GB secure storage (~20 projects)', 'PDF/spec/drawing parsing', 'AI-generated Bill of Quantities', 'Export to Excel / PDF'],
    monthlyPrice: 49, // $49 CAD from Stripe
    annualMonthlyEquivalent: 44.10, // $44.10 CAD from Stripe (10% discount applied)
    currency: 'CAD',
    licenseType: 'byol',
  },
  pro_byol: {
    name: 'Professional',
    displayName: 'Professional (BYOL)',
    monthlyPriceId: process.env.STRIPE_PRICE_PRO_BYOL_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_PRO_BYOL_ANNUAL || '',
    maxProjects: 100,
    maxDocumentsPerProject: -1,
    maxStorageGB: 5,
    features: ['Any 3 disciplines included', '5 GB secure storage (~100 projects)', 'Code compliance checker (BYOL)', '3D BIM model stubs (IFC/Revit)', 'Team collaboration (up to 10 users)', 'Priority email support'],
    monthlyPrice: 149, // $149 CAD from Stripe
    annualMonthlyEquivalent: 134.10, // $1,609.20 ÷ 12 = $134.10 CAD from Stripe
    currency: 'CAD',
    licenseType: 'byol',
  },
  enterprise_byol: {
    name: 'Enterprise',
    displayName: 'Enterprise (BYOL)',
    monthlyPriceId: process.env.STRIPE_PRICE_ENTERPRISE_BYOL_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_ENTERPRISE_BYOL_ANNUAL || '',
    maxProjects: -1,
    maxDocumentsPerProject: -1,
    maxStorageGB: -1, // unlimited
    features: ['All disciplines (Structural, Mechanical, Electrical, Civil, Architectural)', 'Code compliance checker (BYOL)', 'Unlimited projects & storage', 'Integration with ERP & project management tools', 'Dedicated account manager', 'SLA-backed uptime', 'Training & onboarding'],
    monthlyPrice: 499, // $499 CAD from Stripe
    annualMonthlyEquivalent: 449.10, // $449.10 CAD from Stripe (10% discount applied)
    currency: 'CAD',
    licenseType: 'byol',
  },
  
  // License-Included Plans
  starter_included: {
    name: 'Starter',
    displayName: 'Starter (Codes Included)',
    monthlyPriceId: process.env.STRIPE_PRICE_STARTER_INCLUDED_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_STARTER_INCLUDED_ANNUAL || '',
    maxProjects: 2,
    maxDocumentsPerProject: 10,
    maxStorageGB: 1,
    features: ['1 discipline included', 'Code compliance checker (inclusive of licenses)', '1 GB secure storage (~20 projects)', 'PDF/spec/drawing parsing', 'AI-generated Bill of Quantities', 'Export to Excel / PDF'],
    monthlyPrice: 99, // $99 CAD from Stripe
    annualMonthlyEquivalent: 89.10, // $1,069.20 ÷ 12 = $89.10 CAD from Stripe
    currency: 'CAD',
    licenseType: 'included',
  },
  single_project: {
    name: 'Single Project',
    displayName: 'Single Project (Codes Included)',
    priceId: process.env.STRIPE_PRICE_SINGLE_PROJECT || '',
    maxProjects: 1,
    maxDocumentsPerProject: -1,
    maxStorageGB: 1,
    disciplines: 1,
    features: ['Upload specs & drawings → get BoQ + BIM stub', 'Code compliance checker (inclusive of licenses)', 'Includes 1 GB storage for 1 year', 'Extra discipline modules: +$100 each', 'Extra storage: $10/GB'],
    price: 349, // $349 CAD from Stripe
    currency: 'CAD',
    licenseType: 'included',
    oneTime: true,
  },
  pro_included: {
    name: 'Professional',
    displayName: 'Professional (All Inclusive)',
    monthlyPriceId: process.env.STRIPE_PRICE_PRO_INCLUDED_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_PRO_INCLUDED_ANNUAL || '',
    maxProjects: 100,
    maxDocumentsPerProject: -1,
    maxStorageGB: 5,
    disciplines: 3,
    features: ['Any 3 disciplines included', '5 GB secure storage (~100 projects)', 'Code compliance checker (inclusive of licenses)', '3D BIM model stubs (IFC/Revit)', 'Team collaboration (up to 10 users)', 'Priority email support'],
    monthlyPrice: 950, // $950 CAD from Stripe
    annualMonthlyEquivalent: 855, // $855 CAD from Stripe (10% discount applied)
    currency: 'CAD',
    licenseType: 'included',
  },
  enterprise_included: {
    name: 'Enterprise',
    displayName: 'Enterprise (Gold)',
    monthlyPriceId: process.env.STRIPE_PRICE_ENTERPRISE_INCLUDED_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_ENTERPRISE_INCLUDED_ANNUAL || '',
    maxProjects: -1,
    maxDocumentsPerProject: -1,
    maxStorageGB: -1, // unlimited
    disciplines: -1, // all disciplines
    features: ['All disciplines (Structural, Mechanical, Electrical, Civil, Architectural)', 'Code compliance checker (inclusive of licenses)', 'Unlimited projects & storage', 'Integration with ERP & project management tools', 'Dedicated account manager', 'SLA-backed uptime', 'Training & onboarding'],
    monthlyPrice: 5000, // $5000 CAD from Stripe
    annualMonthlyEquivalent: 4500, // $4500 CAD from Stripe (10% discount applied)
    currency: 'CAD',
    licenseType: 'included',
  },
} as const;

export const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '14');

export type PlanKey = keyof typeof PLANS;

export function isPlanKey(key: string): key is PlanKey {
  return key in PLANS;
}

export function createCheckoutSession(params: {
  priceId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: params.priceId,
        quantity: 1,
      },
    ],
    customer: params.customerId,
    customer_email: params.customerEmail,
    subscription_data: {
      trial_period_days: params.trialPeriodDays,
      metadata: params.metadata,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
  });
}

export function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export function constructWebhookEvent(
  body: string | Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(body, signature, secret);
}