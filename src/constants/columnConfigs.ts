export interface ColumnConfig {
  basis: string;
  flexGrow?: number;
  width?: string;
  justify?: 'center' | 'start' | 'end';
  isHiddenOnMobile?: boolean;
}

export const COLUMN_CONFIGS: { [key: string]: ColumnConfig } = {
  'Select': { basis: '50px', flexGrow: 0, width: '50px', justify: 'center' },
  'Checkbox': { basis: '50px', flexGrow: 0, width: '50px', justify: 'center' },
  'Image': { basis: '95px', flexGrow: 0, width: '95px', justify: 'center' },
  'Product Name': { basis: '1/4', flexGrow: 3 },
  'Listing ID': { basis: '130px', flexGrow: 1 },
  'Order Number': { basis: '110px', flexGrow: 1 },
  'Order ID': { basis: '110px', flexGrow: 1 },
  'Revenue': { basis: '80px', flexGrow: 1 },
  'Cost': { basis: '80px', flexGrow: 1 },
  'Cost (USD)': { basis: '80px', flexGrow: 1 },
  'Currency': { basis: '80px', flexGrow: 1 },
  'Curren': { basis: '80px', flexGrow: 1 },
  'Message': { basis: '250px', flexGrow: 2 },
  'Help Kind': { basis: '250px', flexGrow: 2 },
  'Status': { basis: '95px', flexGrow: 0, width: '95px', justify: 'center' },
  'DateTime': { basis: '110px', flexGrow: 1 },
  'Date': { basis: '110px', flexGrow: 1 },
  'Actions': { basis: '90px', flexGrow: 0, width: '90px', justify: 'center' },
  'Action': { basis: '90px', flexGrow: 0, width: '90px', justify: 'center' },
  'Fulfill': { basis: '120px', flexGrow: 1 },
  'Provider': { basis: '120px', flexGrow: 1 },
  'FF Code': { basis: '120px', flexGrow: 1 },
  'Fulfillment Code': { basis: '120px', flexGrow: 1 },
  'Account': { basis: '120px', flexGrow: 1 },
  'Shop Account': { basis: '120px', flexGrow: 1 },
  'Source': { basis: '100px', flexGrow: 1, isHiddenOnMobile: true },
};

export const getColumnStyle = (header: string): ColumnConfig => {
  return COLUMN_CONFIGS[header] || { basis: '120px', flexGrow: 1 };
};
