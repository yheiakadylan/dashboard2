import React, { useState } from 'react';
import { Record } from '../types';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import ImagePreviewModal from './ImagePreviewModal';

interface OrderDetailModalProps {
  record: Record;
  onClose: () => void;
  onResync?: (id: string) => void;
  allRecords?: Record[]; // To find refund details
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ record, onClose, onResync, allRecords = [] }) => {
  const { accounts } = useDashboard();
  const { timeZone } = useUI();
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isResyncing, setIsResyncing] = useState(false);

  if (!record.details) return null;

  // ✅ Find and Aggregate refund details
  const refundDetails = React.useMemo(() => {
    if (record.refund_details) return record.refund_details;

    const refundRecords = allRecords.filter(r =>
      (r.source === 'Etsy_Refunded' || r.source === 'Ebay_Refunded') &&
      r.order_id === record.order_id
    );

    if (refundRecords.length === 0) return undefined;

    // Aggregate
    const firstVal = refundRecords[0].refund_details;
    const currency = firstVal?.refundCurrency || refundRecords[0].currency || 'USD';

    let totalRefunded = 0;
    let totalDeducted = 0;
    let totalFee = 0;
    const reasons: string[] = [];

    refundRecords.forEach(r => {
      const d = r.refund_details;
      if (d) {
        totalRefunded += d.refundAmount || 0;
        totalDeducted += d.deductedFromShop || 0;
        totalFee += d.refundedFee || 0;
        if (d.reason) reasons.push(d.reason);
      } else {
        totalRefunded += Math.abs(r.amount);
      }
    });

    return {
      refundAmount: totalRefunded,
      refundCurrency: currency,
      deductedFromShop: totalDeducted,
      deductedCurrency: currency,
      refundedFee: totalFee,
      feeCurrency: currency,
      reason: reasons.length > 0 ? reasons.join('; ') : 'N/A'
    };
  }, [allRecords, record]);

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

  const handleResyncClick = async () => {
    if (onResync && record.id) {
      if (!record.email_id) {
        return;
      }

      setIsResyncing(true);
      await onResync(record.id);
      setIsResyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4 animate-modal-backdrop" onClick={onClose}>
      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700 animate-modal-scale" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order #{order_id}</h2>
              {record.listing_id && (
                <a
                  href={`https://www.etsy.com/listing/${record.listing_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded hover:bg-indigo-200 transition-colors flex items-center gap-1"
                  title="View Linked Listing on Etsy"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                  Listing: {record.listing_id}
                </a>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {formattedDate} • Shop: {shopName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-4 space-y-4">

          {/* Customer Information & Order Details sections stay here */}

          {/* Customer & Address Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2 text-sm">Customer</h3>
              <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md border border-gray-100 dark:border-gray-600">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{customerName}</p>
                {customerEmail && (
                  <a href={`mailto:${customerEmail}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs block mt-1 break-all">
                    {customerEmail}
                  </a>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2 text-sm">Shipping Address</h3>
              <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md border border-gray-100 dark:border-gray-600 text-gray-800 dark:text-gray-200 text-xs space-y-0.5">
                <p className="font-medium">{shippingAddress.name}</p>
                <p>{shippingAddress.address1}</p>
                {shippingAddress.address2 && <p>{shippingAddress.address2}</p>}
                <p>{shippingAddress.city}, {shippingAddress.state} {shippingAddress.zip}</p>
                <p className="font-medium">{shippingAddress.country}</p>
              </div>
            </div>
          </div>

          {/* Items Section */}
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white mb-2 text-sm">Items ({items.length})</h3>

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

          {/* Grid Layout: Refund Information & Order Total Side by Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Refund Information - Left Column */}
            {refundDetails && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800/50">
                <h3 className="text-red-800 dark:text-red-400 font-bold mb-2 flex items-center gap-1.5 text-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  Refund
                </h3>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Total Refunded:</span>
                    <span className="font-bold text-red-700 dark:text-red-400">
                      {refundDetails.refundCurrency} ${refundDetails.refundAmount.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Deducted from Shop:</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {refundDetails.deductedCurrency} ${refundDetails.deductedFromShop.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Fee Refunded by Etsy:</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {refundDetails.feeCurrency} ${refundDetails.refundedFee.toFixed(2)}
                    </span>
                  </div>
                  {refundDetails.reason && (
                    <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-600">
                      <span className="text-gray-600 dark:text-gray-400">Reason:</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right flex-1 ml-4">{refundDetails.reason}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Order Total - Right Column */}
            {financials && (
              <div className={refundDetails ? '' : 'md:col-start-2'}>
                <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md border border-gray-100 dark:border-gray-600">
                  <div className="space-y-1.5 text-xs">
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
                    <div className="border-t border-gray-200 dark:border-gray-600 pt-1.5 mt-1.5 flex justify-between text-sm font-bold text-blue-600 dark:text-white">
                      <span>Order Total</span>
                      <span>${financials.orderTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg flex justify-between items-center">
          {/* Left Action: Resync */}
          {onResync && record.email_id ? (
            <button
              onClick={handleResyncClick}
              disabled={isResyncing}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-md transition-colors text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              {isResyncing ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Syncing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Resync
                </>
              )}
            </button>
          ) : <div></div>}

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
