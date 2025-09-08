'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bitcoin, DollarSign } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">LIQUID ABT Bitcoin Treasury</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bitcoin Price</CardTitle>
            <Bitcoin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$65,000</div>
            <p className="text-xs text-muted-foreground">+2.5% today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Portfolio</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$50,000</div>
            <p className="text-xs text-muted-foreground">0.769 BTC</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}