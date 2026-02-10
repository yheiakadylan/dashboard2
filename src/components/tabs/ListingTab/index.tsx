import React, { useState } from 'react';
import AccountsList from './AccountsList.tsx';
import ListingTable from './ListingTable.tsx';

export default function ListingTab() {
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [selectedTab, setSelectedTab] = useState<'all' | 'active' | 'new' | 'inactive'>('new');

    const handleSelectAccount = (accountId: string, tab?: 'all' | 'active' | 'new' | 'inactive') => {
        setSelectedAccountId(accountId);
        if (tab) setSelectedTab(tab);
    };

    return (
        <div className="listing-tab">
            {selectedAccountId ? (
                <ListingTable
                    accountId={selectedAccountId}
                    initialTab={selectedTab}
                    onBack={() => {
                        setSelectedAccountId(null);
                        setSelectedTab('new'); // Reset to default
                    }}
                />
            ) : (
                <AccountsList onSelectAccount={handleSelectAccount} />
            )}
        </div>
    );
}
