import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import * as L from './cart-logic';

interface CartStore extends L.CartState {
  add: (p: Omit<L.CartLine, 'quantity'>, qty?: number) => void;
  setQty: (index: number, qty: number) => void;
  remove: (index: number) => void;
  setLineDiscount: (index: number, d: L.CartLine['discount']) => void;
  setBillDiscount: (d: L.CartState['billDiscount'], approval?: L.CartState['discountApproval']) => void;
  setDiscountReason: (r: string) => void;
  setCustomer: (c: Partial<L.CartState['customer']>) => void;
  setNotes: (n: string) => void;
  applyCatalog: (m: Map<string, { sellingPricePaise: number; availableQuantity: number }>) => string[];
  loadLines: (lines: Omit<L.CartLine, never>[]) => void;
  /** Start a brand-new bill (new idempotency key). */
  reset: () => void;
}

const newKey = () => Crypto.randomUUID();

/**
 * The cart (with its idempotency key) is persisted to the device so it survives app restarts,
 * crashes and sign-outs. It is only cleared after the server confirms the bill.
 */
export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      ...L.emptyCart(newKey()),
      add: (p, qty) => set(L.addItem(get(), p, qty)),
      setQty: (i, q) => set(L.setQuantity(get(), i, q)),
      remove: (i) => set(L.removeLine(get(), i)),
      setLineDiscount: (i, d) => set({ lines: get().lines.map((l, j) => (j === i ? { ...l, discount: d } : l)), discountApproval: null }),
      setBillDiscount: (d, approval) => set({ billDiscount: d, discountApproval: approval ?? null }),
      setDiscountReason: (discountReason) => set({ discountReason }),
      setCustomer: (c) => set({ customer: { ...get().customer, ...c } }),
      setNotes: (notes) => set({ notes }),
      applyCatalog: (m) => {
        const { cart, changed } = L.refreshFromCatalog(get(), m);
        if (cart !== get()) set({ lines: cart.lines, updatedAt: cart.updatedAt });
        return changed;
      },
      loadLines: (lines) => set({ ...L.emptyCart(newKey()), lines }),
      reset: () => set(L.emptyCart(newKey())),
    }),
    {
      name: 'kite.cart.v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Manager credentials are never written to disk.
      partialize: ({ discountApproval: _omit, ...rest }) => rest,
    },
  ),
);

export { L as cartLogic };
