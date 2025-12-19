import React, { useState } from 'react';
import { Record } from '../types';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import ImagePreviewModal from './ImagePreviewModal';

interface OrderDetailModalProps {
  record: Record;
  onClose: () => void;
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ record, onClose }) => {
  const { accounts } = useDashboard();
  const { timeZone } = useUI();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!record.details) return null;

  const { details, order_id, dt_local, account } = record;
  const { customerName, customerEmail, shippingAddress, items, financials } = details;

  const matchedAccount = accounts.find(acc => acc.email === account);
  const shopName = matchedAccount?.label || account;

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date(dt_local));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4 animate-modal-backdrop" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700 animate-modal-scale" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order #{order_id}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {formattedDate} • Shop: {shopName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-6 space-y-8">

          {/* Customer & Address Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Customer</h3>
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md border border-gray-100 dark:border-gray-600">
                <p className="text-lg font-medium text-gray-900 dark:text-white">{customerName}</p>
                {customerEmail && (
                  <a href={`mailto:${customerEmail}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm block mt-1 break-all">
                    {customerEmail}
                  </a>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Shipping Address</h3>
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md border border-gray-100 dark:border-gray-600 text-gray-800 dark:text-gray-200">
                <p className="font-medium">{shippingAddress.name}</p>
                <p>{shippingAddress.address1}</p>
                {shippingAddress.address2 && <p>{shippingAddress.address2}</p>}
                <p>{shippingAddress.city}, {shippingAddress.state} {shippingAddress.zip}</p>
                <p className="font-medium mt-1">{shippingAddress.country}</p>
              </div>
            </div>
          </div>

          {/* Items Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Items ({items.length})</h3>

            {/* Mobile Card Layout */}
            <div className="md:hidden space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                  <div className="flex gap-3">
                    {item.image && (
                      <img
                        src={item.image}
                        alt=""
                        className="w-20 h-20 object-cover rounded-md border border-gray-200 dark:border-gray-600 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPreviewImage(item.image)}
                        title="Click to view full size"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">{item.name}</p>
                      {item.variant && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">{item.variant}</p>
                      )}
                      {item.transactionId && <p className="text-xs text-gray-400 mt-1">ID: {item.transactionId}</p>}
                    </div>
                  </div>

                  {item.personalization && (
                    <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-gray-700 dark:text-gray-300 border border-yellow-100 dark:border-yellow-900/30">
                      <span className="font-semibold">Personalization:</span> {item.personalization}
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs block">Qty</span>
                      <span className="font-medium text-gray-900 dark:text-white">{item.quantity}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-500 dark:text-gray-400 text-xs block">Price</span>
                      <span className="font-medium text-gray-900 dark:text-white">${item.price.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500 dark:text-gray-400 text-xs block">Total</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">${(item.quantity * item.price).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table Layout */}
            <div className="hidden md:block border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-4">
                        <div className="flex items-start space-x-4">
                          {item.image && (
                            <img
                              src={item.image}
                              alt=""
                              className="w-16 h-16 object-cover rounded-md border border-gray-200 dark:border-gray-600 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setPreviewImage(item.image)}
                              title="Click to view full size"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{item.name}</p>
                            {item.variant && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">{item.variant}</p>
                            )}
                            {item.personalization && (
                              <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-gray-700 dark:text-gray-300 border border-yellow-100 dark:border-yellow-900/30">
                                <span className="font-semibold">Personalization:</span> {item.personalization}
                              </div>
                            )}
                            {item.transactionId && <p className="text-xs text-gray-400 mt-1">ID: {item.transactionId}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white align-top">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-gray-900 dark:text-white align-top">
                        ${item.price.toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium text-gray-900 dark:text-white align-top">
                        ${(item.quantity * item.price).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial Summary */}
          {financials && (
            <div className="flex justify-end">
              <div className="w-full md:w-1/2 lg:w-1/3 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md border border-gray-100 dark:border-gray-600">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Item Total</span>
                    <span>${financials.itemTotal.toFixed(2)}</span>
                  </div>
                  {financials.discount !== 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Discount</span>
                      <span>-${Math.abs(financials.discount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Shipping</span>
                    <span>${financials.shipping.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Tax</span>
                    <span>${financials.tax.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2 flex justify-between text-base font-bold text-gray-900 dark:text-white">
                    <span>Order Total</span>
                    <span>${financials.orderTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-white rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors font-medium">
            Close
          </button>
        </div>
      </div>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        imageUrl={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(OrderDetailModal);
