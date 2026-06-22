export const getCountryCode = (currency: string): string => {
    if (!currency) return '';

    const currencyUpper = currency.toUpperCase();
    const map: Record<string, string> = {
        'USD': 'us',
        'VND': 'vn',
        'AUD': 'au',
        'CAD': 'ca',
        'EUR': 'eu',
        'GBP': 'gb',
        'SGD': 'sg',
        'JPY': 'jp',
        'CNY': 'cn',
        'NZD': 'nz',
        'HKD': 'hk',
        'TWD': 'tw'
    };

    return map[currencyUpper] || '';
};
