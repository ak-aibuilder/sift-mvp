import { NextResponse } from 'next/server';
import { getProductById, getSummary } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/products/[id]/summary — pre-baked structured summary for one product.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const product = getProductById(id);
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const summary = getSummary(id);
  if (!summary) {
    return NextResponse.json(
      { error: 'Summary not generated yet. Run: npm run generate:summaries' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    product_id: id,
    summary: JSON.parse(summary.summary_json),
    model_used: summary.model_used,
    generated_at: summary.generated_at,
  });
}
