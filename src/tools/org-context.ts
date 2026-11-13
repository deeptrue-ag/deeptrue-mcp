import { z } from 'zod';
import { MAX_ORGANIZATION_LENGTH } from '../auth.js';
import type { DeepTrueApiClient } from '../client/http.js';

export const organizationField = {
  organization: z
    .string()
    .max(MAX_ORGANIZATION_LENGTH)
    .optional()
    .describe(
      'Organization domain/slug for this call only. It does not persist. HTTP clients can also send X-DeepTrue-Org. Stdio defaults to DEEPTRUE_ORG.',
    ),
};

export const ACTIVE_ORG_DOES_NOT_PERSIST =
  'Organization is chosen per request and does not stick across stateless HTTP calls. Pass organization on the next tool, send the X-DeepTrue-Org header, or set DEEPTRUE_ORG for stdio.';

export async function clientForOrganization(
  getClient: () => Promise<DeepTrueApiClient>,
  organization?: string,
): Promise<DeepTrueApiClient> {
  const client = await getClient();
  if (!organization || organization === client.org) {
    return client;
  }
  return client.withOrg(organization);
}
