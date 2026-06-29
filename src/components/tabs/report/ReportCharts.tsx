import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

interface TrendRow {
  date: string;
  label: string;
  orders: number;
  designs: number;
  fulfilled: number;
  reviews: number;
}

interface SupplierRow {
  name: string;
  value: number;
}

const CHART_COLORS = ['#2563eb', '#059669', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

export const ReportTrendChart: React.FC<{ data: TrendRow[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
      <XAxis dataKey="label" fontSize={12} />
      <YAxis allowDecimals={false} fontSize={12} />
      <RechartsTooltip />
      <Legend />
      <Bar dataKey="orders" name="Orders" fill="#2563eb" radius={[4, 4, 0, 0]} />
      <Bar dataKey="designs" name="Design submits" fill="#7c3aed" radius={[4, 4, 0, 0]} />
      <Bar dataKey="fulfilled" name="Fulfilled" fill="#059669" radius={[4, 4, 0, 0]} />
      <Bar dataKey="reviews" name="Reviews" fill="#f59e0b" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

export const ReportSupplierPieChart: React.FC<{ data: SupplierRow[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
        {data.map((entry, index) => (
          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
        ))}
      </Pie>
      <RechartsTooltip />
      <Legend />
    </PieChart>
  </ResponsiveContainer>
);