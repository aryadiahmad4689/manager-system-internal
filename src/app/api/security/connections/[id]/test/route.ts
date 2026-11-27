import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { testSavedSecurityConnection } from '@/lib/security/security-client';
import { handleSecurityApiError } from '@/lib/security/api-helpers';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await testSavedSecurityConnection(params.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to test security connection');
  }
}
