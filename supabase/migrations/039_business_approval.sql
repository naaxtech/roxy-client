-- Migration 039: Business approval flow
-- Adds business_rejection_reason column and expands email_queue email_type constraint

-- 1. Add rejection reason to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_rejection_reason text;

-- 2. Expand email_queue email_type CHECK constraint to include business emails
--    Drop old constraint, add new one with business_approved + business_rejected
ALTER TABLE public.email_queue
  DROP CONSTRAINT IF EXISTS email_queue_email_type_check;

ALTER TABLE public.email_queue
  ADD CONSTRAINT email_queue_email_type_check
  CHECK (email_type IN (
    'order_shipped_buyer',
    'product_approved',
    'product_rejected',
    'refund_notification_buyer',
    'dispute_alert_business',
    'business_approved',
    'business_rejected'
  ));
