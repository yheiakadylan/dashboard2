// components/ManualCostManager.tsx
import React, { useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import { addManualCost, updateManualCost, deleteManualCost } from '../services/firebaseService';

interface ManualCostEntry {
  id: string;
  providerName: string;
  cost: number;
  date: string;
  currency?: string;
  timeZone?: string;
}

const ManualCostManager: React.FC = () => {
  const { teamId, manualCosts, setManualCosts } = useDashboard();
  const { timeZone } = useUI();

  const getTodayInTimezone = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return formatter.format(new Date());
  };

  const [providerName, setProviderName] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState(getTodayInTimezone);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State for editing
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState({ providerName: '', cost: '', date: '' });
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const costValue = parseFloat(cost);
    if (!providerName || isNaN(costValue) || costValue <= 0 || !date) {
      setError('Please fill in all fields with valid data.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const newEntry = {
      providerName,
      cost: costValue,
      date,
      timeZone,
    };

    try {
      const newId = await addManualCost(teamId, newEntry);
      setManualCosts(prev => [...prev, { ...newEntry, currency: 'USD', id: newId }]);
      setProviderName('');
      setCost('');
      setDate(getTodayInTimezone());
    } catch (err) {
      console.error(err);
      setError('Failed to save cost. Please try again.');
    }
    setIsSaving(false);
  };

  const handleStartEdit = (entry: ManualCostEntry) => {
    setEditingCostId(entry.id);
    setEditFormData({
      providerName: entry.providerName,
      cost: entry.cost.toString(),
      date: entry.date,
    });
  };

  const handleCancelEdit = () => {
    setEditingCostId(null);
  };

  const handleUpdate = async (id: string) => {
    const costValue = parseFloat(editFormData.cost);
    if (!editFormData.providerName || isNaN(costValue) || costValue <= 0 || !editFormData.date) {
      alert('Please fill in all fields with valid data.');
      return;
    }
    setIsSaving(true);
    const updatedData = {
      providerName: editFormData.providerName,
      cost: costValue,
      date: editFormData.date,
    };
    try {
      await updateManualCost(teamId, id, updatedData);
      setManualCosts(prev => prev.map(c => c.id === id ? { ...c, ...updatedData } : c));
      setEditingCostId(null);
    } catch (err) {
      console.error(err);
      alert('Failed to update cost entry.');
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      setIsDeleting(id);
      try {
        await deleteManualCost(teamId, id);
        setManualCosts(prev => prev.filter(c => c.id !== id));
      } catch (err) {
        console.error(err);
        alert('Failed to delete cost entry.');
      }
      setIsDeleting(null);
    }
  };


  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3 border-b pb-2">Add Manual Fulfillment Cost</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md"
            />
            <input
              type="text"
              placeholder="Fulfillment Provider"
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md"
            />
            <input
              type="number"
              placeholder="Total Cost (USD)"
              value={cost}
              onChange={e => setCost(e.target.value)}
              step="0.01"
              min="0"
              className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Cost'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </form>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3 border-b pb-2">Recent Manual Entries</h3>
        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
          {manualCosts.length === 0 && <p className="text-gray-500">No manual entries found.</p>}
          {[...manualCosts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((entry) => (
            <div key={entry.id} className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
              {editingCostId === entry.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="date"
                      value={editFormData.date}
                      onChange={e => setEditFormData({ ...editFormData, date: e.target.value })}
                      className="px-2 py-1 bg-gray-50 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md text-sm"
                    />
                    <input
                      type="text"
                      value={editFormData.providerName}
                      onChange={e => setEditFormData({ ...editFormData, providerName: e.target.value })}
                      className="px-2 py-1 bg-gray-50 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md text-sm"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={editFormData.cost}
                      onChange={e => setEditFormData({ ...editFormData, cost: e.target.value })}
                      className="px-2 py-1 bg-gray-50 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdate(entry.id)} disabled={isSaving} className="px-3 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-50">
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleCancelEdit} className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-400 text-white rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold">{entry.providerName}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">({entry.date})</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      ${entry.cost.toFixed(2)} {entry.currency}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => handleStartEdit(entry)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => handleDelete(entry.id)} disabled={isDeleting === entry.id} className="text-xs text-red-600 hover:underline disabled:opacity-50">
                        {isDeleting === entry.id ? '...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(ManualCostManager);
