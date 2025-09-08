// LIQUID ABT - Compliance-Specific Audit Export API
// Generate audit reports for specific compliance frameworks

import { NextRequest, NextResponse } from 'next/server';
import { auditTrailExportService, ComplianceFramework } from '@/lib/audit/auditTrailExport';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Extract JWT from Authorization header
    const headersList = headers();
    const authorization = headersList.get('authorization');
    
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing or invalid token' },
        { status: 401 }
      );
    }

    const token = authorization.substring(7);
    
    // Validate JWT and extract user info
    const userInfo = await validateJWT(token);
    if (!userInfo) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    // Check if user has compliance privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for compliance audit reports' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.complianceFramework || !body.startDate || !body.endDate) {
      return NextResponse.json(
        { error: 'complianceFramework, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    // Validate compliance framework
    if (!Object.values(ComplianceFramework).includes(body.complianceFramework)) {
      return NextResponse.json(
        { error: 'Invalid compliance framework. Must be one of: ' + Object.values(ComplianceFramework).join(', ') },
        { status: 400 }
      );
    }

    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    // Validate date range
    if (startDate >= endDate) {
      return NextResponse.json(
        { error: 'Start date must be before end date' },
        { status: 400 }
      );
    }

    console.log('Compliance audit report requested:', {
      complianceFramework: body.complianceFramework,
      dateRange: { startDate, endDate },
      requestedBy: userInfo.userId,
      tenantId
    });

    // Generate compliance-specific audit report
    const auditExport = await auditTrailExportService.generateComplianceReport(
      body.complianceFramework,
      { startDate, endDate },
      tenantId !== 'global' ? tenantId : undefined,
      userInfo.userId
    );

    // Provide framework-specific guidance
    const frameworkGuidance = getComplianceFrameworkGuidance(body.complianceFramework);

    return NextResponse.json({
      success: true,
      export: auditExport,
      complianceFramework: body.complianceFramework,
      guidance: frameworkGuidance,
      message: `${body.complianceFramework} compliance audit report requested successfully`,
      nextSteps: [
        'Monitor export status using the export ID',
        'Review generated report for completeness',
        'Prepare additional documentation as required by framework',
        'Submit to compliance team or auditors as needed'
      ]
    });

  } catch (error) {
    console.error('Compliance audit report API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getComplianceFrameworkGuidance(framework: ComplianceFramework): {
  description: string;
  keyControls: string[];
  auditFocus: string[];
  retentionRequirements: string;
  additionalNotes?: string;
} {
  switch (framework) {
    case ComplianceFramework.SOC2_TYPE1:
      return {
        description: 'SOC 2 Type I audit focuses on the design and implementation of controls at a point in time',
        keyControls: [
          'Access control systems and user management',
          'System security and data protection',
          'Availability and system performance monitoring',
          'Processing integrity and system accuracy',
          'Confidentiality controls and data handling'
        ],
        auditFocus: [
          'Control design effectiveness',
          'Policy and procedure documentation',
          'Risk assessment and mitigation',
          'Incident response capabilities'
        ],
        retentionRequirements: '7 years minimum for SOC 2 compliance',
        additionalNotes: 'Type I audit provides a snapshot at a specific point in time. Consider Type II for operational effectiveness over time.'
      };

    case ComplianceFramework.SOC2_TYPE2:
      return {
        description: 'SOC 2 Type II audit evaluates the operational effectiveness of controls over a period of time',
        keyControls: [
          'Continuous monitoring and alerting systems',
          'Regular access reviews and user lifecycle management',
          'Change management and configuration controls',
          'Data backup and recovery procedures',
          'Security incident response and documentation'
        ],
        auditFocus: [
          'Control operating effectiveness over time',
          'Evidence of consistent implementation',
          'Exception handling and remediation',
          'Continuous improvement processes'
        ],
        retentionRequirements: '7 years minimum for SOC 2 compliance'
      };

    case ComplianceFramework.PCI_DSS:
      return {
        description: 'PCI DSS compliance for organizations handling payment card data',
        keyControls: [
          'Payment data encryption and tokenization',
          'Network security and segmentation',
          'Access control and authentication',
          'Regular security testing and monitoring',
          'Secure software development practices'
        ],
        auditFocus: [
          'Cardholder data environment (CDE) protection',
          'Payment processing security',
          'Vulnerability management',
          'Security awareness training'
        ],
        retentionRequirements: '1 year minimum, 3 years recommended'
      };

    case ComplianceFramework.AUSTRAC:
      return {
        description: 'AUSTRAC compliance for Australian financial services and cryptocurrency operations',
        keyControls: [
          'Customer identification and verification (KYC)',
          'Transaction monitoring and reporting',
          'Suspicious matter reporting (SMR)',
          'Record keeping and audit trails',
          'AML/CTF program implementation'
        ],
        auditFocus: [
          'Threshold transaction reporting ($10,000+ AUD)',
          'Suspicious activity detection and reporting',
          'Customer due diligence procedures',
          'Cross-border transaction monitoring'
        ],
        retentionRequirements: '7 years for transaction records and customer identification',
        additionalNotes: 'Ensure all Bitcoin transactions and related activities are properly documented for AUSTRAC reporting requirements.'
      };

    case ComplianceFramework.ATO:
      return {
        description: 'Australian Taxation Office compliance for business tax obligations',
        keyControls: [
          'Financial transaction recording',
          'GST calculation and reporting',
          'Capital gains tax (CGT) tracking',
          'Business activity statement (BAS) preparation',
          'Cryptocurrency tax compliance'
        ],
        auditFocus: [
          'Bitcoin purchase and sale records',
          'CGT calculation methodologies',
          'Business expense categorization',
          'GST on Bitcoin transactions'
        ],
        retentionRequirements: '5 years for tax records',
        additionalNotes: 'Bitcoin transactions require specific tax treatment under Australian tax law. Ensure FIFO, LIFO, or weighted average methods are consistently applied.'
      };

    case ComplianceFramework.ISO27001:
      return {
        description: 'ISO 27001 Information Security Management System compliance',
        keyControls: [
          'Information security policy and procedures',
          'Risk management and assessment',
          'Asset management and classification',
          'Physical and environmental security',
          'Business continuity planning'
        ],
        auditFocus: [
          'Security control implementation',
          'Risk assessment documentation',
          'Incident management procedures',
          'Continuous improvement processes'
        ],
        retentionRequirements: 'Varies by control, typically 3-7 years'
      };

    case ComplianceFramework.GDPR:
      return {
        description: 'General Data Protection Regulation compliance for personal data processing',
        keyControls: [
          'Data subject rights management',
          'Consent and lawful basis tracking',
          'Data breach notification procedures',
          'Privacy by design implementation',
          'Data protection impact assessments'
        ],
        auditFocus: [
          'Personal data processing activities',
          'Data subject request handling',
          'International data transfers',
          'Privacy policy and consent mechanisms'
        ],
        retentionRequirements: '3 years for processing records, varies by data type'
      };

    default:
      return {
        description: 'General audit trail for compliance purposes',
        keyControls: [
          'User activity monitoring',
          'System access logging',
          'Data modification tracking',
          'Security event documentation'
        ],
        auditFocus: [
          'Complete audit trail availability',
          'Data integrity verification',
          'Access control effectiveness'
        ],
        retentionRequirements: '1 year minimum, varies by industry'
      };
  }
}