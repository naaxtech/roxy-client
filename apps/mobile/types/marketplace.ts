export type ProductCategory = 'apparel' | 'accessories' | 'beauty' | 'art' | 'food' | 'books' | 'other';
export type ProductStatus = 'pending' | 'approved' | 'rejected' | 'archived';
export type OrderStatus = 'paid' | 'shipped' | 'delivered' | 'refunded' | 'cancelled';

export interface Product {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  category: ProductCategory;
  status: ProductStatus;
  is_active: boolean;
  has_variants: boolean;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  price_cents: number;
  stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductPhoto {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  position: number;
  created_at: string;
}

export interface ProductWithVariants extends Product {
  product_variants: ProductVariant[];
  product_photos: ProductPhoto[];
}

export interface Cart {
  id: string;
  buyer_id: string;
  business_id: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  added_at: string;
  product?: Product;
  variant?: ProductVariant;
}

/** One line the buyer is paying for — the shape mirrored into `cart_items` before checkout. */
export interface CheckoutLine {
  product_id: string;
  variant_id: string | null;
  quantity: number;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

/**
 * Column names below are the ones migration 032_marketplace_orders.sql actually
 * created and that are live in the database — verified against the deployed
 * schema, not against this file. `orders.total_cents`, `order_items.line_total_cents`
 * and `order_events.event` are GENERATED / CHECK-constrained columns; there is no
 * `total_price_cents`, no `event_type` and no `description` anywhere in this schema.
 *
 * Each interface lists exactly the columns `marketplaceStore.fetchOrders` selects.
 * Do not widen one without widening the query — a field the query never asked for
 * is `undefined` at runtime while tsc happily reports it as a `number`.
 */
export interface Order {
  id: string;
  buyer_id: string;
  business_id: string;
  status: OrderStatus;
  shipping_name: string;
  shipping_line1: string;
  shipping_line2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
  currency: string;
  subtotal_cents: number;
  shipping_cost_cents: number;
  tax_cents: number;
  /** GENERATED ALWAYS AS (subtotal + shipping + tax) — never written by the client. */
  total_cents: number;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  unit_price_cents: number;
  quantity: number;
  /** GENERATED ALWAYS AS (unit_price_cents * quantity). */
  line_total_cents: number;
  created_at: string;
}

export type OrderEventType =
  | 'payment_confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'note_added';

export type OrderEventActor = 'buyer' | 'business' | 'staff' | 'system';

export interface OrderEvent {
  id: string;
  order_id: string;
  event: OrderEventType;
  note: string | null;
  metadata: Record<string, unknown> | null;
  actor_type: OrderEventActor;
  created_at: string;
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[];
  order_events: OrderEvent[];
}
