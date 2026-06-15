// Presentation helpers shared by server + client components (pure, no DB/IO).

import type { Category } from './db';
import type { OverallSentiment, AspectSentiment } from './prompts';

export const CATEGORY_LABELS: Record<Category, string> = {
  fashion: 'Fashion',
  health_personal_care: 'Health & Personal Care',
  beauty: 'Beauty',
};

export const CATEGORY_BADGE: Record<Category, string> = {
  fashion: 'bg-violet-100 text-violet-700',
  health_personal_care: 'bg-emerald-100 text-emerald-700',
  beauty: 'bg-pink-100 text-pink-700',
};

export const OVERALL_LABELS: Record<OverallSentiment, string> = {
  very_positive: 'Very positive',
  mostly_positive: 'Mostly positive',
  mixed: 'Mixed',
  mostly_negative: 'Mostly negative',
  very_negative: 'Very negative',
};

export const OVERALL_BADGE: Record<OverallSentiment, string> = {
  very_positive: 'bg-emerald-100 text-emerald-700',
  mostly_positive: 'bg-emerald-100 text-emerald-700',
  mixed: 'bg-amber-100 text-amber-800',
  mostly_negative: 'bg-rose-100 text-rose-700',
  very_negative: 'bg-rose-100 text-rose-700',
};

// Aspect sentiment -> a small colored dot + label.
export const ASPECT_SENTIMENT: Record<AspectSentiment, { label: string; dot: string; text: string }> = {
  positive: { label: 'Positive', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  mixed: { label: 'Mixed', dot: 'bg-amber-500', text: 'text-amber-700' },
  negative: { label: 'Negative', dot: 'bg-rose-500', text: 'text-rose-600' },
};
