// LIQUID ABT - Beta Onboarding Completion Endpoint
// Complete beta onboarding and create tenant

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { generateTenantId } from '@/lib/utils/tenant';
import { createTenantSchema } from '@/lib/database/migrations/createTenantSchema';

export async function POST(request: NextRequest) {
  try {
    const onboardingData = await request.json();
    
    // Validate required data
    if (!onboardingData.business?.companyName || !onboardingData.business?.contactEmail) {
      return NextResponse.json(
        { error: 'Missing required business information' },
        { status: 400 }
      );
    }

    // Generate tenant ID
    const tenantId = generateTenantId();
    const tenantSlug = onboardingData.business.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 30);

    // Get database connections
    const publicDb = await getDatabase('public');
    const tenantDb = await getDatabase(tenantId);

    // Start transaction for tenant creation
    await publicDb.query('BEGIN');
    
    try {
      // Create tenant record in master database
      await publicDb.query(`
        INSERT INTO tenants (
          id,
          slug,
          name,
          subscription_tier,
          status,
          contact_email,
          phone_number,
          abn,
          industry,
          monthly_revenue_range,
          is_beta_user,
          beta_started_at,
          settings,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
        )
      `, [
        tenantId,
        tenantSlug,
        onboardingData.business.companyName,
        'PRO', // Beta users get Pro tier free for 6 months
        'ACTIVE',
        onboardingData.business.contactEmail,
        onboardingData.business.phoneNumber || null,
        onboardingData.business.abn || null,
        onboardingData.business.industry,
        onboardingData.business.monthlyRevenue,
        true, // Beta user flag
        new Date(),
        JSON.stringify({
          currency: 'AUD',
          timezone: 'Australia/Sydney',
          bitcoinAddress: onboardingData.wallet?.address,
          walletType: onboardingData.wallet?.type || 'self-custody',
        }),
      ]);

      // Create tenant-specific database schema
      await createTenantSchema(tenantId);

      // Set up treasury rules in tenant database
      if (onboardingData.treasury) {
        await tenantDb.query(`
          INSERT INTO treasury_rules (
            tenant_id,
            rule_type,
            conversion_percentage,
            minimum_amount,
            frequency,
            risk_tolerance,
            is_active,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, NOW()
          )
        `, [
          tenantId,
          'percentage',
          onboardingData.treasury.conversionPercentage || 2,
          onboardingData.treasury.minimumAmount || 100,
          onboardingData.treasury.frequency || 'immediate',
          onboardingData.treasury.riskTolerance || 'moderate',
          true,
        ]);
      }

      // Create initial integration record for Stripe
      if (onboardingData.integration?.stripeConnected) {
        await tenantDb.query(`
          INSERT INTO integrations (
            tenant_id,
            integration_type,
            provider,
            status,
            config,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, NOW()
          )
        `, [
          tenantId,
          'payment',
          'stripe',
          'PENDING', // Will be updated when OAuth completes
          JSON.stringify({
            accountId: onboardingData.integration.stripeAccountId,
            monthlyVolume: onboardingData.integration.monthlyVolume,
            primaryUseCase: onboardingData.integration.primaryUseCase,
          }),
        ]);
      }

      // Create beta user tracking record
      await publicDb.query(`
        INSERT INTO beta_users (
          tenant_id,
          contact_email,
          company_name,
          onboarding_completed_at,
          onboarding_data,
          feedback_frequency,
          support_level,
          created_at
        ) VALUES (
          $1, $2, $3, NOW(), $4, $5, $6, NOW()
        )
      `, [
        tenantId,
        onboardingData.business.contactEmail,
        onboardingData.business.companyName,
        JSON.stringify(onboardingData),
        'weekly',
        'founder', // Direct founder support
      ]);

      // Commit transaction
      await publicDb.query('COMMIT');

      // Track completion analytics
      await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'beta_onboarding_completed',
          properties: {
            tenantId,
            companyName: onboardingData.business.companyName,
            industry: onboardingData.business.industry,
            monthlyRevenue: onboardingData.business.monthlyRevenue,
            conversionPercentage: onboardingData.treasury?.conversionPercentage,
            walletType: onboardingData.wallet?.type,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      // Send welcome email (placeholder)
      await sendWelcomeEmail({
        email: onboardingData.business.contactEmail,
        companyName: onboardingData.business.companyName,
        tenantSlug,
      });

      return NextResponse.json({
        success: true,
        message: 'Beta onboarding completed successfully',
        tenantId,
        redirectUrl: '/dashboard?welcome=beta',
      });

    } catch (error) {
      // Rollback transaction
      await publicDb.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Beta onboarding completion error:', error);
    
    return NextResponse.json(
      { error: 'Failed to complete beta onboarding' },
      { status: 500 }
    );
  }
}

// Helper function to send welcome email
async function sendWelcomeEmail(params: {
  email: string;
  companyName: string;
  tenantSlug: string;
}) {
  try {
    // This would integrate with your email service (SendGrid, etc.)
    console.log('Welcome email would be sent to:', params.email);
    console.log('Company:', params.companyName);
    console.log('Dashboard URL:', `https://${params.tenantSlug}.liquidtreasury.business/dashboard`);
    
    // TODO: Implement actual email sending
    // await emailService.send({
    //   to: params.email,
    //   template: 'beta-welcome',
    //   data: params,
    // });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    // Don't fail the onboarding if email fails
  }
}