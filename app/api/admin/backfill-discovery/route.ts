import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { repairStorylineDiscoveryMetadata } from '@/app/actions/storyline-discovery';

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminUserId = process.env.ADMIN_USER_ID;
  if (!adminUserId || user.id !== adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Deliberately small: each row costs one model call, so the operator
    // presses the button again rather than the server looping thousands.
    const result = await repairStorylineDiscoveryMetadata({ limit: 25 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
