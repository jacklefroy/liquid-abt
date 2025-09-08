'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your treasury settings</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Treasury Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Revenue Conversion Rate</label>
                <p className="text-sm text-muted-foreground">15% of revenue converted to Bitcoin</p>
              </div>
              <Button>Update Settings</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Integrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Stripe</label>
                <p className="text-sm text-muted-foreground">Connected</p>
              </div>
              <Button variant="outline">Manage Integrations</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}