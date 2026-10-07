import { Badge, type Tone } from '../../ui/kit';
import { useI18n } from '../../i18n';

export const DOC_TYPES = ['id', 'license', 'health', 'driver_card', 'ajeer'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_SLUG: Record<string, DocType> = {
  'id-documents': 'id', 'driving-licenses': 'license', 'health-certificates': 'health', 'driver-cards': 'driver_card', 'ajeer-permits': 'ajeer',
};
export const DOC_MODULE: Record<DocType, string> = { id: 'id_documents', license: 'driving_licenses', health: 'health_certs', driver_card: 'driver_cards', ajeer: 'ajeer_permits' };

export const RIDER_STATUS: Record<string, Tone> = { active: 'green', inactive: 'grey', suspended: 'amber', terminated: 'red' };
export const RiderStatus = ({ s }: { s: string }) => {
  const { t } = useI18n();
  return <Badge tone={RIDER_STATUS[s] ?? 'grey'}>{t(`rider.status.${s}`)}</Badge>;
};

// The documentation mark next to the rider's name.
export function DocMark({ types, expired }: { types: string | null; expired: number }) {
  const { t } = useI18n();
  if (!types) return null;
  const n = types.split(',').length;
  if (n === 5 && !expired) return <Badge tone="green">{t('riders.documented')}</Badge>;
  if (n === 5) return <Badge tone="amber" title={t('riders.n_expired', { n: expired })}>{t('riders.documented')}</Badge>;
  return <Badge tone="amber" title={t('riders.n_missing', { n: 5 - n })}>{t('riders.incomplete')}</Badge>;
}

export function MissingDocs({ types }: { types: string | null }) {
  const { t } = useI18n();
  const have = new Set((types ?? '').split(',').filter(Boolean));
  const missing = DOC_TYPES.filter((d) => !have.has(d));
  if (!missing.length) return <Badge tone="green">{t('riders.complete')}</Badge>;
  return <div className="flex min-w-44 flex-wrap gap-1">{missing.map((d) => <Badge key={d} tone={d === 'ajeer' ? 'red' : 'amber'}>{t(`docs.${d}`)}</Badge>)}</div>;
}
