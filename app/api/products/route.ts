import { NextResponse } from 'next/server';
import { getAllProducts } from '@/lib/db';

// better-sqlite3 is native — must run on the Node.js runtime, not Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/products — list all products for the home grid.
export async function GET() {
  const products = getAllProducts();
  return NextResponse.json({ products });
}
