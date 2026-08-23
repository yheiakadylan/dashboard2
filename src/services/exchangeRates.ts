
export interface ExchangeRates {
    [currency: string]: number;
}

interface ExchangeRateAPIResponse {
    result: string;
    conversion_rates: { [key: string]: number };
}

/**
 * Fetch exchange rates directly from ExchangeRate-API
 * Free tier: 1,500 requests/month, updates daily
 * With API key: 100,000 requests/month
 */
export const fetchExchangeRates = async (): Promise<ExchangeRates | null> => {
    try {
        const API_KEY = '81aacb7bdaa3b77d285be32f';
        const response = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/USD`);

        if (!response.ok) {
            console.error(`ExchangeRate API failed: ${response.status}`);
            return null;
        }

        const data = await response.json() as ExchangeRateAPIResponse;

        if (data.result !== 'success') {
            console.error('ExchangeRate API error');
            return null;
        }

        // Convert rates: API returns USD -> XXX, we need XXX -> USD
        // Example: USD -> AUD = 1.54 means AUD -> USD = 1/1.54 = 0.65
        const rates: ExchangeRates = {};
        const targetCurrencies = ['AUD', 'GBP', 'NZD', 'CAD', 'EUR', 'SGD', 'USD'];

        targetCurrencies.forEach(currency => {
            if (currency === 'USD') {
                rates['USD'] = 1;
            } else if (data.conversion_rates[currency]) {
                rates[currency] = 1 / data.conversion_rates[currency];
            }
        });

        return rates;
    } catch (error) {
        console.error("Failed to fetch exchange rates", error);
        return null;
    }
}
